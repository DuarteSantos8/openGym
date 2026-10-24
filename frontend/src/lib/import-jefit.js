// Import a Jefit export: workouts, routines and weigh-ins.
//
// Jefit's "Export data" file is not one CSV table. It is a run of sections, each opened by a line
// like `### EXERCISE LOGS ######` and closed by a line of `#`, and inside a section the records come
// as blank-line-separated blocks that carry their own header row. ROUTINES mixes three kinds of
// block (routine, routine day, routine exercise) and tells them apart only by their columns. So it
// gets a reader of its own rather than more header aliases in import-csv.js.
//
// Sections used here, from a real export (October 2026):
//   SETTING            mass (" kg" | " lb")
//   PROFILE            mydate, weight (0 = not recorded)
//   ROUTINES           routine: _id, name, dayaweek · day: _id, package, name, dayIndex ·
//                      exercise: exercise_id, belongSys, belongplan, exercisename, setcount,
//                      timer, targetrep ("8,8,8"), logs, mysort, bodypart
//   WORKOUT SESSIONS   _id, day_id, starttime, endtime (unix seconds)
//   EXERCISE LOGS      belongsession, eid, belongSys, ename, mydate, logs ("40x8,40x8,40x5,")
//   CUSTOM EXERCISES   _id, name, bodypart
//   NOTES              eid, belongSys, mynote, mydate
//
// An exercise is (belongSys, eid): belongSys 1 is Jefit's library, 0 a custom exercise whose eid
// is its CUSTOM EXERCISES _id. Jefit renamed exercises over the years, so the same id turns up
// under several names, sometimes an empty one; the id is the identity and the newest name wins.

import { EXIDX, canonicalExId } from './exercises.js'
import { uid } from './format.js'
import { isWarmupRow } from './workout-model.js'
import { bpFromName, importId, matchExercise, priorCustom } from './import-csv.js'

const LB_TO_KG = 0.45359237
// Past these a log is broken, not a record — the same limits the CSV importer applies.
const MAX_KG = 2000, MAX_REPS = 1000
const MAX_RESTORED_SETS = 10
const DAY = /^\d{4}-\d{2}-\d{2}$/
const p2 = n => String(n).padStart(2, '0')

/* ------------------------------------------------------------- reading ---- */

/** Rows of fields, honouring quotes (which may hold commas, quotes and newlines). A blank line
 *  comes back as an empty row, since it is what separates one block from the next. */
function csvRows(text) {
  const rows = []
  let row = [], field = '', quoted = false, started = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') { quoted = true; started = true }
    else if (c === ',') { row.push(field); field = ''; started = true }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      rows.push(started || field ? [...row, field] : [])
      row = []; field = ''; started = false
    } else { field += c; started = true }
  }
  if (started || field) rows.push([...row, field])
  return rows
}

/** Section name → blocks → records keyed by that block's header. No prototype on a record: its
 *  keys are the file's column names. */
function readSections(text) {
  const out = new Map()
  let current = null, header = null
  for (const fields of csvRows(String(text).replace(/^﻿/, ''))) {
    const first = (fields[0] || '').trim()
    if (fields.length === 1 && first.startsWith('###')) {
      const name = first.replace(/#/g, '').trim()
      current = name ? [] : null
      if (name) out.set(name, current)
      header = null
      continue
    }
    if (!fields.length || (fields.length === 1 && !first)) { header = null; continue }
    if (!current) continue
    if (!header) { header = fields.map(f => f.trim()); current.push([]); continue }
    const rec = Object.create(null)
    header.forEach((h, i) => { rec[h] = fields[i] ?? '' })
    current[current.length - 1].push(rec)
  }
  return out
}

/** Whether a file is a Jefit export — what importFromApp sniffs before the CSV readers. */
export function isJefitExport(text) {
  const s = String(text).slice(0, 1 << 20)
  return /^\s*#{3,}\s*EXERCISE LOGS\b/m.test(s) || (/^\s*#{3,}\s*SETTING\b/m.test(s) && /^\s*#{3,}\s*ROUTINES\b/m.test(s))
}

const num = v => { const n = Number(String(v ?? '').trim()); return isFinite(n) ? n : 0 }
const text = v => String(v ?? '').trim()
const keyOf = (sys, eid) => `${num(sys) === 0 ? 0 : 1}:${num(eid)}`

/**
 * "40x8,40x8,40x5," → sets of { w, r } in the file's unit. A log with fractional reps
 * ("0x0.0,0x10") is a cardio entry and gives none; so does a set with no reps. Weight 0 is a
 * bodyweight set and stays.
 */
export function parseJefitLogs(logs) {
  const entries = String(logs || '').split(',').map(e => e.trim()).filter(Boolean)
  if (entries.some(e => (e.split('x')[1] || '').includes('.'))) return []
  return entries.map(e => {
    const [w, r] = e.split('x')
    return { w: num(w), r: Math.round(num(r)) }
  }).filter(s => s.r > 0 && s.w >= 0)
}

/** The export as plain records, before anything is matched against the library. */
export function readJefitExport(input) {
  const all = readSections(input)
  const records = name => (all.get(name) || []).flat()
  if (!all.has('EXERCISE LOGS') && !all.has('ROUTINES')) return { error: 'unrecognised' }

  const setting = records('SETTING')[0] || {}
  const massUnit = text(setting.mass) === 'lb' ? 'lb' : 'kg'

  let skipped = 0
  const logs = []
  for (const r of records('EXERCISE LOGS')) {
    const sets = parseJefitLogs(r.logs)
    const date = text(r.mydate)
    if (!sets.length || !DAY.test(date)) { skipped++; continue }
    logs.push({ id: num(r._id), sessionId: num(r.belongsession), key: keyOf(r.belongSys, r.eid), name: text(r.ename), date, sets })
  }

  const sessions = new Map()
  for (const r of records('WORKOUT SESSIONS')) {
    const id = num(r._id)
    if (id) sessions.set(id, { id, dayId: num(r.day_id), start: num(r.starttime), end: num(r.endtime) })
  }

  // ROUTINES mixes three kinds of block; tell them apart by their columns.
  const routines = [], days = [], routineEx = []
  for (const block of all.get('ROUTINES') || []) {
    for (const r of block) {
      if ('belongplan' in r) {
        routineEx.push({
          dayId: num(r.belongplan), key: keyOf(r.belongSys, r.exercise_id), name: text(r.exercisename),
          sets: num(r.setcount), restSec: num(r.timer), sort: num(r.mysort),
          targetReps: text(r.targetrep).split(',').map(num).filter(n => n > 0).map(Math.round),
          last: parseJefitLogs(r.logs), bodypart: text(r.bodypart) === '' ? null : num(r.bodypart),
        })
      } else if ('package' in r) {
        days.push({ id: num(r._id), routineId: num(r.package), name: text(r.name), index: num(r.dayIndex) })
      } else if ('dayaweek' in r) {
        routines.push({ id: num(r._id), name: text(r.name) })
      }
    }
  }

  const customs = records('CUSTOM EXERCISES').map(r => ({
    key: `0:${num(r._id)}`, name: text(r.name), bodypart: text(r.bodypart) === '' ? null : num(r.bodypart),
  }))

  const weighIns = records('PROFILE')
    .map(r => ({ date: text(r.mydate), w: num(r.weight), t: num(r.logTime) }))
    .filter(m => DAY.test(m.date) && m.w > 0)

  const notes = records('NOTES')
    .map(r => ({ key: keyOf(r.belongSys, r.eid), date: text(r.mydate), text: text(r.mynote) }))
    .filter(n => n.text)

  return { massUnit, logs, sessions, routines, days, routineEx, customs, weighIns, notes, skipped }
}

/* ------------------------------------------------------------ exercises --- */

// Jefit's body part codes → the library's, for the exercises an import makes. The codes are
// inferred from the exercises they appear on; 11 is "other", which says nothing.
const JEFIT_BP = Object.assign(Object.create(null), {
  0: 'waist', 1: 'back', 2: 'upper arms', 3: 'chest', 4: 'lower arms', 5: 'upper legs',
  6: 'shoulders', 7: 'upper arms', 8: 'upper legs', 9: 'lower legs', 10: 'cardio',
})

/**
 * One resolver for workouts and routines, so an exercise is matched once and both point at the
 * same id: the user's own exercise when an earlier import made one (priorCustom), else a library
 * match on the newest name, else one custom exercise per Jefit id.
 */
function makeResolver(data, customEx) {
  const info = new Map()   // key → { name, date, bodypart }
  const touch = (key, name, date, bodypart) => {
    const row = info.get(key) || { name: '', date: '', bodypart: null }
    if (name && date >= row.date) { row.name = name; row.date = date }
    if (row.bodypart == null && bodypart != null) row.bodypart = bodypart
    info.set(key, row)
  }
  for (const c of data.customs) touch(c.key, c.name, '', c.bodypart)
  for (const e of data.routineEx) touch(e.key, e.name, '', e.bodypart)
  for (const l of data.logs) touch(l.key, l.name, l.date, null)

  const resolved = new Map(), created = new Map(), matchedIds = new Set()
  const resolve = key => {
    if (resolved.has(key)) return resolved.get(key)
    const row = info.get(key) || { name: '', bodypart: null }
    const name = row.name || 'Jefit exercise ' + key.split(':')[1]
    const cid = importId('im', 'Jefit|' + key)
    const own = priorCustom(customEx, cid, name)
    let id = own ? own.id : canonicalExId(matchExercise(name))
    if (id && !own && EXIDX[id]) matchedIds.add(id)
    if (!id || (!own && !EXIDX[id])) {
      created.set(cid, {
        id: cid, n: name.toLowerCase(), custom: true, eq: 'custom', tg: '', desc: '',
        bp: JEFIT_BP[row.bodypart] || bpFromName(name.toLowerCase()) || 'upper legs',
      })
      id = cid
    }
    resolved.set(key, id)
    return id
  }
  const kept = used => [...created.values()].filter(c => used.has(c.id))
  return {
    resolve,
    customEx: used => kept(used),
    unmatchedNames: used => [...new Set(kept(used).map(c => c.n))].sort(),
    matchedCount: used => [...matchedIds].filter(id => used.has(id)).length,
  }
}

const converter = (from, to) => w => {
  if (from === to) return Math.round(w * 100) / 100
  return Math.round((from === 'lb' ? w * LB_TO_KG : w / LB_TO_KG) * 10) / 10
}

/** Local calendar day and ms since midnight of a unix-seconds time, or null. */
function localWhen(sec) {
  if (!(sec > 0)) return null
  const d = new Date(sec * 1000)
  return { d: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, t: d.getHours() * 3600000 + d.getMinutes() * 60000 + d.getSeconds() * 1000 }
}

/* ------------------------------------------------------------- workouts --- */

/**
 * Jefit's logs as workouts in the shape mergeImport takes. One workout per Jefit session; a log
 * whose session is missing from the file joins the others of its day.
 */
function jefitWorkouts(data, R, unit) {
  const conv = converter(data.massUnit, unit)
  const maxW = data.massUnit === 'lb' ? MAX_KG / LB_TO_KG : MAX_KG
  const dayName = new Map(data.days.map(d => [d.id, d.name]))
  const notes = new Map()  // date|key → [text]
  for (const n of data.notes) {
    const k = n.date + '|' + n.key
    notes.set(k, [...(notes.get(k) || []), n.text])
  }

  const groups = new Map()
  let sets = 0, skipped = data.skipped, matchedSets = 0
  for (const log of [...data.logs].sort((a, b) => a.id - b.id)) {
    const session = data.sessions.get(log.sessionId)
    const gk = session ? 's' + session.id : 'd' + log.date
    let g = groups.get(gk)
    if (!g) {
      // The session's own clock when it has one; Jefit's date otherwise, at the same 18:00 the
      // CSV importer files a time-less workout under.
      const start = session && localWhen(session.start)
      const d = start ? start.d : log.date
      const base = new Date(d + 'T00:00:00').getTime()
      const startMs = start ? base + start.t : base + 18 * 3600000
      const endMs = session && session.end > session.start ? session.end * 1000 : startMs
      g = { key: gk, d, start: startMs, end: endMs, name: (session && dayName.get(session.dayId)) || '', ex: new Map() }
      groups.set(gk, g)
    }
    const good = log.sets.filter(s => s.w <= maxW && s.r <= MAX_REPS)
    skipped += log.sets.length - good.length
    if (!good.length) continue
    const id = R.resolve(log.key)
    const entry = g.ex.get(id) || { sets: [], keys: new Set() }
    entry.keys.add(log.key)
    for (const s of good) entry.sets.push({ w: conv(s.w), r: s.r, done: true })
    if (!String(id).startsWith('im')) matchedSets += good.length
    sets += good.length
    g.ex.set(id, entry)
  }

  const workouts = [...groups.values()].filter(g => g.ex.size)
    .sort((a, b) => (a.d === b.d ? a.start - b.start : a.d < b.d ? -1 : 1))
    .map(g => {
      const entries = [...g.ex.entries()].map(([id, e]) => {
        const mx = Math.max(0, ...e.sets.filter(s => !isWarmupRow(s)).map(s => s.w || 0))
        const note = [...e.keys].flatMap(k => notes.get(g.d + '|' + k) || []).join(' · ').slice(0, 280)
        return { id, sets: e.sets, topW: mx || null, ...(note ? { note } : {}) }
      })
      const w = {
        // From the Jefit session, so the same export imported on two devices merges into one.
        id: importId('iw', 'Jefit|' + g.key), d: g.d, start: g.start, end: g.end > g.start ? g.end : g.start,
        routineId: null, name: g.name || 'Imported', entries, prs: [],
      }
      w.vol = entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.w || 0) * (s.r || 0), 0), 0)
      return w
    })
  return { workouts, sets, skipped, matchedSets }
}

/* ------------------------------------------------------------- routines --- */

/**
 * One openGym routine per Jefit routine day ("Upper, Lower · Upper"). Sets and rest come from
 * the day; the weight from the last time it was logged there. Target reps that are all the same
 * are sets × reps; ones that differ ("12,10,8") are the pyramid Jefit prescribed.
 */
function jefitRoutines(data, R, unit) {
  const conv = converter(data.massUnit, unit)
  const out = []
  for (const routine of data.routines) {
    const days = data.days.filter(d => d.routineId === routine.id).sort((a, b) => a.index - b.index)
    days.forEach((day, i) => {
      const ex = data.routineEx.filter(e => e.dayId === day.id).sort((a, b) => a.sort - b.sort).map(e => {
        const targets = e.targetReps.slice(0, MAX_RESTORED_SETS)
        const sets = Math.max(1, Math.min(MAX_RESTORED_SETS, Math.round(e.sets) || targets.length || 3))
        const weight = e.last.length ? conv(Math.max(...e.last.map(s => s.w))) : 0
        const cfg = { id: R.resolve(e.key), sets, reps: targets.length ? Math.max(...targets) : 10, weight, mode: 'reps' }
        if (targets.length > 1 && new Set(targets).size > 1) { cfg.pyramid = targets; cfg.sets = targets.length }
        if (e.restSec > 0) cfg.restSec = Math.round(e.restSec)
        return cfg
      })
      if (!ex.length) return
      const dayLabel = day.name || 'Day ' + (i + 1)
      const name = days.length > 1 && routine.name ? routine.name + ' · ' + dayLabel : routine.name || dayLabel
      out.push({ jefitId: routine.id + ':' + day.id, name: name.slice(0, 80), emoji: 'figureStrength', ex })
    })
  }
  return out
}

/** Merge Jefit routines into state. A routine an earlier import brought (same Jefit day) is
 *  replaced in place, so importing the export twice does not double the plan. */
export function mergeJefitRoutines(S, parsed) {
  S.customEx = S.customEx || []
  S.routines = S.routines || []
  const known = new Set(S.customEx.map(c => c && c.id))
  for (const c of parsed.customEx || []) if (!known.has(c.id)) { S.customEx.push(c); known.add(c.id) }
  let added = 0, updated = 0
  for (const r of parsed.routines || []) {
    const existing = S.routines.find(x => x.jefitId === r.jefitId)
    if (existing) { existing.name = r.name; existing.ex = r.ex; updated++; continue }
    S.routines.push({ id: uid(), name: r.name, emoji: r.emoji, jefitId: r.jefitId, ex: r.ex })
    added++
  }
  return { added, updated }
}

/* ---------------------------------------------------------- body weight --- */

function jefitBodyweight(data, unit) {
  const conv = converter(data.massUnit, unit)
  const out = new Map()
  for (const m of data.weighIns) {
    const t = m.t > 0 ? m.t * 1000 : new Date(m.date + 'T12:00:00').getTime()
    out.set(m.date, { d: m.date, w: Math.round(conv(m.w) * 10) / 10, t })
  }
  const dates = [...out.keys()].sort()
  return dates.map(d => out.get(d))
}

/* ---------------------------------------------------------------- entry --- */

/**
 * Read a Jefit export into `{ workouts, routines, bodyweight }`: workouts and weigh-ins in the
 * shapes mergeImport takes, routines for mergeJefitRoutines. Nothing here touches state.
 * `customEx`: the custom exercises already in state.
 */
export function parseJefitExport(input, { unit = 'kg', customEx = [] } = {}) {
  const data = readJefitExport(input)
  if (data.error) return data
  const R = makeResolver(data, customEx)
  const w = jefitWorkouts(data, R, unit)
  const routines = jefitRoutines(data, R, unit)
  const bodyweight = jefitBodyweight(data, unit)
  const usedW = new Set(w.workouts.flatMap(x => x.entries.map(e => e.id)))
  const usedR = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const dates = w.workouts.map(x => x.d)
  const converted = data.massUnit !== unit
  return {
    workouts: {
      kind: 'workouts', source: 'Jefit', workouts: w.workouts, customEx: R.customEx(usedW),
      matched: R.matchedCount(usedW), matchedSets: w.matchedSets, created: R.customEx(usedW).length,
      unmatchedNames: R.unmatchedNames(usedW), sets: w.sets, skipped: w.skipped, warmups: 0,
      fileUnit: data.massUnit, mixedUnits: false, converted, rpeSets: 0, rirSets: 0,
      from: dates[0] || null, to: dates[dates.length - 1] || null,
    },
    routines: {
      kind: 'routines', source: 'Jefit', routines, customEx: R.customEx(usedR),
      matched: R.matchedCount(usedR), created: R.customEx(usedR).length, unmatchedNames: R.unmatchedNames(usedR),
      exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0), converted,
    },
    bodyweight: {
      kind: 'bodyweight', source: 'Jefit', bodyweight, fileUnit: data.massUnit, converted,
      from: bodyweight[0]?.d || null, to: bodyweight[bodyweight.length - 1]?.d || null,
    },
  }
}
