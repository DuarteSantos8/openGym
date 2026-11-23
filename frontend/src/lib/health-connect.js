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
import { readingsOf, readingAt, cleanTime } from './weigh-ins.js'
import { EXIDX } from './exercises.js'
import { activeKcal, bodyKgFor } from './active-energy.js'
import { workoutSegments } from './health-segments.js'

const LB_PER_KG = 2.2046226218
// Health Connect refuses a title or notes over 1000 characters (ExerciseSessionRecord).
export const TEXT_MAX = 1000

// What Apple Health and Health Connect take (v1.4.5). HealthKit raises an exception the app cannot
// catch for a sample it will not take, and the iPhone app died at every launch on a workout left
// open for more than a day (its calories over that stretch, TestFlight 59); Health Connect throws
// for a record outside its ranges and fails the whole insert with it. So nothing goes out that
// either would refuse, and the native side checks the same rules again (HealthWriteCore.swift,
// HealthWrite.java), each record on its own:
//   a workout     an id, a start from 2001 on (HealthKit's epoch), an end after it and no more than
//                 a day ahead of this phone's clock (another device's clock may run ahead; a record
//                 further ahead waits until then); longer than MAX_SESSION_MS it is not written
//   calories      and the sets as segments, only for a workout of at most ENERGY_SPAN_MS: a longer
//                 one (forgotten, left running overnight) is written with its real start and end,
//                 as the log has it, but without them, the same on both phones
//   a weigh-in    a time from 2001 on (at most a day ahead) and 0 < kg < MAX_KG
export const EPOCH_MS = 978307200000
export const DAY_MS = 24 * 3600e3
export const MAX_SESSION_MS = 7 * DAY_MS
export const ENERGY_SPAN_MS = DAY_MS
export const MAX_KCAL = 20000
export const MAX_KG = 1000
export const FUTURE_SLACK_MS = DAY_MS

/** Whether a time (ms) is one both health stores take: finite, 2001 or later, not far ahead. */
export const healthTime = (t, now = Date.now()) => Number.isFinite(t) && t >= EPOCH_MS && t <= now + FUTURE_SLACK_MS

// The session type Health Connect (and Apple Health) files a workout under. A workout with any
// strength work in it is strength training: ten minutes on the treadmill before the squats do not
// make it a walk. One that is all cardio takes the type of what was done when the catalogue says
// (the machine, else the move's name: a run, a row, burpees and jacks as HIIT), stretching at the
// end of a run leaves it a run, and cardio of two kinds is mixed cardio (#799).
// The native side maps each name to its ExerciseSessionRecord.EXERCISE_TYPE_* constant, and to an
// HKWorkoutActivityType on the iPhone and the watch (AppleHealthPlugin, WorkoutManager).
const CARDIO_TYPES = {
  '3666': 'walking',                // walking on incline treadmill
  '0685': 'running', '0684': 'running', '3656': 'running',
  '2138': 'biking_stationary', '0798': 'biking_stationary',
  '2141': 'elliptical', '2331': 'elliptical',
  '2311': 'stair_climbing_machine',
}
export const SESSION_TYPES = ['strength_training', 'walking', 'running', 'biking_stationary', 'biking', 'elliptical', 'stair_climbing_machine',
  'rowing', 'jump_rope', 'hiit', 'mixed_cardio', 'yoga', 'flexibility', 'other_workout']

// Catalogue cardio by its name, first match wins: the treadmill before the bike ("run on treadmill"
// is filed with the stationary bike), the bike before the run ("assault bike run").
const BY_NAME = [
  [/treadmill/, n => (/walk/.test(n) ? 'walking' : 'running')],
  [/\b(bike|bicycle|cycl\w*|aquabike)\b/, (n, ex) => (ex.eq === 'stationary bike' ? 'biking_stationary' : 'biking')],
  [/jump rope|skip rope|\bskipping\b/, () => 'jump_rope'],
  [/\brow(ing)?\b/, () => 'rowing'],
  [/\b(walk\w*|marching)\b/, () => 'walking'],
  [/\b(run|running|jog|sprints?|trot)\b/, () => 'running'],
  [/burpee|jacks?\b|mountain climber|squat thrust|battling rope|tuck jump|star jump|hiit|circuit|tabata/, () => 'hiit'],
]
const CARDIO_EQ = { 'elliptical machine': 'elliptical', 'stepmill machine': 'stair_climbing_machine' }

/** What one exercise counts as for the session type: one of SESSION_TYPES. */
export function exerciseType(entry) {
  const id = String(entry?.id ?? '')
  if (CARDIO_TYPES[id]) return CARDIO_TYPES[id]
  const ex = EXIDX[id]
  if (ex?.cat === 'yoga') return 'yoga'
  if (ex?.cat === 'stretching' || ex?.cat === 'mobility') return 'flexibility'
  // Cardio by the catalogue, whether it is logged as minutes or as reps (burpees count reps, #717).
  if (ex && (ex.cat === 'cardio' || ex.cat === 'plyometrics' || ex.bp === 'cardio')) {
    if (CARDIO_EQ[ex.eq]) return CARDIO_EQ[ex.eq]
    const n = String(ex.n || '').toLowerCase()
    const hit = BY_NAME.find(([re]) => re.test(n))
    return hit ? hit[1](n, ex) : 'mixed_cardio'
  }
  // A custom exercise logged as cardio: nothing says which.
  return modeForEntry(entry) === 'cardio' ? 'other_workout' : 'strength_training'
}

const CALM = new Set(['yoga', 'flexibility'])

function typeOf(entries) {
  if (!entries.length) return 'other_workout'
  const types = new Set(entries.map(exerciseType))
  if (types.has('strength_training')) return 'strength_training'
  // The stretches after a run or a row: still that run. Only stretching: yoga if any yoga.
  const moving = [...types].filter(x => !CALM.has(x))
  if (!moving.length) return types.has('yoga') ? 'yoga' : 'flexibility'
  if (moving.length === 1) return moving[0]
  // Two kinds of cardio, or cardio the catalogue does not place next to one it does.
  return moving.includes('other_workout') ? 'other_workout' : 'mixed_cardio'
}

/** The type of a finished workout, from the exercises with something done in them. */
export function sessionType(w) {
  return typeOf((w?.entries || []).filter(e => (e.sets || []).some(hasCompletedWork)))
}

/**
 * The type a workout is set to be, before anything is done (the watch's workout session, #799).
 * Null for one with nothing in it yet: the watch keeps its strength training then.
 */
export function plannedType(entries) {
  const planned = (entries || []).filter(e => e && e.id != null)
  return planned.length ? typeOf(planned) : null
}

// Cut to TEXT_MAX, never through a surrogate pair (an emoji in a long title).
const clip = s => {
  if (s.length <= TEXT_MAX) return s
  const n = /[\uD800-\uDBFF]/.test(s[TEXT_MAX - 2]) ? TEXT_MAX - 2 : TEXT_MAX - 1
  return s.slice(0, n) + '…'
}

// The exercises and sets as "Copy as text" writes them, without its heading: the title already
// carries the name, and Health Connect shows the date and the duration itself.
function sessionNotes(w, opts) {
  const blocks = workoutText(w, opts).split('\n\n').slice(1)
  return clip(blocks.join('\n\n'))
}

/**
 * One exercise session per finished workout. A workout with no start or end (or an end not after
 * its start) is left out rather than given made-up times: Health Connect needs both. So is one the
 * stores would refuse (see EPOCH_MS above): before 2001, ahead of the clock, longer than a week.
 */
export function sessionRecord(w, { unit, nameOf, speedUnit, kg = null, segments = false, customEx = [], now = Date.now() }) {
  const start = Number(w?.start), end = Number(w?.end)
  if (!w?.id || !healthTime(start, now) || !healthTime(end, now) || !(end > start) || end - start > MAX_SESSION_MS) return null
  const long = end - start > ENERGY_SPAN_MS
  const rec = {
    id: 'opengym-w-' + w.id,
    start, end,
    type: sessionType(w),
    title: clip(String(w.name || '').trim()),
    notes: sessionNotes(w, { unit, nameOf, speedUnit }),
  }
  // The active calories, only when the hub lets openGym write them: `kg` is then the body weight.
  // A Wear OS watch's (`w.kcal`, #724) are Health Services' total, so the resting burn comes off
  // (1 kcal per kg per hour, the 1 MET the estimate leaves out too); none left, the estimate
  // (lib/active-energy.js). A workout longer than a day: no calories (nor segments), see ENERGY_SPAN_MS.
  const measured = Math.round(Number(w.kcal) - kg * (end - start) / 3600e3)
  const kcal = !(kg > 0) || long ? null : measured > 0 ? measured : activeKcal(w, kg)
  if (Number.isFinite(kcal) && kcal > 0 && kcal <= MAX_KCAL) rec.kcal = kcal
  // Health Connect (Android) takes the sets as segments of a strength session (lib/health-segments.js).
  // Only there: Apple Health has no such thing, and an iPhone's records stay as they were written.
  if (segments && !long && rec.type === 'strength_training') {
    const seg = workoutSegments(w, customEx)
    if (seg.length) rec.segments = seg
  }
  return rec
}

/**
 * One weight record per weigh-in. A day from before has one, without a time: `t` is when it was
 * typed, which for a weigh-in added to an earlier day is not on that day; then it is put at 08:00
 * local time on the day it belongs to. A weigh-in with a time (#859, lib/weigh-ins.js) goes in at
 * that time. The record of a day's reading '0' (every day from before) keeps the day's old id, so
 * nothing written earlier is written twice; the others are named by day and reading.
 */
export function weightRecord(b, unit, r = null, now = Date.now()) {
  const w = Number(r ? r.w : b?.w)
  if (!b?.d || !(w > 0) || !Number.isFinite(w)) return null
  const typed = Number(r ? r.t : b.t)
  const at = r && cleanTime(r.at)
  const time = at ? readingAt(b.d, at) : typed > 0 && isoOf(new Date(typed)) === b.d ? typed : localMorning(b.d)
  if (!healthTime(time, now)) return null
  const kg = Math.round((unit === 'lb' ? w / LB_PER_KG : w) * 1000) / 1000
  // A typo (8000 kg) is the user's to fix in the log; the stores take none of it.
  if (!(kg > 0 && kg < MAX_KG)) return null
  return { id: weightRecordId(b.d, r?.id), time, kg }
}

/** The hub's id of one weigh-in openGym wrote: its day, and its reading unless that is '0'. */
export const weightRecordId = (d, rid) => 'opengym-bw-' + d + (rid != null && String(rid) !== '0' ? '-' + rid : '')

function localMorning(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return NaN
  return new Date(y, m - 1, d, 8, 0, 0, 0).getTime()
}

// A workout brought in from another app's export (lib/import-csv.js and lib/import-hevy.js name
// every one 'iw' + a hash of its content; the app's own ids are a timestamp, which has not begun
// with 'iw' since 2016). That app was there when it was done, and most of them wrote it to Apple
// Health or Health Connect already: written again, every past workout was there twice (#881).
// Treated like an imported weigh-in, then: never written, and a copy written before is taken out.
export const isImportedWorkout = w => w?.src === 'import' || /^iw[0-9a-z]+$/.test(String(w?.id || ''))

/** Everything the state has to give Health Connect: { sessions, weights }. */
export function healthRecords(S, { nameOf, speedUnit, kcal = false, segments = false, now = Date.now() }) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  // `kcal`: the hub allows active energy, so every session carries its estimate. A change of that
  // permission changes the records, so the next sync writes them all again, with or without.
  return {
    sessions: (S?.workouts || []).filter(w => !isImportedWorkout(w))
      .map(w => sessionRecord(w, { unit, nameOf, speedUnit, kg: kcal ? bodyKgFor(S, w) : null, segments, customEx: S?.customEx, now })).filter(Boolean),
    // A weigh-in read from the hub (`src`, lib/health-read.js) is already there: never written back.
    // Every weigh-in of a day with several (lib/weigh-ins.js), each at its own time.
    weights: (S?.bodyweight || []).flatMap(b => (Array.isArray(b?.ins)
      ? readingsOf(b).filter(r => !r.src).map(r => weightRecord(b, unit, r, now))
      : b?.src ? [] : [weightRecord(b, unit, null, now)])).filter(Boolean),
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
 * The record ids openGym has on record as deleted: a workout or a weigh-in day removed on this
 * device or on another one whose removal synced in (S.deleted, lib/sync-merge.js stampDeletions;
 * a negative stamp is an add-back), and everything a "Reset everything" wiped (S.resetIds).
 * Only these are taken out of Health: a copy that merely lacks a workout (signed out, a guest
 * copy, a state not loaded yet) never empties Apple Health or Health Connect.
 */
export function goneIds(S) {
  const out = new Set()
  const del = S?.deleted && typeof S.deleted === 'object' ? S.deleted : {}
  for (const [k, at] of Object.entries(del.workouts || {})) if (Number(at) > 0) out.add('opengym-w-' + k)
  // The copies of imported workouts written before #881: openGym's own, so they go again (the
  // other app's copy, the original, stays).
  for (const w of S?.workouts || []) if (isImportedWorkout(w)) out.add('opengym-w-' + w.id)
  // A removed day takes all its weigh-ins with it (planSync matches the `*`); one weigh-in
  // removed from a day that keeps others is on record in that day's `gone`.
  for (const [k, at] of Object.entries(del.bodyweight || {})) if (Number(at) > 0) { out.add('opengym-bw-' + k); out.add('opengym-bw-' + k + '-*') }
  for (const b of S?.bodyweight || []) {
    if (!b?.d || !b.gone || typeof b.gone !== 'object') continue
    for (const [rid, at] of Object.entries(b.gone)) if (Number(at) > 0) out.add(weightRecordId(b.d, rid))
  }
  const reset = S?.resetIds && typeof S.resetIds === 'object' ? S.resetIds : {}
  for (const k of Array.isArray(reset.workouts) ? reset.workouts : []) out.add('opengym-w-' + k)
  // A weigh-in is named by its day and time there ("2026-09-17|1758…"); Health knows it by day.
  for (const k of Array.isArray(reset.bodyweight) ? reset.bodyweight : []) { const d = String(k).split('|')[0]; out.add('opengym-bw-' + d); out.add('opengym-bw-' + d + '-*') }
  return out
}

/**
 * What a sync has to do, given the records now and `written`, what this phone wrote before
 * ({ [id]: { k: 'session' | 'weight', h: recordKey } }). New and changed records are written,
 * records that are gone from openGym (a deleted workout, a removed weigh-in) are removed.
 * With `gone` (goneIds), only a record on record as deleted is removed; one that is merely
 * missing stays written, and goes once its deletion arrives. Returns { sessions, weights,
 * remove: { sessions: [id], weights: [id] }, written } — `written` being what the phone has
 * written once the sync went through.
 */
export function planSync({ sessions, weights }, written = {}, gone = null) {
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
    if (gone && !isGone(gone, id)) { next[id] = was; continue }
    if (was?.k === 'session') out.remove.sessions.push(id)
    else if (was?.k === 'weight') out.remove.weights.push(id)
  }
  out.written = next
  return out
}

// Whether a written record is on record as deleted: by its own id, or as a weigh-in of a removed
// day ('opengym-bw-<day>-<reading>' under that day's 'opengym-bw-<day>-*').
const isGone = (gone, id) => gone.has(id) || (/^opengym-bw-\d{4}-\d{2}-\d{2}-/.test(id) && gone.has(id.slice(0, 21) + '-*'))

/** Every record this phone wrote, by type — what "remove what openGym wrote" takes away. */
export function writtenIds(written = {}) {
  const out = { sessions: [], weights: [] }
  for (const [id, was] of Object.entries(written || {})) {
    if (was?.k === 'session') out.sessions.push(id)
    else if (was?.k === 'weight') out.weights.push(id)
  }
  return out
}
