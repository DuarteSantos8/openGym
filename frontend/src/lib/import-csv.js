// Import a training history exported from another app.
//
// Every one of these apps exports the same thing in a different dialect: one row per
// *set*, carrying a date, an exercise name and some mix of weight/reps/distance/time.
// So this reads a column MAP built from the header rather than fixed positions, which
// means a new app is usually a few header aliases rather than another importer.
//
// Verified against real exports:
//   FitNotes (Android) Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment
//   FitNotes 2 (iOS)   Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind
//   Strong             Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
//   Hevy               title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe
// Anything else falls through to loose header matching, which covers Lyfta and the
// spreadsheet round-trips people actually have on disk, as long as the file has a
// date, an exercise name and something measured.
//
// Apple Health is a different animal — an XML dump, often hundreds of MB — and only its
// body-weight records are interesting here. parseBodyweight() scans for those without
// building a DOM.

import { EXDB, EXIDX } from './exercises.js'
import { uid } from './format.js'

/* ----------------------------------------------------------------- CSV ---- */

/**
 * A real CSV reader: quoted fields, embedded commas and newlines, doubled quotes, BOM
 * and CRLF. Splitting on commas breaks on the first exercise named "Bench Press, Close
 * Grip" — and a whole history would import shifted by one column without ever erroring.
 */
export function parseCSV(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const s = String(text).replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(x => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(x => x !== '')) rows.push(row)
  return rows
}

const norm = h => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// header text -> the field we care about. Specific names first; first match wins.
const COLUMNS = [
  ['exercise', ['exercise', 'exercise name', 'exercise title']],
  ['date', ['date', 'workout date']],
  ['startTime', ['start time']],
  ['endTime', ['end time']],
  ['workoutName', ['workout name', 'title']],
  ['category', ['category', 'body part', 'muscle group']],
  ['weightKg', ['weight kg']],
  ['weightLb', ['weight lbs', 'weight lb']],
  ['weight', ['weight']],
  ['weightUnit', ['weight unit', 'unit']],
  ['reps', ['reps', 'repetitions']],
  ['distanceKm', ['distance km']],
  ['distance', ['distance']],
  ['distanceUnit', ['distance unit']],
  ['seconds', ['seconds', 'duration seconds']],
  ['time', ['time', 'duration']],
  ['setType', ['set type']],
  ['note', ['comment', 'comments', 'notes', 'note']],
]

function mapHeader(header) {
  const map = {}
  header.forEach((h, i) => {
    const n = norm(h)
    for (const [field, names] of COLUMNS) {
      if (map[field] === undefined && names.includes(n)) { map[field] = i; return }
    }
  })
  return map
}

/** Name of the app a header looks like — shown back to the user so they can sanity-check. */
export function detectSource(header) {
  const h = header.map(norm)
  if (h.includes('exercise title') && h.includes('set index')) return 'Hevy'
  if (h.includes('exercise name') && h.includes('set order')) return 'Strong'
  if (h.includes('exercise') && h.includes('kind')) return 'FitNotes (iOS)'
  if (h.includes('exercise') && h.includes('weight unit')) return 'FitNotes'
  if (h.includes('exercise') && h.includes('category')) return 'FitNotes'
  return null
}

/* ------------------------------------------------------ exercise matching -- */

// Other apps bolt qualifiers onto names — Hevy writes "Leg Press (Machine)", Strong
// "Snatch (Barbell)", FitNotes "Lat Pulldown (Pulley)" — while the dataset writes
// "barbell snatch". Strip the parentheses, expand the shorthand, then compare as a
// sorted bag of words so word order stops mattering.
const SYN = [
  [/\bbb\b/g, 'barbell'], [/\bdb\b/g, 'dumbbell'], [/\bkb\b/g, 'kettlebell'],
  [/\bohp\b/g, 'overhead press'], [/\bbw\b/g, 'body weight'], [/\bbodyweight\b/g, 'body weight'],
  [/\bmachine\b/g, 'lever'], [/\bsmith machine\b/g, 'smith'], [/\bez bar\b/g, 'ez barbell'],
  [/\bpull ups?\b/g, 'pull up'], [/\bchin ups?\b/g, 'chin up'], [/\bpush ups?\b/g, 'push up'],
  [/\bsit ups?\b/g, 'sit up'], [/\bdips?\b/g, 'dip'], [/\braises?\b/g, 'raise'],
  [/\bcurls?\b/g, 'curl'], [/\bpresses\b/g, 'press'], [/\bextensions?\b/g, 'extension'],
  [/\bcables?\b/g, 'cable'], [/\bseated\b/g, 'seated'], [/\bassisted\b/g, 'assisted'],
]
// Words that say nothing about which exercise this is, so they shouldn't stop a match.
const FILLER = new Set(['the', 'a', 'with', 'and', 'v', 'variation', 'version', 'pulley', 'weighted'])

function wordsOf(name) {
  // Parentheses are unwrapped rather than dropped: "Bench Press (Barbell)" carries its
  // equipment in there, and the dataset writes that as "barbell bench press".
  let k = String(name || '').toLowerCase()
    .replace(/[()[\]]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  SYN.forEach(([re, to]) => { k = k.replace(re, to) })
  return k.split(' ').filter(w => w && !FILLER.has(w))
}
const keyOf = name => wordsOf(name).sort().join(' ')

let INDEX = null
function buildIndex() {
  if (INDEX) return INDEX
  INDEX = { exact: new Map(), all: [] }
  EXDB.forEach(e => {
    const w = wordsOf(e.n)
    const k = w.slice().sort().join(' ')
    if (!INDEX.exact.has(k)) INDEX.exact.set(k, e.id)
    INDEX.all.push({ id: e.id, set: new Set(w), n: w.length })
  })
  return INDEX
}

// Curated: the names people actually log, mapped by hand to the dataset id they mean.
//
// Other apps let you name a lift "Bench Press"; the dataset only has qualified names
// like "barbell bench press". Word-overlap alone can't resolve that — "bench press" sits
// inside thirty-three entries — and where it *is* unique it tends to be wrong, happily
// resolving "Squat" to "weighted squat" and "Leg Press" to "smith leg press". So the
// common vocabulary is spelled out. The convention is that an unqualified name means the
// canonical barbell version, which is what these apps assume when they show it to you.
// Extending this table is the intended way to improve import accuracy.
const ALIAS_EX = {
  'bench press': '0025', 'barbell bench press': '0025', 'flat bench press': '0025',
  'incline bench press': '0047', 'decline bench press': '0033',
  'close grip bench press': '0030', 'close-grip bench press': '0030',
  squat: '0043', 'back squat': '0043', 'barbell squat': '0043', 'front squat': '0042',
  deadlift: '0032', 'romanian deadlift': '0085', rdl: '0085', 'sumo deadlift': '0117',
  'lat pulldown': '2330', 'lat pull down': '2330', pulldown: '2330',
  shrug: '0095', shrugs: '0095',
  'overhead press': '0091', 'military press': '0091', 'shoulder press': '0091', ohp: '0091',
  'barbell row': '0027', 'bent over row': '0027', 'bent-over row': '0027',
  'dumbbell row': '0292', 'one arm dumbbell row': '0292',
  'leg curl': '0586', 'lying leg curl': '0586', 'seated leg curl': '0586',
  'leg press': '0739', 'leg extension': '0585',
  'calf raise': '1372', 'standing calf raise': '1372', 'seated calf raise': '0088',
  'lateral raise': '0334', 'side raise': '0334', 'reverse fly': '0348', 'rear delt fly': '0348',
  'bicep curl': '0294', 'biceps curl': '0294', 'dumbbell curl': '0294',
  'preacher curl': '0070', 'barbell curl': '0031',
  'tricep pushdown': '0241', 'triceps pushdown': '0241', pushdown: '0241',
  skullcrusher: '0060', 'skull crusher': '0060', 'lying triceps extension': '0061',
  lunge: '0054', lunges: '0054', 'cable crossover': '1269', 'cable cross over': '1269',
}

let ALIAS_IDX = null
const aliasIndex = () => {
  if (!ALIAS_IDX) {
    ALIAS_IDX = new Map()
    for (const k in ALIAS_EX) ALIAS_IDX.set(wordsOf(k).sort().join(' '), ALIAS_EX[k])
  }
  return ALIAS_IDX
}

/**
 * Find the dataset exercise a foreign name refers to, or null.
 *
 * Curated alias first, then an exact word-bag match, then entries that contain every
 * word of the query — but only when exactly one candidate is that close. Guessing
 * between "barbell bench press" and "dumbbell bench press" would file years of training
 * under the wrong lift, which is worse than leaving it as a custom exercise the user can
 * see and fix.
 */
export function matchExercise(name) {
  const idx = buildIndex()
  const w = wordsOf(name)
  if (!w.length) return null
  // Compared as a sorted bag of words, so "Squat (Barbell)" finds the 'barbell squat'
  // alias — the exporters disagree about whether the equipment leads or trails.
  const sorted = w.slice().sort().join(' ')
  const aliased = aliasIndex().get(sorted)
  if (aliased && EXIDX[aliased]) return aliased
  const exact = idx.exact.get(sorted)
  if (exact) return exact
  const q = new Set(w)
  let best = null, bestExtra = Infinity, ties = 0
  for (const c of idx.all) {
    let ok = true
    for (const word of q) if (!c.set.has(word)) { ok = false; break }
    if (!ok) continue
    const extra = c.n - q.size
    if (extra > 2) continue
    if (extra < bestExtra) { best = c.id; bestExtra = extra; ties = 1 }
    else if (extra === bestExtra) ties++
  }
  return ties === 1 ? best : null
}

// Categories the exporters use -> the dataset's body parts, for exercises we invent.
const CATEGORY_BP = {
  chest: 'chest', back: 'back', lats: 'back', shoulders: 'shoulders', delts: 'shoulders',
  legs: 'upper legs', quads: 'upper legs', hamstrings: 'upper legs', glutes: 'upper legs',
  calves: 'lower legs', abs: 'waist', core: 'waist', obliques: 'waist',
  arms: 'upper arms', biceps: 'upper arms', triceps: 'upper arms', forearms: 'lower arms',
  cardio: 'cardio', 'full body': 'upper legs', olympic: 'upper legs', neck: 'neck',
}

/* ----------------------------------------------------------- conversion --- */

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0 }
const LB_TO_KG = 0.45359237
const p2 = n => String(n).padStart(2, '0')
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "2020-12-30 18:51:52" · "2024-03-07" · "22 Dec 2025, 08:00" · "07/03/2024" -> { d, t } */
export function parseWhen(s) {
  const v = String(s || '').trim()
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (m) return { d: `${m[1]}-${p2(m[2])}-${p2(m[3])}`, t: hm(m[4], m[5]) }
  m = v.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/)
  if (m && MON[m[2].toLowerCase()]) return { d: `${m[3]}-${p2(MON[m[2].toLowerCase()])}-${p2(m[1])}`, t: hm(m[4], m[5]) }
  m = v.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/)
  if (m && MON[m[1].toLowerCase()]) return { d: `${m[3]}-${p2(MON[m[1].toLowerCase()])}-${p2(m[2])}`, t: hm(m[4], m[5]) }
  // Day-first when ambiguous: FitNotes/Strong/Hevy all write unambiguous dates, so a
  // bare numeric one came through a spreadsheet, and those are usually European.
  m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[, ]+(\d{1,2}):(\d{2}))?/)
  if (m) {
    const [, a, b, y] = m
    const day = +a > 12 ? a : +b > 12 ? b : a
    const mon = day === a ? b : a
    return { d: `${y}-${p2(mon)}-${p2(day)}`, t: hm(m[4], m[5]) }
  }
  return null
}
const hm = (h, mi) => (h === undefined ? null : (parseInt(h, 10) || 0) * 3600000 + (parseInt(mi, 10) || 0) * 60000)

/** "HH:MM:SS" · "MM:SS" · "90" -> minutes */
function toMinutes(v) {
  const s = String(v ?? '').trim()
  if (!s) return 0
  if (s.includes(':')) {
    const p = s.split(':').map(x => parseInt(x, 10) || 0)
    const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
    return Math.round(sec / 60 * 10) / 10
  }
  const m = s.match(/(\d+)\s*h/i), mm = s.match(/(\d+)\s*m/i)      // Strong's "2h 38m"
  if (m || mm) return (m ? +m[1] * 60 : 0) + (mm ? +mm[1] : 0)
  return Math.round(num(s) * 10) / 10
}
const KM = { m: 0.001, km: 1, cm: 0.00001, in: 0.0000254, ft: 0.0003048, yd: 0.0009144, mi: 1.609344 }
const toKm = (v, unit) => num(v) * (KM[String(unit || 'km').toLowerCase().trim()] ?? 1)

/* --------------------------------------------------------------- parse ---- */

/**
 * Read an export into workouts openGym understands, WITHOUT touching state — the caller
 * shows the summary for confirmation first. Nothing here throws on a bad row: a history
 * of several thousand sets will contain oddities, and losing the file over one of them
 * helps nobody. Bad rows are counted and reported instead.
 */
export function parseWorkoutCSV(text, { unit = 'kg' } = {}) {
  const rows = parseCSV(text)
  if (rows.length < 2) return { error: 'empty' }
  const map = mapHeader(rows[0])
  const source = detectSource(rows[0])
  const dateCol = map.date !== undefined ? 'date' : map.startTime !== undefined ? 'startTime' : null
  if (!dateCol || map.exercise === undefined) return { error: 'unrecognised' }

  const resolved = new Map()          // exercise name -> dataset id | null, resolved once
  const byDate = new Map()
  const created = new Map()
  const unmatched = new Set()
  let sets = 0, skipped = 0, matched = 0, warmups = 0
  let sawLb = false, sawKg = false

  const cell = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim())

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const name = cell(r, 'exercise')
    const when = parseWhen(cell(r, dateCol))
    if (!name || !when) { skipped++; continue }

    // explicit kg/lb columns beat a generic column plus a unit column
    let w = 0, rowUnit = ''
    if (map.weightKg !== undefined && cell(r, 'weightKg')) { w = num(cell(r, 'weightKg')); rowUnit = 'kg' }
    else if (map.weightLb !== undefined && cell(r, 'weightLb')) { w = num(cell(r, 'weightLb')); rowUnit = 'lb' }
    else {
      w = num(cell(r, 'weight'))
      const u = cell(r, 'weightUnit').toLowerCase()
      rowUnit = u.startsWith('lb') ? 'lb' : u.startsWith('kg') ? 'kg' : ''
    }
    if (rowUnit === 'lb') sawLb = true
    if (rowUnit === 'kg') sawKg = true

    const reps = Math.round(num(cell(r, 'reps')))
    const secs = num(cell(r, 'seconds'))
    const mins = secs > 0 ? Math.round(secs / 60 * 10) / 10 : toMinutes(cell(r, 'time'))
    const km = map.distanceKm !== undefined && cell(r, 'distanceKm')
      ? num(cell(r, 'distanceKm'))
      : toKm(cell(r, 'distance'), cell(r, 'distanceUnit'))
    if (!w && !reps && !mins && !km) { skipped++; continue }
    if (/warm/i.test(cell(r, 'setType'))) warmups++

    const key = keyOf(name)
    let id = resolved.get(key)
    if (id === undefined) { id = matchExercise(name); resolved.set(key, id) }
    if (id) matched++
    else {
      let c = created.get(key)
      if (!c) {
        c = {
          id: 'im' + uid(), n: name.toLowerCase(), custom: true, eq: 'custom', tg: '', desc: '',
          bp: CATEGORY_BP[cell(r, 'category').toLowerCase()] || (km || (mins && !reps) ? 'cardio' : 'upper legs'),
        }
        created.set(key, c)
        unmatched.add(name)
      }
      id = c.id
    }

    const isCardio = (km > 0 || mins > 0) && !reps
    const set = isCardio
      ? { min: mins || 0, speed: mins > 0 ? Math.round(km / (mins / 60) * 10) / 10 : 0, done: true }
      : { w, r: reps || 0, done: true }

    let day = byDate.get(when.d)
    if (!day) {
      day = { ex: new Map(), name: cell(r, 'workoutName') || '', start: when.t, end: null }
      byDate.set(when.d, day)
    }
    if (!day.name) day.name = cell(r, 'workoutName') || ''
    if (map.endTime !== undefined) { const e = parseWhen(cell(r, 'endTime')); if (e && e.t != null) day.end = e.t }
    else if (map.time !== undefined && !map.seconds && reps) { /* FitNotes' Time is per-set */ }
    if (!day.ex.has(id)) day.ex.set(id, [])
    day.ex.get(id).push(set)
    sets++
  }

  // lb -> kg only when the file disagrees with the profile. The app never converts units
  // on its own, so importing unconverted would silently rewrite someone's numbers.
  const fileUnit = sawLb && !sawKg ? 'lb' : sawKg && !sawLb ? 'kg' : ''
  const converted = !!fileUnit && fileUnit !== unit
  const conv = converted
    ? (fileUnit === 'lb' ? x => Math.round(x * LB_TO_KG * 10) / 10 : x => Math.round(x / LB_TO_KG * 10) / 10)
    : x => x

  const dates = [...byDate.keys()].sort()
  const workouts = dates.map(d => {
    const day = byDate.get(d)
    const entries = [...day.ex.entries()].map(([id, ss]) => {
      const conv2 = ss.map(s => (s.w !== undefined ? { ...s, w: conv(s.w) } : s))
      const mx = Math.max(0, ...conv2.map(s => s.w || 0))
      return { id, sets: conv2, topW: mx || null }
    })
    const base = new Date(d + 'T00:00:00').getTime()
    const start = base + (day.start ?? 18 * 3600000)
    const end = day.end != null ? base + day.end : start
    const w = {
      id: 'iw' + uid(), d, start, end: end > start ? end : start,
      routineId: null, name: day.name || 'Imported', entries, prs: [],
    }
    w.vol = entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.w || 0) * (s.r || 0), 0), 0)
    return w
  })

  return {
    kind: 'workouts', source, workouts, customEx: [...created.values()],
    matched, created: created.size, unmatchedNames: [...unmatched].sort(),
    sets, skipped, warmups, fileUnit, converted,
    from: dates[0] || null, to: dates[dates.length - 1] || null,
  }
}

/* ------------------------------------------------------- body weight ------ */

/**
 * Body-weight history from Apple Health, or any CSV with a date and a weight.
 *
 * Health's own export is one big `export.xml` — often several hundred MB, nearly all of
 * it step counts and heart rate. Building a DOM would blow up the tab, so the body-mass
 * records are pulled out with a scan instead. Health writes weights in the unit the
 * phone is set to and labels each record, so the unit is read per record.
 */
export function parseBodyweight(text, { unit = 'kg' } = {}) {
  const s = String(text)
  const out = new Map()          // iso date -> { w, t }  (one weigh-in per day, the last)
  let fileUnit = ''

  if (s.includes('HKQuantityTypeIdentifierBodyMass')) {
    const re = /<Record[^>]*type="HKQuantityTypeIdentifierBodyMass"[^>]*>/g
    let m
    while ((m = re.exec(s))) {
      const tag = m[0]
      const val = /value="([\d.]+)"/.exec(tag)
      const dt = /startDate="([^"]+)"/.exec(tag) || /creationDate="([^"]+)"/.exec(tag)
      const u = /unit="([^"]+)"/.exec(tag)
      if (!val || !dt) continue
      const when = parseWhen(dt[1])
      if (!when) continue
      if (u) fileUnit = /lb/i.test(u[1]) ? 'lb' : 'kg'
      out.set(when.d, { w: parseFloat(val[1]), t: new Date(dt[1]).getTime() || null })
    }
  } else {
    const rows = parseCSV(s)
    if (rows.length < 2) return { error: 'empty' }
    const map = mapHeader(rows[0])
    // a weight-only CSV: whichever weight column it has
    const wCol = map.weightKg ?? map.weightLb ?? map.weight
    const dCol = map.date ?? map.startTime
    if (wCol === undefined || dCol === undefined) return { error: 'unrecognised' }
    if (map.weightKg !== undefined) fileUnit = 'kg'
    else if (map.weightLb !== undefined) fileUnit = 'lb'
    for (let i = 1; i < rows.length; i++) {
      const when = parseWhen(String(rows[i][dCol] ?? ''))
      const w = num(rows[i][wCol])
      if (!when || !w) continue
      out.set(when.d, { w, t: new Date(when.d).getTime() + (when.t ?? 0) })
    }
  }

  if (!out.size) return { error: 'unrecognised' }
  const converted = !!fileUnit && fileUnit !== unit
  const conv = converted
    ? (fileUnit === 'lb' ? x => Math.round(x * LB_TO_KG * 10) / 10 : x => Math.round(x / LB_TO_KG * 10) / 10)
    : x => Math.round(x * 10) / 10
  const dates = [...out.keys()].sort()
  return {
    kind: 'bodyweight', source: 'Apple Health',
    bodyweight: dates.map(d => ({ d, w: conv(out.get(d).w), t: out.get(d).t || new Date(d).getTime() })),
    fileUnit, converted, from: dates[0], to: dates[dates.length - 1],
  }
}

/** Sniff the file and parse it as whatever it is. */
export function parseImport(text, opts) {
  const s = String(text)
  if (s.includes('HKQuantityTypeIdentifier') || /^\s*</.test(s)) return parseBodyweight(s, opts)
  const asWorkouts = parseWorkoutCSV(s, opts)
  if (!asWorkouts.error) return asWorkouts
  const asWeights = parseBodyweight(s, opts)
  return asWeights.error ? asWorkouts : asWeights
}

/* --------------------------------------------------------------- merge ---- */

/** Merge into state. Existing days win — importing twice never duplicates a workout. */
export function mergeImport(S, parsed) {
  if (parsed.kind === 'bodyweight') {
    const have = new Set(S.bodyweight.map(b => b.d))
    const fresh = parsed.bodyweight.filter(b => !have.has(b.d))
    S.bodyweight = [...S.bodyweight, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
    return { added: fresh.length, skipped: parsed.bodyweight.length - fresh.length }
  }
  const have = new Set(S.workouts.map(w => w.d))
  const fresh = parsed.workouts.filter(w => !have.has(w.d))
  const used = new Set(fresh.flatMap(w => w.entries.map(e => e.id)))
  const customs = parsed.customEx.filter(c => used.has(c.id) && !EXIDX[c.id])
  S.customEx = [...(S.customEx || []), ...customs]
  S.workouts = [...S.workouts, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
  // seed the weight suggestions from the newest imported set of each lift
  fresh.forEach(w => w.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.map(s => s.w || 0), e.topW || 0)
    if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || w.d >= cur.d) S.exWeights[e.id] = { w: mx, d: w.d } }
  }))
  return { added: fresh.length, skipped: parsed.workouts.length - fresh.length }
}
