// A session described rather than tapped through ("dumbbell curls, 12 kg, 12/12/10") turned into
// the workout the app would have saved had it been logged on the phone. Written for the MCP
// server's log_workout tool, which hands it a structured description an LLM read out of what the
// user said, and kept here, pure and beside its test, because it decides what lands in the history.
//
// It follows the finish sheet (sheets.jsx finishWorkout) step for step, not the CSV importer: one
// session someone just did is the app's own kind of workout, so a session logged for today gets
// its PR badges and moves the confirmed weights the way Finish does, and one logged into the past
// is a backfill — badges held against the history around it (rebuildPrHistory), confirmed weights
// left alone. A common name resolves the way an import resolves it, to the catalogue's default
// variant ("shoulder press" is the barbell one), and the reply says which; what it does not do is
// pick between names the catalogue spells alike or invent an exercise: those come back as a
// problem to put to the user instead of a workout filed under the wrong lift.
import { EXIDX, canonicalExId, betterWeight, beatsWeight, isCardio } from './exercises.js'
import { exerciseCandidates, importId, bpFromName } from './import-csv.js'
import { bestWeightFor, bestWeightForEntry, workoutVolume, EFFORT } from './history.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { withMeaning, entryDbLoad } from './dumbbells.js'
import { isWarmupRow } from './workout-model.js'
import { insertChronological, backfillStart } from './backfill.js'
import { rebuildPrHistory } from './workout-date.js'
import { stampWorkout } from './sync-merge.js'
import { exerciseMuscleSnapshot } from './muscles.js'

const LB_TO_KG = 0.45359237
// The importer's bounds (import-csv.js MAX_KG / MAX_REPS): nobody lifts 2 t or does 1,000 reps.
export const LOG_LIMITS = { maxKg: 2000, maxReps: 1000, maxSec: 6 * 3600, maxSets: 50, maxExercises: 40, maxDurationMin: 24 * 60 }
export const BODY_PARTS = ['back', 'cardio', 'chest', 'lower arms', 'lower legs', 'neck', 'shoulders', 'upper arms', 'upper legs', 'waist']

// The least a "just did" squeezed in after today's last session lasts.
const MIN_ROOM_MS = 5 * 60000
const ISO = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const localIso = t => {
  const d = new Date(t)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const nameKey = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim()
// Enough to tell candidates apart when the user is asked: the catalogue spells some names twice.
const candidateOf = id => ({ id, name: EXIDX[id].n, equipment: EXIDX[id].eq || null, bodyPart: EXIDX[id].bp || null })
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * The exercise a reference names: a catalogue id (a drawing alias filed under its canonical id,
 * as the importer does), one of the profile's own exercises by id or by name, else a catalogue
 * name that means exactly one entry. Anything else is a problem with the candidates to choose from.
 */
export function resolveExercise(S, ref) {
  const text = String(ref ?? '').trim()
  if (!text) return { problem: 'no exercise named' }
  const customs = (S.customEx || []).filter(c => c && c.id)
  const own = customs.find(c => c.id === text)
  if (own) return { id: own.id, name: own.n, custom: true }
  // Own keys only: `constructor` or `__proto__` is on every object and names no exercise.
  const canon = canonicalExId(text)
  if (Object.hasOwn(EXIDX, text) && Object.hasOwn(EXIDX, canon)) return { id: canon, name: EXIDX[canon].n }
  const named = customs.filter(c => nameKey(c.n) === nameKey(text))
  if (named.length === 1) return { id: named[0].id, name: named[0].n, custom: true }
  if (named.length > 1) {
    return { problem: 'several of your own exercises have this name; pass one id', candidates: named.map(c => ({ id: c.id, name: c.n })) }
  }
  const { id, candidates, kind } = exerciseCandidates(text)
  if (id && EXIDX[id]) return { id, name: EXIDX[id].n }
  return {
    problem: kind === 'none' || !candidates.length
      ? 'no exercise in the library matches' + (candidates.length ? '; these only share a word with it' : '')
      : 'more than one exercise matches; pass one id',
    candidates: candidates.filter(c => EXIDX[c]).map(candidateOf),
  }
}

// One described set as the row the app stores, or a reason it cannot be one. `mode` is the
// exercise's: reps and seconds are two different exercises' worth of meaning, never one row.
function rowOf(set, mode, toProfile) {
  const reps = num(set.reps), secs = num(set.seconds), weight = set.weight == null ? 0 : num(set.weight)
  if (weight == null || weight < 0) return { problem: 'weight must be a number of 0 or more' }
  const kg = toProfile.toKg(weight)
  if (kg > LOG_LIMITS.maxKg) return { problem: `weight over ${LOG_LIMITS.maxKg} kg` }
  const row = mode === 'time'
    ? { sec: secs, w: toProfile.convert(weight), done: true }
    : { w: toProfile.convert(weight), r: reps, done: true }
  if (set.warmup === true) row.phase = 'warmup'
  if (set.failure === true) {
    if (set.warmup === true) return { problem: 'a warm-up set is not taken to failure' }
    row.failure = true
  }
  if (set.rir != null || set.rpe != null) {
    if (mode === 'time') return { problem: 'effort (RIR/RPE) is logged on rep sets only' }
    if (set.rir != null && set.rpe != null) return { problem: 'give RIR or RPE, not both' }
    const kind = set.rir != null ? 'rir' : 'rpe'
    const v = num(set[kind]), e = EFFORT[kind]
    if (v == null || v < e.min || v > e.max) return { problem: `${e.hd} must be between ${e.min} and ${e.max}` }
    row[kind] = v
  }
  return { row }
}

/**
 * Build the workout a description stands for, against profile `S`, without touching it.
 *
 * `input`: { date: 'YYYY-MM-DD', start?: 'HH:MM', durationMin?, name?, note?, unit?: 'kg'|'lb',
 *   exercises: [{ exercise, createCustom?, bodyPart?, note?,
 *     sets: [{ reps? | seconds?, weight?, warmup?, failure?, rir? | rpe? }] }] }
 *
 * Returns { workout, past, customEx, resolved } or { problems }: every problem in the whole
 * description at once, so one round trip to the user settles them all.
 *
 * `unit` is what a description without its own unit is read in, and `meanings` what each
 * dumbbell weight means (exercise id → 'as' | 'each' | 'total'). The caller fixes both once per
 * request, from the profile as it first read it: another device switching kg ↔ lb, or a
 * dumbbell default from each to total, between two attempts must not change what the same 20 is.
 */
export function buildLoggedWorkout(S, input, { now = Date.now(), unit: fallbackUnit, meanings } = {}) {
  const problems = []
  const today = localIso(now)
  const date = input?.date
  if (typeof date !== 'string' || !ISO.test(date) || localIso(new Date(date + 'T12:00:00')) !== date) {
    problems.push({ field: 'date', problem: 'must be a real YYYY-MM-DD date' })
  } else if (date > today) problems.push({ field: 'date', problem: 'is in the future' })
  if (input?.start != null && !HHMM.test(String(input.start))) problems.push({ field: 'start', problem: 'must be HH:MM (24 h)' })
  const dur = input?.durationMin
  if (dur != null && !(num(dur) > 0 && dur <= LOG_LIMITS.maxDurationMin)) problems.push({ field: 'durationMin', problem: `must be 1–${LOG_LIMITS.maxDurationMin} minutes` })
  const profileUnit = S.unit === 'lb' ? 'lb' : 'kg'
  const unit = input?.unit == null ? (fallbackUnit === 'lb' || fallbackUnit === 'kg' ? fallbackUnit : profileUnit) : input.unit
  if (unit !== 'kg' && unit !== 'lb') problems.push({ field: 'unit', problem: "must be 'kg' or 'lb'" })
  const toProfile = {
    toKg: w => (unit === 'lb' ? w * LB_TO_KG : w),
    // Converted only when the description is in the other unit, to the tenth the importer keeps.
    convert: w => (unit === profileUnit ? w : Math.round((unit === 'lb' ? w * LB_TO_KG : w / LB_TO_KG) * 10) / 10),
  }
  const exercises = Array.isArray(input?.exercises) ? input.exercises : []
  if (!exercises.length) problems.push({ field: 'exercises', problem: 'at least one exercise' })
  if (exercises.length > LOG_LIMITS.maxExercises) problems.push({ field: 'exercises', problem: `at most ${LOG_LIMITS.maxExercises}` })

  const customEx = []
  const resolved = []
  const entries = []
  exercises.slice(0, LOG_LIMITS.maxExercises).forEach((ex, i) => {
    const at = `exercises[${i}]`
    let hit = resolveExercise({ ...S, customEx: [...(S.customEx || []), ...customEx] }, ex?.exercise)
    if (hit.problem && ex?.createCustom === true && String(ex?.exercise ?? '').trim()) {
      const name = String(ex.exercise).trim().slice(0, 80)
      const bp = ex.bodyPart ?? bpFromName(name)
      if (!BODY_PARTS.includes(bp)) {
        problems.push({ field: at + '.bodyPart', problem: `needed for a new exercise: one of ${BODY_PARTS.join(', ')}` })
        return
      }
      // From the name, like an import's: the same name logged twice before a sync is one exercise.
      const c = { id: importId('mc', nameKey(name)), n: name, custom: true, eq: 'custom', tg: '', desc: '', bp }
      customEx.push(c)
      hit = { id: c.id, name: c.n, custom: true, created: true }
    }
    if (hit.problem) {
      problems.push({ field: at + '.exercise', exercise: ex?.exercise ?? null, problem: hit.problem, ...(hit.candidates ? { candidates: hit.candidates } : {}) })
      return
    }
    if (isCardio(hit.id) || customEx.find(c => c.id === hit.id)?.bp === 'cardio') {
      problems.push({ field: at + '.exercise', exercise: ex.exercise, problem: 'cardio (time and speed) cannot be logged this way yet' })
      return
    }
    const sets = Array.isArray(ex.sets) ? ex.sets : []
    if (!sets.length || sets.length > LOG_LIMITS.maxSets) {
      problems.push({ field: at + '.sets', problem: `1–${LOG_LIMITS.maxSets} sets` })
      return
    }
    const timed = sets.some(s => s?.seconds != null), counted = sets.some(s => s?.reps != null)
    if (timed && counted) {
      problems.push({ field: at + '.sets', problem: 'every set is reps or every set is seconds, not a mix' })
      return
    }
    const mode = timed ? 'time' : 'reps'
    const rows = []
    sets.forEach((s, j) => {
      const where = `${at}.sets[${j}]`
      const v = mode === 'time' ? num(s?.seconds) : num(s?.reps)
      const ok = mode === 'time'
        ? v != null && v >= 1 && v <= LOG_LIMITS.maxSec
        : Number.isInteger(v) && v >= 1 && v <= LOG_LIMITS.maxReps
      if (!ok) {
        problems.push({ field: where, problem: mode === 'time' ? `seconds must be 1–${LOG_LIMITS.maxSec}` : `reps must be a whole number 1–${LOG_LIMITS.maxReps}` })
        return
      }
      const { row, problem } = rowOf(s, mode, toProfile)
      if (problem) problems.push({ field: where, problem })
      else rows.push(mode === 'time' ? { ...row, sec: Math.round(v) } : row)
    })
    // The meaning of a dumbbell weight is stamped the way a freestyle entry gets it (sheets.jsx
    // swapActiveWorkoutExercise): the exercise's own default, so "20 each" stays 20 each.
    const cfg = mode === 'time' ? { id: hit.id, mode: 'time' } : { id: hit.id }
    const fixed = meanings && Object.hasOwn(meanings, hit.id) ? meanings[hit.id] : null
    const target = fixed === 'each' || fixed === 'total' ? { ...cfg, dbLoad: fixed } : fixed === 'as' ? cfg : withMeaning(S, cfg, hit.id)
    const note = String(ex.note ?? '').trim().slice(0, 280)
    entries.push({ id: hit.id, sets: rows, target, ...(note ? { note } : {}) })
    resolved.push({ input: ex.exercise, id: hit.id, name: hit.name, mode, ...(target.dbLoad ? { weightMeans: target.dbLoad } : {}), ...(hit.created ? { created: true } : {}) })
  })
  if (problems.length) return { problems }

  const past = date < today
  // A length nobody gave is the backfill's hour (backfill.js), as when a session is logged in the
  // app. Into the past without a start: the backfill's 18:00. Today without one it is "just did":
  // it ended now. A length the caller gave is kept as given; the hour that stands in for a missing
  // one is only as long as fits after today's last session (and after midnight), so a "just did"
  // lands after the session just logged in the app rather than overlapping it.
  let start, end
  if (input.start != null) {
    start = new Date(`${date}T${input.start}:00`).getTime()
    end = start + (dur ?? 60) * 60000
    if (dur == null && !past) end = Math.max(start, Math.min(end, now))
  } else if (past) {
    start = backfillStart(date)
    end = start + (dur ?? 60) * 60000
  } else {
    end = now
    const midnight = new Date(date + 'T00:00:00').getTime()
    if (dur != null) {
      start = end - dur * 60000
      if (start < midnight) return { problems: [{ field: 'durationMin', problem: 'a session that long ending now began yesterday: give the date and start it began on' }] }
    } else {
      const lastEnd = Math.max(0, ...(S.workouts || []).filter(w => w?.d === date).map(w => Number(w.end) || Number(w.start) || 0))
      start = Math.max(end - 60 * 60000, lastEnd, midnight)
      // Too little room after it — a session on file that ended moments ago, or ends after now
      // (another device's clock ahead) — would make a session of seconds, read back as "0 min":
      // the floor instead, overlapping the last minutes of the one before as the app's backfill
      // allows, and still starting after it began, so it is filed after it as a live finish.
      // (One that starts later still is jumped, and the chronological rule below handles that.)
      if (end - start < MIN_ROOM_MS) start = Math.max(end - MIN_ROOM_MS, midnight)
    }
  }
  if (start > now) return { problems: [{ field: 'start', problem: 'is later than now' }] }
  // As the app's own backfill refuses one (sheets.jsx endsInFuture): a finished session that has
  // not finished yet would count its whole length into the stats now.
  if (end > now) return { problems: [{ field: 'durationMin', problem: 'the session would end later than now' }] }

  const name = String(input.name ?? '').trim().slice(0, 80) || 'Workout'
  const note = String(input.note ?? '').trim().slice(0, 500)
  // The id is the description's, not the clock's: the same call made again — its answer lost to a
  // timeout, a client retrying — names the same workout, and appendLoggedWorkout keeps one.
  // Only what the caller sent goes in, never the start filled in from `now` or a converted weight.
  const id = importId('mw', JSON.stringify([
    date, input.start ?? null, dur ?? null, input.name ?? null, input.note ?? null, input.unit ?? null,
    exercises.map(ex => [ex.exercise, ex.createCustom === true, ex.note ?? null,
      ex.sets.map(s => [s.reps ?? null, s.seconds ?? null, s.weight ?? null, s.warmup === true, s.failure === true, s.rir ?? null, s.rpe ?? null])]),
  ]))
  // A custom exercise's muscles go with the entry, as Finish writes them: a device that deletes
  // the exercise without ever having seen this workout would otherwise leave its sets crediting
  // no muscle at all.
  const customs = [...(S.customEx || []), ...customEx]
  const workout = buildCompletedWorkout(
    { id, d: date, start, name, bw: null, routineIds: [], note, entries },
    { end, prs: [], snapshotFor: e => { const c = customs.find(x => x?.id === e.id); return c ? exerciseMuscleSnapshot(c) : null } },
  )
  // finish-workout's whitelist keeps `target`, which a timed hold and a dumbbell meaning need to
  // read back; volume as Finish stores it (warm-ups out, "each" counted per bell).
  workout.vol = workoutVolume(workout)
  return { workout, past, customEx, resolved }
}

const sameEntries = (a, b) =>
  JSON.stringify((a || []).map(e => [e.id, e.sets])) === JSON.stringify((b || []).map(e => [e.id, e.sets]))

/**
 * The workout already in `S` this one repeats: the same request (its id) first, else the same day
 * with the same sets. `sameRequest` tells the two apart: a repeated request is never filed again,
 * the same sets are when the caller says it was a second session.
 */
export function findDuplicate(S, workout) {
  const list = (S.workouts || []).filter(Boolean)
  const own = list.find(w => w.id === workout.id)
  if (own) return { workout: own, sameRequest: true }
  const same = list.find(w => w.d === workout.d && sameEntries(w.entries, workout.entries))
  return same ? { workout: same, sameRequest: false } : null
}

/**
 * File a built workout into `S` (mutated): its new custom exercises, the workout in day order,
 * and — as Finish does — its PR badges and confirmed weights for a session logged today, or for one
 * logged into the past its badges against the history around it and no confirmed weight moved.
 * `allowDuplicate` files a session identical to one already there (two real 3×10s on one day).
 */
export function appendLoggedWorkout(S, built, { now = Date.now(), allowDuplicate = false } = {}) {
  const dup = findDuplicate(S, built.workout)
  // A second session with the same sets has its own id already (its start or name differs, and
  // both are in the id), so a retry of it is caught by that id like any other.
  if (dup && (dup.sameRequest || !allowDuplicate)) return { added: false, reason: 'duplicate', workout: dup.workout }
  const w = JSON.parse(JSON.stringify(built.workout))
  S.customEx = Array.isArray(S.customEx) ? S.customEx : []
  const known = new Set(S.customEx.map(c => c?.id))
  for (const c of built.customEx || []) if (!known.has(c.id) && w.entries.some(e => e.id === c.id)) S.customEx.push({ ...c })
  S.workouts = Array.isArray(S.workouts) ? S.workouts : []
  // Filed before a session already logged — an earlier day, or this morning when tonight's is
  // already in — it is a backfill: a badge it leads with, and one it falsifies on a later session
  // taken away, which the live-finish rule below would leave standing.
  const later = S.workouts.some(x => x && (x.d > w.d || (x.d === w.d && (Number(x.start) || 0) > w.start)))
  if (built.past || later) {
    stampWorkout(w, now)
    const touched = [...new Set(w.entries.map(e => e.id))]
    S.workouts = rebuildPrHistory(insertChronological(S.workouts, w), touched, w)
  } else {
    w.prs = []
    w.entries.forEach(e => {
      const loads = e.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w).filter(x => x > 0)
      const mx = loads.length ? loads.reduce((a, b) => betterWeight(e.id, a, b)) : 0
      if (beatsWeight(e.id, mx, bestWeightFor(S, e.id, entryDbLoad(e)))) w.prs.push(e.id)
    })
    S.exWeights = S.exWeights && typeof S.exWeights === 'object' ? S.exWeights : {}
    w.entries.forEach(e => {
      const mx = bestWeightForEntry(e)
      if (mx > 0 && beatsWeight(e.id, mx, (S.exWeights[e.id] || {}).w || 0)) S.exWeights[e.id] = { w: mx, d: w.d }
    })
    S.workouts = insertChronological(S.workouts, w)
  }
  // What a device's own save stamps (useStore persist): a copy restored without its sync marker
  // compares this, and must not take the server's document for older than its own.
  S._ts = Math.max(now, (Number(S._ts) || 0) + 1)
  return { added: true, workout: S.workouts.find(x => x.id === w.id) || w }
}
