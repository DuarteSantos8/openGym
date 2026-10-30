// Workout history (and, where the export has them, routines) from the apps whose export is not
// one CSV row per set: Liftosaur, Liftoff, StrongLifts 5×5, Fitbod and JEFIT (#862).
//
// Each reader turns its file into the rows lib/import-csv.js already understands
// (parseWorkoutRows), so matching, units, warm-ups, timed and cardio sets, dedupe by day and the
// import summary are the same code for every app. Only formats pinned down from a public source
// are read, and the source is named at each reader. A file that looks like one of these apps but
// does not read as one is an error, never a guess: a wrong guess would file someone's history
// under the wrong lifts.
//
// Dates: a timestamp with a zone (Liftosaur, Liftoff, JEFIT's start time) is read on this
// device's clock, the way the app showed it; a date written as a day (StrongLifts, Fitbod, JEFIT's
// log date) is kept as that day, never shifted through UTC.

import { parseCSV, parseImport, parseWorkoutRows, matchExercise, isNoMatch, importId, priorCustom, bpFromName, roundWeight } from './import-csv.js'
import { OWN, matchKey, pickFor, namesOf } from './import-matches.js'
import { EXIDX, canonicalExId } from './exercises.js'
import { uid } from './format.js'
import { LIFTOSAUR_EXERCISES } from './liftosaur-exercises.js'

const LB_TO_KG = 0.45359237
const p2 = n => String(n).padStart(2, '0')
const norm = h => String(h ?? '').toLowerCase().replace(/#/g, ' no ').replace(/[^a-z0-9]+/g, ' ').trim()
const str = v => (v == null ? '' : String(v).trim())
const numOr = (v, d = 0) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : d }
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** A moment as "YYYY-MM-DD HH:MM" on this device's clock, or '' when it is not one. */
export function localStamp(ms) {
  const d = new Date(typeof ms === 'string' ? ms : Number(ms))
  if (ms === '' || ms == null || isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

// The table parseWorkoutRows reads: one column per field it knows (lib/import-csv.js COLUMNS).
const FIELDS = ['date', 'endTime', 'session', 'workoutName', 'workoutNote', 'exercise', 'matchName', 'weight',
  'weightUnit', 'reps', 'seconds', 'distanceKm', 'incline', 'setType', 'rpe', 'note']
const MAP = Object.fromEntries(FIELDS.map((f, i) => [f, i]))
const toRow = o => FIELDS.map(f => (o[f] == null ? '' : String(o[f])))
const table = rows => [FIELDS, ...rows.map(toRow)]

function workouts(rows, source, opts, skipped = 0) {
  return parseWorkoutRows(table(rows), MAP, source, { ...opts, skipped })
}

/* ------------------------------------------------------------- Liftosaur -- */
// github.com/astashov/liftosaur. CSV: History_exportAsCSV in src/models/history.ts ("Export
// history to CSV file"), one row per set, warm-ups flagged, "Workout DateTime" an ISO instant
// shared by every row of a workout. JSON: "Export data to JSON file" (ImportExporter_exportStorage
// in src/lib/importexporter.ts) writes the whole storage; types in src/types.ts.

const LIFTO = new Map(LIFTOSAUR_EXERCISES.map(([id, name, eq]) => [id, { name, eq }]))
const LIFTO_BY_NAME = new Map(LIFTOSAUR_EXERCISES.map(([, name, eq]) => [name.toLowerCase(), eq]))
// Liftosaur's equipment ids and the names it writes (equipmentName), to the word the catalogue
// uses. Bodyweight adds nothing: the catalogue leaves it out of the name.
const LIFTO_EQ = { barbell: 'barbell', cable: 'cable', dumbbell: 'dumbbell', smith: 'smith', band: 'band',
  kettlebell: 'kettlebell', bodyweight: '', leverageMachine: 'lever', medicineball: 'medicine ball', ezbar: 'ez barbell', trapbar: 'trap bar' }
const LIFTO_EQ_NAME = { barbell: 'Barbell', cable: 'Cable', dumbbell: 'Dumbbell', smith: 'Smith Machine', band: 'Band',
  kettlebell: 'Kettlebell', bodyweight: 'Bodyweight', leverageMachine: 'Leverage Machine', medicineball: 'Medicine Ball', ezbar: 'EZ Bar', trapbar: 'Trap Bar' }
const LIFTO_EQ_BY_NAME = Object.fromEntries(Object.entries(LIFTO_EQ_NAME).map(([id, n]) => [n.toLowerCase(), id]))

/**
 * The name to match a Liftosaur exercise by: its equipment in front, which the display name
 * leaves out when it is the default ("Front Raise" is a dumbbell front raise there).
 */
export function liftosaurMatchName(name) {
  const full = str(name)
  const cut = full.lastIndexOf(',')
  let base = full, eq = null
  if (cut > 0 && Object.hasOwn(LIFTO_EQ_BY_NAME, full.slice(cut + 1).trim().toLowerCase())) {
    base = full.slice(0, cut).trim()
    eq = LIFTO_EQ_BY_NAME[full.slice(cut + 1).trim().toLowerCase()]
  } else if (LIFTO_BY_NAME.has(full.toLowerCase())) eq = LIFTO_BY_NAME.get(full.toLowerCase())
  const word = eq ? LIFTO_EQ[eq] : ''
  if (!word) return base
  const low = ' ' + base.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' '
  // "Cable Crunch" already says cable, "Elliptical Machine" already says machine.
  if (low.includes(' ' + word + ' ') || (word === 'lever' && low.includes(' machine ')) || (word === 'ez barbell' && low.includes(' ez '))) return base
  return word + ' ' + base
}

const LIFTOSAUR_CSV_SIGNATURE = ['workout datetime', 'exercise', 'is warmup set', 'completed reps']
const isLiftosaurCsv = head => LIFTOSAUR_CSV_SIGNATURE.every(h => head.includes(h))

// A set Liftosaur logged, from either export, as rows for parseWorkoutRows.
function liftosaurSet({ session, start, end, program, day, exercise, warmup, reps, weight, unit, rpe, seconds, note }) {
  // A timed set (a plank, "3x1 60s|30s") records its time and a rep count of one or none.
  const timed = seconds > 0 && !(reps > 1)
  return {
    date: start, endTime: end, session, workoutName: [program, day].filter(Boolean).join(' · '),
    exercise, matchName: liftosaurMatchName(exercise),
    weight: weight || '', weightUnit: unit, reps: timed ? '' : reps, seconds: timed ? seconds : '',
    setType: warmup ? 'warmup' : '', rpe: rpe || '', note,
  }
}

// The start of a workout and its end: Liftosaur's workout time, or the first set's when the date
// was set by hand (local midnight), and the last set's for the end.
// Set times are only believed within a day of the workout's: a set logged against a back-dated
// workout carries the moment it was typed in, days later.
function liftosaurSpan(startMs, setTimes, endMs) {
  const DAY = 86400000
  const times = setTimes.filter(t => Number.isFinite(t) && t >= startMs && t < startMs + DAY).sort((a, b) => a - b)
  let start = startMs
  const s = new Date(startMs)
  if (s.getHours() === 0 && s.getMinutes() === 0 && times.length && localStamp(times[0]).slice(0, 10) === localStamp(startMs).slice(0, 10)) start = times[0]
  const last = Number.isFinite(endMs) && endMs > start && endMs < start + DAY ? endMs : times.length ? times[times.length - 1] : NaN
  // Midnight with nothing to go by is a date set by hand: a day, not a time.
  if (start === startMs && s.getHours() === 0 && s.getMinutes() === 0 && !(last > start)) return { start: localStamp(start).slice(0, 10), end: '' }
  return { start: localStamp(start), end: last > start ? localStamp(last) : '' }
}

function parseLiftosaurCsv(rows, opts) {
  const head = rows[0].map(norm)
  const col = name => head.indexOf(name)
  const c = {
    when: col('workout datetime'), program: col('program'), day: col('day name'), ex: col('exercise'), warm: col('is warmup set'),
    reps: col('completed reps'), rpe: col('completed rpe'), w: col('completed weight value'), wu: col('completed weight unit'),
    rw: col('required weight value'), rwu: col('required weight unit'), time: col('completed reps time'), notes: col('notes'),
    secs: col('completed set time seconds'),
  }
  const cell = (r, i) => (i < 0 ? '' : str(r[i]))
  // A workout's rows share "Workout DateTime"; its span comes from the sets' own times.
  const groups = new Map()
  let skipped = 0
  for (const r of rows.slice(1)) {
    const raw = cell(r, c.when)
    const at = Date.parse(raw)
    if (!raw || !Number.isFinite(at) || !cell(r, c.ex)) { skipped++; continue }
    if (!groups.has(raw)) groups.set(raw, { at, rows: [] })
    groups.get(raw).rows.push(r)
  }
  const out = []
  for (const [raw, g] of groups) {
    const span = liftosaurSpan(g.at, g.rows.map(r => Date.parse(cell(r, c.time))))
    for (const r of g.rows) {
      const reps = cell(r, c.reps), seconds = numOr(cell(r, c.secs))
      // A set nobody finished has no completed reps (and no time); it was planned, not lifted.
      if (!(numOr(reps) > 0) && !(seconds > 0)) continue
      const done = cell(r, c.w) !== ''
      const unit = (done ? cell(r, c.wu) : cell(r, c.rwu)).toLowerCase()
      out.push(liftosaurSet({
        session: raw, start: span.start, end: span.end, program: cell(r, c.program), day: cell(r, c.day),
        exercise: cell(r, c.ex), warmup: cell(r, c.warm) === '1', reps: numOr(reps), seconds,
        weight: numOr(done ? cell(r, c.w) : cell(r, c.rw)), unit: unit === 'kg' || unit === 'lb' ? unit : '',
        rpe: cell(r, c.rpe), note: cell(r, c.notes),
      }))
    }
  }
  if (!out.length && skipped) return { error: 'format', app: 'Liftosaur' }
  return workouts(out, 'Liftosaur', opts, skipped)
}

const isLiftosaurJson = o => isObj(o) && Array.isArray(o.history) && Array.isArray(o.programs) && isObj(o.settings) && typeof o.version === 'string'

// The name Liftosaur shows for an exercise (Exercise_fullName): its own, plus the equipment when
// that is not the default. The same name the CSV export writes, so both exports match alike.
function liftosaurName(type, customs) {
  const id = str(type?.id), eqId = str(type?.equipment)
  const own = isObj(customs) && isObj(customs[id]) ? customs[id] : null
  const built = LIFTO.get(id)
  const name = str(own?.name) || built?.name || ''
  if (!name) return ''
  const eq = Object.hasOwn(LIFTO_EQ_NAME, eqId) ? eqId : ''
  return eq && (own || eq !== built.eq) ? `${name}, ${LIFTO_EQ_NAME[eq]}` : name
}

function parseLiftosaurJson(o, opts) {
  const customs = o.settings.exercises
  const rows = []
  let skipped = 0
  for (const h of o.history) {
    if (!isObj(h) || h.vtype === 'progress' || !Array.isArray(h.entries)) { skipped++; continue }
    const startMs = Number.isFinite(h.startTime) ? h.startTime : Date.parse(h.date)
    if (!Number.isFinite(startMs)) { skipped++; continue }
    const sets = h.entries.flatMap(e => [...(Array.isArray(e?.warmupSets) ? e.warmupSets : []), ...(Array.isArray(e?.sets) ? e.sets : [])])
    const span = liftosaurSpan(Number.isFinite(Date.parse(h.date)) ? Date.parse(h.date) : startMs, sets.map(s => s?.timestamp), h.endTime)
    const session = 'id' + (h.id ?? startMs)
    for (const e of h.entries) {
      const exercise = liftosaurName(e?.exercise, customs)
      if (!exercise) { skipped++; continue }
      const one = (s, warmup) => {
        if (!isObj(s)) return
        const reps = s.completedReps, seconds = numOr(s.completedSetTimer)
        if (s.isCompleted === false || (!(numOr(reps) > 0) && !(seconds > 0))) return
        const w = isObj(s.completedWeight) ? s.completedWeight : isObj(s.weight) ? s.weight : null
        rows.push(liftosaurSet({
          session, start: span.start, end: span.end, program: str(h.programName), day: str(h.dayName), exercise, warmup,
          reps: numOr(reps), seconds, weight: numOr(w?.value), unit: w?.unit === 'kg' || w?.unit === 'lb' ? w.unit : '',
          rpe: s.completedRpe ?? '', note: str(e.notes),
        }))
      }
      ;(Array.isArray(e.warmupSets) ? e.warmupSets : []).forEach(s => one(s, true))
      ;(Array.isArray(e.sets) ? e.sets : []).forEach(s => one(s, false))
    }
  }
  const parsed = workouts(rows, 'Liftosaur', opts, skipped)
  return { ...parsed, routines: liftosaurRoutines(o, opts) }
}

/* ------------------------------------------------------ Liftoscript plans -- */
// A Liftosaur program is Liftoscript text per day (llms/liftoscript.md in the Liftosaur repo):
// "Name / 3x8 / 60kg / progress: lp(5lb)", one exercise a line. openGym reads the plain part
// (sets, reps, a weight, a set timer, warm-ups, supersets) and keeps the progression as a note
// on the exercise. It never runs the script.

const LB = 'lb', KG = 'kg'
const toUnit = (w, from, unit) => (from && from !== unit ? roundWeight(from === LB ? w * LB_TO_KG : w / LB_TO_KG) : roundWeight(w))

// "3x8", "1x5+", "3x8-12", each optionally with "60kg", "70%", "@8", "90s", "60s|30s".
const SET_ITEM = /^(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?(\+)?(.*)$/i
function liftoSets(section) {
  const items = section.split(',').map(s => s.trim()).filter(Boolean)
  if (!items.length) return null
  const out = []
  for (const it of items) {
    const m = SET_ITEM.exec(it.replace(/\([^)]*\)/g, ' ').trim())
    if (!m) return null
    const rest = m[5] || ''
    const w = /(\d+(?:\.\d+)?)\s*(kg|lb)s?\b/i.exec(rest)
    const timer = /(\d+)\s*s\s*\+?\s*\|/.exec(rest)
    out.push({ n: +m[1], reps: +m[2], hi: m[3] ? +m[3] : null, amrap: !!m[4], w: w ? +w[1] : null, wu: w ? w[2].toLowerCase() : '', sec: timer ? +timer[1] : 0, pct: /%|@/.test(rest) })
  }
  return out
}

function liftoLine(line) {
  const parts = line.split('/').map(s => s.trim()).filter(Boolean)
  if (parts.length < 1) return null
  let name = parts[0].replace(/\[[^\]]*\]/g, '').trim()
  // "t1: Squat" is a label on the exercise; "Split Squat | Pistol Squat!" lists variations.
  const label = /^([^:]+):\s*(.+)$/.exec(name)
  if (label) name = label[2].trim()
  if (name.includes('|')) { const vs = name.split('|').map(s => s.trim()); name = (vs.find(v => v.endsWith('!')) || vs[0]).replace(/!$/, '').trim() }
  const o = { name, key: parts[0].replace(/\[[^\]]*\]/g, '').trim().toLowerCase(), sets: null, weight: null, sec: 0, warmup: null, superset: '', reuse: '', template: false, script: [], scheme: '', pct: false }
  for (const p of parts.slice(1)) {
    const kv = /^([a-z]+)\s*:\s*(.*)$/i.exec(p)
    if (kv) {
      const k = kv[1].toLowerCase(), v = kv[2].trim()
      if (k === 'used' && /none/i.test(v)) o.template = true
      else if (k === 'warmup') o.warmup = /none/i.test(v) ? 0 : (liftoSets(v) || []).reduce((a, s) => a + s.n, 0)
      else if (k === 'superset') o.superset = v
      else if (k === 'progress' || k === 'update') o.script.push(p)
      continue
    }
    if (p.startsWith('...')) { o.reuse = p.slice(3).trim().toLowerCase(); continue }
    const sets = !o.sets && liftoSets(p)
    if (sets) { o.sets = sets; o.scheme = p; continue }
    // A weight for every set as a share of the 1RM or an RPE needs Liftosaur's numbers.
    if (/\d%|@\s*\d/.test(p)) o.pct = true
    const w = /^(\d+(?:\.\d+)?)\s*(kg|lb)s?\+?$/i.exec(p)
    if (w) { o.weight = { w: +w[1], u: w[2].toLowerCase() }; continue }
    const t = /^(\d+)\s*s\s*\+?\s*\|/.exec(p)
    if (t) o.sec = +t[1]
  }
  return o
}

/** One day of Liftoscript as routine exercises, plus how many lines could not be read. */
export function liftoscriptDay(text, { unit = 'kg', resolve, templates = new Map() } = {}) {
  // Script blocks ({~ ... ~}) span lines; they stay as a marker in the note.
  const flat = String(text || '').replace(/\{~[\s\S]*?~\}/g, '{…}')
  const ex = [], groups = new Map()
  let skipped = 0
  for (const raw of flat.split(/\r?\n/)) {
    const line = raw.replace(/\s\/\/.*$/, '').trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    const o = liftoLine(line)
    if (!o || !o.name) { skipped++; continue }
    const base = o.reuse ? templates.get(o.reuse) : null
    const sets = o.sets || base?.sets || null
    const merged = { ...o, sets, weight: o.weight || (!o.sets && base?.weight) || null, sec: o.sec || base?.sec || 0,
      warmup: o.warmup ?? base?.warmup ?? null, script: o.script.length ? o.script : base?.script || [],
      scheme: o.scheme || base?.scheme || '', pct: o.pct || (!o.sets && !!base?.pct) }
    templates.set(o.key, merged)
    if (!templates.has(o.name.toLowerCase())) templates.set(o.name.toLowerCase(), merged)
    if (o.template) continue
    if (!sets) { skipped++; continue }
    const id = resolve(o.name)
    if (!id) { skipped++; continue }
    const n = Math.min(20, sets.reduce((a, s) => a + s.n, 0))
    const reps = sets.flatMap(s => Array(s.n).fill(s.reps))
    const first = sets[0]
    const wRaw = first.w != null ? { w: first.w, u: first.wu } : merged.weight
    const weight = wRaw ? toUnit(wRaw.w, wRaw.u, unit) : 0
    const sec = first.sec || merged.sec
    let cfg
    if (sec > 0 && reps.every(r => r <= 1)) cfg = { id, sets: n, sec, weight, mode: 'time' }
    else {
      cfg = { id, sets: n, reps: first.reps, weight, mode: 'reps' }
      // "1x5, 1x3, 1x1" is one target per set; "3x8-12" a range, from its low end.
      if (new Set(reps).size > 1 && reps.length <= 10) cfg.pyramid = reps
    }
    if (merged.warmup != null) cfg.warmupSets = Math.min(5, merged.warmup)
    // What openGym cannot run comes along as the exercise's note: the progression, and a scheme
    // the plain numbers above leave something out of (a range, an AMRAP set, a weight in % or RPE).
    const exact = !merged.pct && sets.every(s => !s.pct && !s.hi && !s.amrap)
    const note = [exact ? '' : merged.scheme, ...merged.script].filter(Boolean).join(' / ')
    if (note) cfg.note = note.slice(0, 280)
    if (o.superset) {
      if (!groups.has(o.superset)) groups.set(o.superset, 'ls' + uid())
      cfg.sg = groups.get(o.superset)
    }
    ex.push(cfg)
  }
  ex.forEach((e, i) => { if (e.sg && ex[i - 1]?.sg !== e.sg && ex[i + 1]?.sg !== e.sg) delete e.sg })
  return { ex, skipped }
}

// Exercises a routine names, resolved the way parseWorkoutRows resolves a set's: the user's own
// exercise when an earlier import made it, else the catalogue, else a custom one with the id the
// history import gives that same name, so a plan and its history point at one exercise.
// The user's own pick for a name (lib/import-matches.js) comes first, as it does there.
function routineResolver(source, customEx, toMatchName = () => '', matches = null) {
  const created = new Map(), matched = new Set(), names = new Map()
  const resolve = name => {
    const n = str(name)
    if (!n) return null
    const id = resolveName(n)
    if (!names.has(matchKey(n))) names.set(matchKey(n), { name: n, id })
    return id
  }
  const resolveName = n => {
    const ownId = importId('im', source + '|' + n.toLowerCase())
    const mine = priorCustom(customEx, ownId, n)
    const pick = pickFor(matches, n, customEx)
    if (pick && pick !== OWN) { if (EXIDX[pick] && !EXIDX[pick].custom) matched.add(pick); return pick }
    if (mine) return mine.id
    const alt = toMatchName(n)
    const hit = pick === OWN ? null : canonicalExId(alt ? matchExercise(alt) || (isNoMatch(alt) ? null : matchExercise(n)) : matchExercise(n))
    if (hit && EXIDX[hit]) { matched.add(hit); return hit }
    if (!created.has(ownId)) created.set(ownId, { id: ownId, n: n.toLowerCase(), custom: true, eq: 'custom', tg: '', desc: '', bp: bpFromName(n.toLowerCase()) || 'upper legs', _name: n })
    return ownId
  }
  const finish = (source, routines, extra = {}) => {
    const used = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
    const customs = [...created.values()].filter(c => used.has(c.id))
    return {
      kind: 'routines', source, routines,
      customEx: customs.map(({ _name, ...c }) => c),
      matched: [...matched].filter(id => used.has(id)).length,
      matchedIds: [...matched].filter(id => used.has(id)),
      created: customs.length, unmatchedNames: [...new Set(customs.map(c => c._name))].sort(),
      names: namesOf(new Map([...names].filter(([, v]) => used.has(v.id))), new Set(customs.map(c => c.id))),
      ...extra,
    }
  }
  return { resolve, finish }
}

function liftosaurRoutines(o, { unit = 'kg', customEx = [], matches = null } = {}) {
  const R = routineResolver('Liftosaur', customEx, liftosaurMatchName, matches)
  const routines = []
  let skipped = 0, scripted = 0
  for (const p of o.programs) {
    const weeks = p?.planner?.weeks
    // Programs from before Liftosaur's planner (no text) are not read.
    if (!isObj(p) || !Array.isArray(weeks) || !weeks.length) { if (isObj(p)) skipped++; continue }
    const templates = new Map()
    ;(Array.isArray(weeks[0].days) ? weeks[0].days : []).forEach((d, i) => {
      const day = liftoscriptDay(d?.exerciseText, { unit, resolve: R.resolve, templates })
      skipped += day.skipped
      if (!day.ex.length) return
      scripted += day.ex.filter(e => e.note).length
      routines.push({
        importKey: 'liftosaur|' + str(p.id || p.name) + '|' + i,
        name: [str(p.name), str(d?.name) || `Day ${i + 1}`].filter(Boolean).join(' · ').slice(0, 80),
        emoji: 'figureStrength', ex: day.ex,
      })
    })
  }
  return R.finish('Liftosaur', routines, { skippedLines: skipped, scripted })
}

/* ---------------------------------------------------------------- Liftoff -- */
// Liftoff has no export of its own; the unofficial github.com/quantcli/liftoff-export-cli writes
// JSON: `workouts list --format json` an array of posts, `routines list --format json` the
// presets. Shapes: Post / ExerciseData / SetData in cmd/workouts.go, Preset in cmd/routines.go.
// exerciseTypes: WR weight and reps, BR bodyweight plus weight, AB assisted (inputOne is the
// assistance), WD weight and distance, DD distance (km) and seconds, ND seconds. The weight's unit
// is not in the file, so it is imported as written.
export const LIFTOFF = 'Liftoff (from liftoff-export-cli)'
const isLiftoffPost = p => isObj(p) && typeof p.startedAt === 'string' && Array.isArray(p.exerciseData)
const isLiftoffPreset = p => isObj(p) && typeof p.name === 'string' && Array.isArray(p.exerciseData) && p.startedAt === undefined

function liftoffValues(type, s) {
  const one = numOr(s?.inputOne), two = numOr(s?.inputTwo)
  switch (String(type || '').toUpperCase()) {
    case 'WR': case 'BR': case 'AB': return { weight: one, reps: Math.round(two) }
    case 'WD': return { weight: one, distanceKm: two }
    case 'DD': return { distanceKm: one, seconds: two }
    case 'ND': return { seconds: two }
    default: return null
  }
}

// "01 hours 06 minutes 01 seconds" (cmd/workouts.go parseDurationSeconds).
function liftoffDuration(p) {
  if (Number.isFinite(p.sessionDurationSeconds)) return p.sessionDurationSeconds
  const f = str(p.sessionDuration).toLowerCase().split(/\s+/)
  let total = 0
  for (let i = 0; i + 1 < f.length; i += 2) {
    const n = parseInt(f[i], 10), u = f[i + 1].replace(/s$/, '')
    if (!Number.isFinite(n)) return 0
    total += u === 'hour' ? n * 3600 : u === 'minute' || u === 'min' ? n * 60 : u === 'second' || u === 'sec' ? n : 0
  }
  return total
}

function parseLiftoffWorkouts(posts, opts) {
  const rows = []
  let skipped = 0
  for (const p of posts) {
    const startMs = Date.parse(p.startedAt)
    if (!Number.isFinite(startMs)) { skipped++; continue }
    const len = liftoffDuration(p)
    const start = localStamp(startMs), end = len > 0 ? localStamp(startMs + len * 1000) : ''
    for (const e of p.exerciseData) {
      const exercise = str(e?.exerciseName)
      if (!exercise || !Array.isArray(e.setsData)) { skipped++; continue }
      for (const s of e.setsData) {
        const v = liftoffValues(e.exerciseTypes, s)
        if (!v) { skipped++; continue }
        rows.push({ date: start, endTime: end, session: str(p.id) || p.startedAt, workoutNote: str(p.sessionNotes),
          exercise, setType: /warm/i.test(str(s?.setType)) ? 'warmup' : '', note: str(e.exerciseNotes), ...v })
      }
    }
  }
  if (!rows.length && skipped) return { error: 'format', app: 'Liftoff' }
  return workouts(rows, LIFTOFF, opts, skipped)
}

function parseLiftoffRoutines(presets, { customEx = [], matches = null } = {}) {
  const R = routineResolver(LIFTOFF, customEx, () => '', matches)
  const routines = []
  let skipped = 0
  for (const p of presets) {
    const ex = [], groups = new Map()
    for (const e of p.exerciseData) {
      const sets = Array.isArray(e?.setsData) ? e.setsData : []
      const work = sets.filter(s => !/warm/i.test(str(s?.setType)))
      const v = liftoffValues(e?.exerciseTypes, work[0] || sets[0])
      const id = v && R.resolve(e?.exerciseName)
      if (!id) { skipped++; continue }
      const n = Math.max(1, Math.min(20, work.length))
      const cfg = v.distanceKm > 0 && v.seconds > 0
        ? { id, sets: n, min: Math.round(v.seconds / 60 * 10) / 10, speed: Math.round(v.distanceKm / (v.seconds / 3600) * 10) / 10 }
        : v.seconds > 0 && !v.reps ? { id, sets: n, sec: Math.round(v.seconds), weight: 0, mode: 'time' }
          : { id, sets: n, reps: v.reps || 10, weight: roundWeight(v.weight || 0), mode: 'reps' }
      if (sets.length > work.length) cfg.warmupSets = Math.min(5, sets.length - work.length)
      if (str(e.exerciseNotes)) cfg.note = str(e.exerciseNotes).slice(0, 280)
      if (str(e.superset)) {
        if (!groups.has(str(e.superset))) groups.set(str(e.superset), 'lo' + uid())
        cfg.sg = groups.get(str(e.superset))
      }
      ex.push(cfg)
    }
    ex.forEach((e, i) => { if (e.sg && ex[i - 1]?.sg !== e.sg && ex[i + 1]?.sg !== e.sg) delete e.sg })
    if (ex.length) routines.push({ importKey: 'liftoff|' + (str(p.id) || p.name), name: str(p.name).slice(0, 80) || 'Imported', emoji: 'figureStrength', ex })
  }
  return R.finish(LIFTOFF, routines, { skippedLines: skipped })
}

/* ------------------------------------------------------------- StrongLifts -- */
// StrongLifts 5×5 (Settings → Export, support.stronglifts.com/article/131-export): one row per
// exercise, its sets in "Set N (Reps)" / "Set N (KG|LB)" column pairs. Header as read by LiftLog's
// importer (github.com/LiamMorrow/LiftLog, app/src/services/csv-import/stronglifts-csv.ts) and
// its real export fixtures: "Date (yyyy/mm/dd)", Workout (the session's number that day),
// "Workout Name", Exercise, "Start Time (h:mm)" ("10:56 PM"), Notes. A set with 0 reps was not done.
const isStrongLifts = head => head.includes('date yyyy mm dd') && head.includes('exercise') && head.some(h => /^set \d+ reps$/.test(h))

const clock12 = s => {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i.exec(str(s)) || /^(\d{1,2}):(\d{2})$/.exec(str(s))
  if (!m) return ''
  let h = +m[1]
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0)
  return h < 24 && +m[2] < 60 ? `${p2(h)}:${m[2]}` : ''
}

function parseStrongLifts(rows, opts) {
  const head = rows[0].map(norm)
  const col = n => head.indexOf(n)
  const c = { date: col('date yyyy mm dd'), no: col('workout'), name: col('workout name'), ex: col('exercise'), start: col('start time h mm'), end: col('end time h mm'), notes: col('notes') }
  const pairs = []
  head.forEach((h, i) => {
    const m = /^set (\d+) reps$/.exec(h)
    if (!m) return
    const w = head.findIndex(x => x === `set ${m[1]} kg` || x === `set ${m[1]} lb`)
    if (w >= 0) pairs.push({ reps: i, w, unit: head[w].endsWith('kg') ? KG : LB })
  })
  if (!pairs.length) return { error: 'format', app: 'StrongLifts' }
  const cell = (r, i) => (i < 0 ? '' : str(r[i]))
  const out = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    const day = cell(r, c.date).replace(/\//g, '-')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !cell(r, c.ex)) { skipped++; continue }
    const start = clock12(cell(r, c.start)), end = clock12(cell(r, c.end))
    const base = { date: start ? `${day} ${start}` : day, endTime: start && end >= start ? `${day} ${end}` : '',
      session: cell(r, c.no) || '1', workoutName: cell(r, c.name), exercise: cell(r, c.ex), note: cell(r, c.notes) }
    const before = out.length
    for (const p of pairs) {
      const reps = numOr(cell(r, p.reps))
      if (!(reps > 0)) continue
      out.push({ ...base, reps: Math.round(reps), weight: numOr(cell(r, p.w)), weightUnit: p.unit })
    }
    // Timed exercises ("Sets×Time") have no set columns this reader knows.
    if (out.length === before && !pairs.some(p => cell(r, p.reps) !== '')) skipped++
  }
  return workouts(out, 'StrongLifts', opts, skipped)
}

/* ----------------------------------------------------------------- Fitbod -- */
// Fitbod (Log → ⋯ → Export Data, WorkoutExport.csv): one row per set,
// "Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier",
// the date "2023-10-24 18:24:59 +0000" shared by a workout's rows; weight always in kg. Android
// users get a database extract from support instead: "date,exercise_name,Reps,weight_kg,
// duration_seconds,distance_meters,Incline,Resistance,isWarmup", a day without a time. Both as
// read by github.com/sinan92/fitbod-to-hevy-converter (src/app/converter/column-mapping.ts) and
// github.com/ethanopp/fitly (src/fitly/api/fitbodAPI.py).
const isFitbod = head => head.includes('iswarmup') && (head.includes('weight kg') || head.includes('weight_kg'))
  && head.includes('date') && (head.includes('exercise') || head.includes('exercise name'))

function parseFitbod(rows, opts) {
  const head = rows[0].map(norm)
  const col = (...ns) => { for (const n of ns) { const i = head.indexOf(n); if (i >= 0) return i } return -1 }
  const c = { date: col('date'), ex: col('exercise', 'exercise name'), reps: col('reps'), w: col('weight kg'), secs: col('duration s', 'duration seconds'),
    dist: col('distance m', 'distance meters'), incline: col('incline'), warm: col('iswarmup'), note: col('note') }
  const cell = (r, i) => (i < 0 ? '' : str(r[i]))
  const out = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    // The clock as written: Fitbod stamps the phone's own offset, which is the day the user saw.
    const when = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(cell(r, c.date))
    if (!when || !cell(r, c.ex)) { skipped++; continue }
    out.push({
      date: when[2] ? `${when[1]} ${when[2]}` : when[1], session: cell(r, c.date), exercise: cell(r, c.ex),
      reps: Math.round(numOr(cell(r, c.reps))), weight: roundWeight(numOr(cell(r, c.w))), weightUnit: KG,
      seconds: numOr(cell(r, c.secs)) || '', distanceKm: numOr(cell(r, c.dist)) / 1000 || '', incline: numOr(cell(r, c.incline)) || '',
      setType: cell(r, c.warm).toLowerCase() === 'true' ? 'warmup' : '', note: cell(r, c.note),
    })
  }
  return workouts(out, 'Fitbod', opts, skipped)
}

/* ------------------------------------------------------------------ JEFIT -- */
// JEFIT (jefit.com → Settings → Data Controls → Export Data): one file of "### NAME ###"
// sections, each a CSV with its own header. Read as github.com/sondrealf/JeFit2Hevy
// (python-script/converter.py) reads it: "### EXERCISE LOGS ###" has belongsession, ename,
// mydate (YYYY-MM-DD) and logs, the sets as "weight x reps" pairs ("60x10,65x8");
// "### WORKOUT SESSIONS ###" has _id, starttime (Unix seconds) and total_time (seconds). The
// weight's unit is not in the file, so it is imported as written.
const isJefit = text => /^\s*###\s*EXERCISE LOGS\s*###\s*$/im.test(text)

function jefitSections(text) {
  const out = new Map()
  let cur = null
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*###\s*(.*?)\s*###\s*$/.exec(line)
    if (m) { cur = []; out.set(m[1].toLowerCase(), cur); continue }
    if (cur && line.trim()) cur.push(line)
  }
  const tables = new Map()
  for (const [name, lines] of out) if (lines.length) tables.set(name, parseCSV(lines.join('\n')))
  return tables
}

function parseJefit(text, opts) {
  const sec = jefitSections(text)
  const logs = sec.get('exercise logs')
  const head = logs?.[0]?.map(norm) || []
  const c = { sess: head.indexOf('belongsession'), name: head.indexOf('ename'), date: head.indexOf('mydate'), logs: head.indexOf('logs') }
  if (!logs || c.name < 0 || c.date < 0 || c.logs < 0) return { error: 'format', app: 'JEFIT' }
  const sessions = new Map()
  const ss = sec.get('workout sessions')
  if (ss?.length > 1) {
    const h = ss[0].map(norm), id = h.indexOf('id'), st = h.indexOf('starttime'), tot = h.indexOf('total time')
    if (id >= 0 && st >= 0) for (const r of ss.slice(1)) sessions.set(str(r[id]), { start: numOr(r[st]) * 1000, len: tot >= 0 ? numOr(r[tot]) : 0 })
  }
  const out = []
  let skipped = 0
  for (const r of logs.slice(1)) {
    const day = str(r[c.date]), name = str(r[c.name]), sid = c.sess >= 0 ? str(r[c.sess]) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !name) { skipped++; continue }
    // The session's start sets the time only when it falls on the logged day here too.
    const s = sessions.get(sid)
    const at = s && s.start > 0 ? localStamp(s.start) : ''
    const date = at.slice(0, 10) === day ? at : day
    const endTime = date !== day && s.len > 0 ? localStamp(s.start + s.len * 1000) : ''
    for (const part of str(r[c.logs]).split(',')) {
      const m = /^\s*(\d+(?:\.\d+)?)?\s*x\s*(\d+)\s*$/i.exec(part)
      if (!m) { if (part.trim()) skipped++; continue }
      out.push({ date, endTime, session: sid || day, exercise: name, weight: m[1] ? +m[1] : 0, reps: +m[2] })
    }
  }
  return workouts(out, 'JEFIT', opts, skipped)
}

/* ------------------------------------------------------------------ sniff -- */

/**
 * Read any supported file: the apps above, else what lib/import-csv.js reads (Strong, Hevy,
 * FitNotes, Gravl, GymMane, our own CSV, Apple Health). Errors: 'empty', 'unrecognised',
 * 'opengym' (our own backup or plan file, which have imports of their own) and
 * { error: 'format', app } for a file that looks like an app's export but does not read as one.
 * A workouts result may carry `routines` (lib/import-apps.js mergeImportedRoutines).
 */
export function parseImportFile(text, opts = {}) {
  const s = String(text ?? '').replace(/^﻿/, '')
  if (!s.trim()) return { error: 'empty' }
  if (/^\s*[[{]/.test(s)) return parseJson(s, opts)
  if (isJefit(s)) return parseJefit(s, opts)
  if (!/^\s*</.test(s) && !s.includes('HKQuantityTypeIdentifier')) {
    const nl = s.search(/\r?\n/)
    const head = parseCSV(nl < 0 ? s : s.slice(0, nl))[0]?.map(norm) || []
    const app = isLiftosaurCsv(head) ? parseLiftosaurCsv : isStrongLifts(head) ? parseStrongLifts : isFitbod(head) ? parseFitbod : null
    if (app) {
      const rows = parseCSV(s)
      if (rows.length < 2) return { error: 'empty' }
      return app(rows, opts)
    }
  }
  return parseImport(s, opts)
}

function parseJson(s, opts) {
  let o
  try { o = JSON.parse(s) } catch { return { error: 'unrecognised' } }
  if (isLiftosaurJson(o)) return parseLiftosaurJson(o, opts)
  if (Array.isArray(o)) {
    if (!o.length) return { error: 'empty' }
    if (o.every(isLiftoffPost)) return parseLiftoffWorkouts(o, opts)
    if (o.every(isLiftoffPreset)) return routinesOnly(parseLiftoffRoutines(o, opts))
    return { error: 'unrecognised' }
  }
  if (isObj(o) && Array.isArray(o.folders) && Array.isArray(o.presetsWithoutFolder)) {
    const presets = [...o.presetsWithoutFolder, ...o.folders.flatMap(f => (Array.isArray(f?.presets) ? f.presets : []))].filter(isLiftoffPreset)
    return routinesOnly(parseLiftoffRoutines(presets, opts))
  }
  if (isObj(o) && (o.opengym_plan || (Array.isArray(o.workouts) && Array.isArray(o.routines)))) return { error: 'opengym' }
  return { error: 'unrecognised' }
}

// A file with plans and no history: an empty history beside them, so the summary has one shape.
const routinesOnly = r => ({
  kind: 'workouts', source: r.source, workouts: [], customEx: [], matched: 0, matchedSets: 0, created: 0, unmatchedNames: [],
  sets: 0, skipped: 0, warmups: 0, fileUnit: '', mixedUnits: false, converted: false, rpeSets: 0, rirSets: 0, from: null, to: null,
  routines: r,
})

/* ------------------------------------------------------------------ merge -- */

/**
 * Add imported routines to state. A routine an earlier import of the same plan already added is
 * left as it is (the user may have changed it since); custom exercises are shared by name with
 * the ones already here, as mergeImport does for history.
 */
export function mergeImportedRoutines(S, parsed) {
  S.customEx = S.customEx || []
  S.routines = S.routines || []
  const key = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const exIdMap = {}
  for (const c of parsed?.customEx || []) {
    const same = S.customEx.find(x => x && x.id !== c.id && key(x.n) === key(c.n))
    if (same) exIdMap[c.id] = same.id
    else if (!S.customEx.some(x => x?.id === c.id)) S.customEx.push(c)
  }
  let added = 0, skipped = 0
  for (const r of parsed?.routines || []) {
    if (S.routines.some(x => x?.importKey === r.importKey)) { skipped++; continue }
    S.routines.push({ id: uid(), name: r.name, emoji: r.emoji || 'figureStrength', importKey: r.importKey,
      ex: r.ex.map(e => ({ ...e, id: exIdMap[e.id] || e.id })) })
    added++
  }
  return { added, skipped }
}

/** How many of the file's routines are not in state yet (the summary's "new"). */
export const freshRoutines = (S, parsed) => (parsed?.routines || []).filter(r => !(S.routines || []).some(x => x?.importKey === r.importKey)).length
