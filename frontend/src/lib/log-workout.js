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
//
// Cardio is minutes at a speed, as the app's own cardio rows are ({ min, speed, incline?, done }):
// speed stored in km/h whatever the description was in (lib/speed.js), the grade in percent on
// the half percent (lib/incline.js). It earns no PR badge, moves no confirmed weight and adds
// nothing to volume, exactly as a cardio entry finished on the phone.
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
import { repSetMs } from './fit-export.js'
import { speedUnitOf, fromSpeed, KMH_PER_MPH } from './speed.js'
import { clampIncline, inclineFits, INCLINE_MAX } from './incline.js'

const LB_TO_KG = 0.45359237
// The importer's bounds (import-csv.js MAX_KG / MAX_REPS): nobody lifts 2 t or does 1,000 reps.
export const LOG_LIMITS = { maxKg: 2000, maxReps: 1000, maxSec: 6 * 3600, maxSets: 50, maxExercises: 40, maxDurationMin: 24 * 60, maxCardioMin: 6 * 60, maxSpeedKmh: 60 }
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
function rowOf(set, mode, toProfile, speedUnit) {
  if (mode === 'cardio') return cardioRowOf(set, speedUnit)
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

// A cardio interval: whole minutes (the app's stepper), a speed or the distance it covered, and
// a grade. What the row menu does not offer on cardio — a load, RIR, failure, a warm-up — is
// refused rather than dropped, and so is a speed past any bike's (60 km/h, the Coach's bound):
// that is a unit mixed up, not a workout.
function cardioRowOf(set, speedUnit) {
  const mins = num(set.minutes)
  if (!Number.isInteger(mins) || mins < 1 || mins > LOG_LIMITS.maxCardioMin) return { problem: `minutes must be a whole number 1–${LOG_LIMITS.maxCardioMin}` }
  if (set.weight != null && set.weight !== 0) return { problem: 'a cardio set carries no weight' }
  if (set.rir != null) return { problem: 'effort on cardio is RPE, not RIR' }
  if (set.failure === true) return { problem: 'a cardio set is not taken to failure' }
  if (set.warmup === true) return { problem: 'a cardio set is not logged as a warm-up' }
  if (set.speed != null && set.distance != null) return { problem: 'give the speed or the distance, not both' }
  let kmh = 0
  if (set.speed != null) {
    const v = num(set.speed)
    if (v == null || v < 0) return { problem: 'speed must be a number of 0 or more' }
    kmh = fromSpeed(v, speedUnit)
  } else if (set.distance != null) {
    // Distance is in the speed's unit (km, or miles with mph) and becomes the average speed over
    // the minutes, to the hundredth the own-CSV importer keeps: a row has no distance of its own.
    const v = num(set.distance)
    if (v == null || v <= 0) return { problem: 'distance must be more than 0' }
    kmh = Math.round((speedUnit === 'mph' ? v * KMH_PER_MPH : v) / (mins / 60) * 100) / 100
  }
  if (kmh > LOG_LIMITS.maxSpeedKmh) return { problem: `speed over ${LOG_LIMITS.maxSpeedKmh} km/h: check the unit` }
  const row = { min: mins, speed: kmh, done: true }
  if (set.incline != null) {
    const v = num(set.incline)
    if (v == null || v < 0 || v > INCLINE_MAX) return { problem: `incline must be 0–${INCLINE_MAX} %` }
    const g = clampIncline(v)
    if (g > 0) row.incline = g
  }
  if (set.rpe != null) {
    const v = num(set.rpe), e = EFFORT.rpe
    if (v == null || v < e.min || v > e.max) return { problem: `${e.hd} must be between ${e.min} and ${e.max}` }
    row.rpe = v
  }
  return { row }
}
const CARDIO_KEYS = ['minutes', 'speed', 'distance', 'incline']
const isCardioSet = s => CARDIO_KEYS.some(k => s?.[k] != null)

/**
 * Build the workout a description stands for, against profile `S`, without touching it.
 *
 * `input`: { date: 'YYYY-MM-DD', start?: 'HH:MM', durationMin?, name?, note?, unit?: 'kg'|'lb',
 *   exercises: [{ exercise, createCustom?, bodyPart?, note?,
 *     sets: [{ reps? | seconds?, weight?, warmup?, failure?, rir? | rpe? }
 *          | { minutes, speed? | distance?, incline?, rpe? }] }],
 *   speedUnit?: 'kmh'|'mph' }
 *
 * Returns { workout, past, customEx, resolved } or { problems }: every problem in the whole
 * description at once, so one round trip to the user settles them all.
 *
 * `unit` is what a description without its own unit is read in (`speedUnit` the same for a
 * speed or a distance), and `meanings` what each
 * dumbbell weight means (exercise id → 'as' | 'each' | 'total'). The caller fixes both once per
 * request, from the profile as it first read it: another device switching kg ↔ lb, or a
 * dumbbell default from each to total, between two attempts must not change what the same 20 is.
 */
export function buildLoggedWorkout(S, input, { now = Date.now(), unit: fallbackUnit, speedUnit: fallbackSpeed, meanings } = {}) {
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
  const speedUnit = input?.speedUnit == null ? (fallbackSpeed === 'mph' || fallbackSpeed === 'kmh' ? fallbackSpeed : speedUnitOf(S)) : input.speedUnit
  if (speedUnit !== 'kmh' && speedUnit !== 'mph') problems.push({ field: 'speedUnit', problem: "must be 'kmh' or 'mph'" })
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
    const sets = Array.isArray(ex.sets) ? ex.sets : []
    if (!sets.length || sets.length > LOG_LIMITS.maxSets) {
      problems.push({ field: at + '.sets', problem: `1–${LOG_LIMITS.maxSets} sets` })
      return
    }
    const timed = sets.some(s => s?.seconds != null), counted = sets.some(s => s?.reps != null), moving = sets.some(isCardioSet)
    if ([timed, counted, moving].filter(Boolean).length > 1) {
      problems.push({ field: at + '.sets', problem: 'every set is reps, every set is seconds, or every set is minutes (cardio), not a mix' })
      return
    }
    const mode = moving ? 'cardio' : timed ? 'time' : 'reps'
    // The exercise as the app knows it, the profile's own included, for what a grade fits on.
    const exObj = customEx.find(c => c.id === hit.id) || (S.customEx || []).find(c => c?.id === hit.id) || EXIDX[hit.id]
    // A cardio exercise is read back as cardio unless its target says otherwise (history.js
    // modeOf), so one logged in reps or seconds (jumping jacks counted, a timed sprint) names its
    // mode; otherwise its sets would read as "0 min @ 0 km/h".
    const cardioEx = isCardio(hit.id) || exObj?.bp === 'cardio'
    // As the config sheet offers Cardio only on a cardio exercise: "bench press, 20 minutes" is a
    // misread, not a bench session whose history then charts minutes.
    if (mode === 'cardio' && !cardioEx) {
      problems.push({ field: at + '.sets', exercise: ex.exercise, problem: `${hit.name} is not a cardio exercise: give its reps or seconds, or name the cardio exercise` })
      return
    }
    const rows = []
    sets.forEach((s, j) => {
      const where = `${at}.sets[${j}]`
      if (mode === 'cardio') {
        const { row, problem } = rowOf(s || {}, mode, toProfile, speedUnit)
        if (problem) problems.push({ field: where, problem })
        else if (row.incline && !inclineFits(exObj)) problems.push({ field: where, problem: `${hit.name} has no incline: drop it, or name the treadmill, stair or walking exercise` })
        else rows.push(row)
        return
      }
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
    const cfg = mode === 'reps' && !cardioEx ? { id: hit.id } : { id: hit.id, mode }
    const fixed = meanings && Object.hasOwn(meanings, hit.id) ? meanings[hit.id] : null
    // A cardio row has no load, so no dumbbell meaning either.
    const target = mode === 'cardio' ? cfg : fixed === 'each' || fixed === 'total' ? { ...cfg, dbLoad: fixed } : fixed === 'as' ? cfg : withMeaning(S, cfg, hit.id)
    const note = String(ex.note ?? '').trim().slice(0, 280)
    entries.push({ id: hit.id, sets: rows, target, ...(note ? { note } : {}) })
    resolved.push({ input: ex.exercise, id: hit.id, name: hit.name, mode, ...(target.dbLoad ? { weightMeans: target.dbLoad } : {}), ...(hit.created ? { created: true } : {}) })
  })
  // The session holds at least the minutes it was timed for, cardio and holds alike: a 120-minute
  // walk is not filed in the default hour, which the FIT export (scaling every set into the
  // session) would then compress into a walk at twice the speed. Only the timed minutes are a
  // rule; a length filled in also makes room for the time the export guesses for each rep set
  // where there is room, but a guess never refuses a session (the export squeezes the guesses
  // before the logged minutes when they do not fit).
  const timedMin = entries.reduce((n, e) => n + e.sets.reduce((m, s) =>
    m + (e.target.mode === 'cardio' ? s.min : e.target.mode === 'time' ? s.sec / 60 : 0), 0), 0)
  const repMin = entries.reduce((n, e) => n + (e.target.mode === 'cardio' || e.target.mode === 'time' ? 0
    : e.sets.reduce((m, s) => m + repSetMs(s.r) / 60000, 0)), 0)
  const workMin = timedMin > 0 ? Math.ceil(timedMin + repMin) : 0
  const timedText = `${Math.round(timedMin * 10) / 10} timed minutes (cardio and holds)`
  if (timedMin > LOG_LIMITS.maxDurationMin) problems.push({ field: 'exercises', problem: `more than ${LOG_LIMITS.maxDurationMin} timed minutes (cardio and holds) in one session` })
  else if (dur != null && timedMin > dur) problems.push({ field: 'durationMin', problem: `shorter than the ${timedText} in it` })
  if (problems.length) return { problems }

  const past = date < today
  const fallbackMin = Math.max(60, workMin)
  // A length nobody gave is the backfill's hour (backfill.js), as when a session is logged in the
  // app. Into the past without a start: the backfill's 18:00. Today without one it is "just did":
  // it ended now. A length the caller gave is kept as given; the hour that stands in for a missing
  // one is only as long as fits after today's last session (and after midnight), so a "just did"
  // lands after the session just logged in the app rather than overlapping it.
  let start, end
  if (input.start != null) {
    start = new Date(`${date}T${input.start}:00`).getTime()
    end = start + (dur ?? fallbackMin) * 60000
    if (dur == null && !past) end = Math.max(start, Math.min(end, now))
  } else if (past) {
    start = backfillStart(date)
    end = start + (dur ?? fallbackMin) * 60000
  } else {
    end = now
    const midnight = new Date(date + 'T00:00:00').getTime()
    if (dur != null) {
      start = end - dur * 60000
      if (start < midnight) return { problems: [{ field: 'durationMin', problem: 'a session that long ending now began yesterday: give the date and start it began on' }] }
    } else {
      const todays = (S.workouts || []).filter(w => w?.d === date)
      const lastEnd = Math.max(0, ...todays.map(w => Number(w.end) || Number(w.start) || 0))
      const lastStart = Math.max(0, ...todays.map(w => Number(w.start) || 0))
      start = Math.max(end - fallbackMin * 60000, lastEnd, midnight)
      // Too little room after it — a session on file that ended moments ago, or ends after now
      // (another device's clock ahead) — would make a session of seconds, read back as "0 min":
      // the floor instead, overlapping the last minutes of the one before as the app's backfill
      // allows, and still starting after it began, so it is filed after it as a live finish.
      // (One that starts later still is jumped, and the chronological rule below handles that.)
      if (end - start < MIN_ROOM_MS) start = Math.max(end - MIN_ROOM_MS, midnight)
      // The timed work done since the last session still has to fit: it reaches back over that
      // one's end rather than file 20 minutes of walking in the 5 that are left. Not over its
      // start, though: that would file it before the session it followed, as a backfill.
      // The rep sets' guessed time goes along only when it fits as well.
      const floorMin = timedMin
      for (const need of workMin > floorMin ? [workMin, floorMin] : [floorMin]) {
        if (end - start >= need * 60000) break
        const reach = end - need * 60000
        if (reach > lastStart && reach >= midnight) { start = reach; break }
        if (need > floorMin) continue
        if (reach < midnight) return { problems: [{ field: 'durationMin', problem: `${timedText} ending now began yesterday: give the date and start it began on` }] }
        return { problems: [{ field: 'start', problem: `${timedText} ending now would begin before today's last session did: give the start (and length) it really had` }] }
      }
    }
  }
  if (start > now) return { problems: [{ field: 'start', problem: 'is later than now' }] }
  // As the app's own backfill refuses one (sheets.jsx endsInFuture): a finished session that has
  // not finished yet would count its whole length into the stats now.
  if (end > now) return { problems: [{ field: 'durationMin', problem: 'the session would end later than now' }] }
  if (end - start < timedMin * 60000) return { problems: [{ field: 'start', problem: `the ${timedText} from that start would end later than now` }] }

  const name = String(input.name ?? '').trim().slice(0, 80) || 'Workout'
  const note = String(input.note ?? '').trim().slice(0, 500)
  // The id is the description's, not the clock's: the same call made again — its answer lost to a
  // timeout, a client retrying — names the same workout, and appendLoggedWorkout keeps one.
  // Only what the caller sent goes in, never the start filled in from `now` or a converted weight.
  // The cardio fields join only when there are any, so a lifting description keeps the id it
  // had before cardio could be logged, and a retry across versions still finds its workout.
  const id = importId('mw', JSON.stringify([
    date, input.start ?? null, dur ?? null, input.name ?? null, input.note ?? null, input.unit ?? null,
    exercises.map(ex => [ex.exercise, ex.createCustom === true, ex.note ?? null,
      ex.sets.map(s => [s.reps ?? null, s.seconds ?? null, s.weight ?? null, s.warmup === true, s.failure === true, s.rir ?? null, s.rpe ?? null,
        ...(isCardioSet(s) ? [CARDIO_KEYS.map(k => s[k] ?? null)] : [])])]),
    ...(input.speedUnit != null ? [{ speedUnit: input.speedUnit }] : []),
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
  return { workout, past, customEx, resolved, speedUnit }
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

/**
 * What a save of `built` would do to `S`, without touching it: { workout } as appendLoggedWorkout
 * would file it — its PR badges included, which are only decided at filing, against the history
 * around it — or, when the save would add nothing because it is a duplicate, { workout, duplicateOf }
 * with the description itself (not the copy on file, which an edit in the app may have changed).
 * A dry run shows this, so it cannot promise fewer badges (or more) than the save that follows.
 */
export function previewLoggedWorkout(S, built, { now = Date.now(), allowDuplicate = false } = {}) {
  const dup = findDuplicate(S, built.workout)
  if (dup && (dup.sameRequest || !allowDuplicate)) return { workout: built.workout, duplicateOf: dup.workout.id }
  return { workout: appendLoggedWorkout(JSON.parse(JSON.stringify(S)), built, { now, allowDuplicate: true }).workout }
}
