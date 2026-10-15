// What the Android app writes to Health Connect (#200), worked out from the state alone. Health
// Connect is the phone's own store for health data: other apps read the workouts and weigh-ins from
// there. Nothing here talks to it — lib/health-sync.js hands these records to the native plugin.
//
// Write-only, and only on request: the user turns it on in Settings, on each phone. Every record
// carries a client id of its own (a workout's id, a weigh-in's day), so writing it again replaces
// it instead of adding a second one, and anything openGym wrote can be found and removed again.
import { workoutText } from './workout-text.js'
import { modeForEntry, hasCompletedWork } from './workout-model.js'
import { isoOf } from './format.js'

const LB_PER_KG = 2.2046226218
// Health Connect refuses a title or notes over 1000 characters (ExerciseSessionRecord).
export const TEXT_MAX = 1000

// The session type Health Connect files a workout under. A workout with any strength work in it is
// strength training: ten minutes on the treadmill before the squats do not make it a walk. One that
// is all cardio takes the machine's type when the catalogue says which machine it is, and "other"
// when it does not (a custom exercise, burpees, cardio on two different machines).
// The native side maps each name to its ExerciseSessionRecord.EXERCISE_TYPE_* constant.
const CARDIO_TYPES = {
  '3666': 'walking',                // walking on incline treadmill
  '0685': 'running', '0684': 'running', '3656': 'running',
  '2138': 'biking_stationary', '0798': 'biking_stationary',
  '2141': 'elliptical', '2331': 'elliptical',
  '2311': 'stair_climbing_machine',
}
export const SESSION_TYPES = ['strength_training', 'walking', 'running', 'biking_stationary', 'elliptical', 'stair_climbing_machine', 'other_workout']

export function sessionType(w) {
  const done = (w?.entries || []).filter(e => (e.sets || []).some(hasCompletedWork))
  if (!done.length) return 'other_workout'
  if (done.some(e => modeForEntry(e) !== 'cardio')) return 'strength_training'
  const types = new Set(done.map(e => CARDIO_TYPES[e.id] || 'other_workout'))
  return types.size === 1 ? [...types][0] : 'other_workout'
}

const clip = s => (s.length > TEXT_MAX ? s.slice(0, TEXT_MAX - 1) + '…' : s)

// The exercises and sets as "Copy as text" writes them, without its heading: the title already
// carries the name, and Health Connect shows the date and the duration itself.
function sessionNotes(w, opts) {
  const blocks = workoutText(w, opts).split('\n\n').slice(1)
  return clip(blocks.join('\n\n'))
}

/**
 * One exercise session per finished workout. A workout with no start or end (or an end not after
 * its start) is left out rather than given made-up times: Health Connect needs both.
 */
export function sessionRecord(w, { unit, nameOf, speedUnit }) {
  const start = Number(w?.start), end = Number(w?.end)
  if (!w?.id || !(start > 0) || !(end > start)) return null
  return {
    id: 'opengym-w-' + w.id,
    start, end,
    type: sessionType(w),
    title: clip(String(w.name || '').trim()),
    notes: sessionNotes(w, { unit, nameOf, speedUnit }),
  }
}

/**
 * One weight record per weigh-in day. `t` is when it was typed, which for a weigh-in added to an
 * earlier day is not on that day; then it is put at 08:00 local time on the day it belongs to.
 */
export function weightRecord(b, unit) {
  const w = Number(b?.w)
  if (!b?.d || !(w > 0)) return null
  const typed = Number(b.t)
  const time = typed > 0 && isoOf(new Date(typed)) === b.d ? typed : localMorning(b.d)
  if (!(time > 0)) return null
  const kg = unit === 'lb' ? w / LB_PER_KG : w
  return { id: 'opengym-bw-' + b.d, time, kg: Math.round(kg * 1000) / 1000 }
}

function localMorning(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return NaN
  return new Date(y, m - 1, d, 8, 0, 0, 0).getTime()
}

/** Everything the state has to give Health Connect: { sessions, weights }. */
export function healthRecords(S, { nameOf, speedUnit }) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  return {
    sessions: (S?.workouts || []).map(w => sessionRecord(w, { unit, nameOf, speedUnit })).filter(Boolean),
    weights: (S?.bodyweight || []).map(b => weightRecord(b, unit)).filter(Boolean),
  }
}

// A record's content as a short fingerprint, to tell a changed record from one already written as
// it is. Key order is fixed by the builders above, so the same record always gives the same one.
// cyrb53: 53 bits are plenty to tell two versions of one record apart, and the file that keeps a
// fingerprint per record stays small next to a history of hundreds of workouts with their notes.
export function recordKey(rec) {
  const str = JSON.stringify(rec)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * What a sync has to do, given the records now and `written`, what this phone wrote before
 * ({ [id]: { k: 'session' | 'weight', h: recordKey } }). New and changed records are written,
 * records that are gone from openGym (a deleted workout, a removed weigh-in) are removed.
 * Returns { sessions, weights, remove: { sessions: [id], weights: [id] }, written } — `written`
 * being what the phone has written once the sync went through.
 */
export function planSync({ sessions, weights }, written = {}) {
  const next = {}
  const out = { sessions: [], weights: [], remove: { sessions: [], weights: [] } }
  const take = (list, k, into) => {
    for (const rec of list) {
      if (next[rec.id]) continue   // two workouts with one id: the first is the one written
      const h = recordKey(rec)
      next[rec.id] = { k, h }
      if (written[rec.id]?.h !== h) into.push(rec)
    }
  }
  take(sessions, 'session', out.sessions)
  take(weights, 'weight', out.weights)
  for (const [id, was] of Object.entries(written || {})) {
    if (next[id]) continue
    if (was?.k === 'session') out.remove.sessions.push(id)
    else if (was?.k === 'weight') out.remove.weights.push(id)
  }
  out.written = next
  return out
}

/** Every record this phone wrote, by type — what "remove what openGym wrote" takes away. */
export function writtenIds(written = {}) {
  const out = { sessions: [], weights: [] }
  for (const [id, was] of Object.entries(written || {})) {
    if (was?.k === 'session') out.sessions.push(id)
    else if (was?.k === 'weight') out.weights.push(id)
  }
  return out
}
