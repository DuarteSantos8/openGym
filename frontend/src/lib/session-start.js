// Generate one immutable prescription per routine occurrence. The engine decides; this boundary
// only gathers its inputs (rule, track state, newest log, current 1RM) and stores its output.
import { currentOneRm, defaultPlanRule, generatePrescription, needsOneRm, resolveProgressionContext, supports } from './prescription/index.js'
import { EXIDX, isAssisted } from './exercises.js'
import { modeOf } from './history.js'

// How the exercise is logged: the occurrence's own mode, else the catalogue's (a cardio exercise);
// a rule with a duration and no reps is a hold.
const modeFor = (occ, p) => {
  const mode = modeOf({ mode: occ.mode, id: occ.exerciseId })
  return mode === 'reps' && p.parameters.durationSeconds ? 'time' : mode
}

/** Exercises in these routines whose rule needs a 1RM the profile does not have yet. */
export function missingOneRms(profile, routines) {
  const ids = new Set()
  for (const routine of routines) {
    for (const occ of routine.ex || []) {
      if (occ.rule && needsOneRm(occ.rule) && !currentOneRm(profile.oneRepMaxes, occ.exerciseId)) ids.add(occ.exerciseId)
    }
  }
  return [...ids]
}

/** An occurrence whose rule starts from `preset`'s defaults with these plain numbers. */
export function occurrenceFor(exerciseId, { sets, reps, sec, weight } = {}, { id, unit = 'kg', routineId = null, preset = 'manual' } = {}) {
  const rule = defaultPlanRule(preset, { id, exerciseId, routineId, unit })
  const p = rule.parameters
  if (sets > 0) p.sets = { min: Math.round(sets), max: Math.round(sets) }
  if (sec > 0) Object.assign(p, { durationSeconds: { min: sec, max: sec }, reps: { min: 1, max: 1 } })
  else if (reps > 0) p.reps = { min: Math.round(reps), max: Math.round(reps) }
  if (weight > 0) p.load = { mode: 'absolute', value: weight, unit }
  return { occurrenceId: id, exerciseId, rule }
}

/** Mutates `profile.prescriptions` (the store's update draft) and returns the session exposures. */
export function buildSessionExposures(profile, routine, ctx) {
  profile.prescriptions ||= {}
  return (routine?.ex || []).map((occ, i) => {
    const trackId = occ.occurrenceId
    // An assistance machine's load is the help given: the engine runs every step the other way.
    // An occurrence can say so itself (v1's per-exercise override), else the catalogue does.
    const assisted = typeof occ.assisted === 'boolean' ? occ.assisted : isAssisted(occ.exerciseId)
    // The engine picks the history and decides a restart; this boundary only passes the profile.
    const context = resolveProgressionContext({
      trackId, exerciseId: occ.exerciseId, rule: occ.rule, assisted,
      workouts: profile.workouts, prescriptions: profile.prescriptions, progression: profile.progression
    })
    const prescription = generatePrescription({
      id: ctx.newId(`prescription:${routine.id}:${occ.occurrenceId}:${ctx.now}:${i}`),
      now: new Date(ctx.now).toISOString(),
      trackId, rule: occ.restFromProfile && Number.isFinite(profile.restSec)
        ? { ...occ.rule, parameters: { ...occ.rule.parameters, restSeconds: profile.restSec } } : occ.rule,
      state: context.state, lastPrescription: context.lastPrescription,
      // The engine reads a log's id; a saved exposure carries it as exposureId.
      lastLog: context.baseline && { ...context.baseline, id: context.baseline.exposureId },
      reset: context.reset, heldLoad: context.heldLoad, startFrom: profile.startFrom,
      oneRm: currentOneRm(profile.oneRepMaxes, occ.exerciseId),
      // Lighter is harder on an assisted machine: a percentage ramp would run backwards.
      warmup: assisted ? null : occ.warmup ?? null,
      equipment: EXIDX[occ.exerciseId]?.eq ?? null, assisted,
      // What a deload needs to know about the movement (deload.js).
      perSide: occ.side === true, restPause: occ.intensifier?.type === 'restpause', restPauseReps: occ.intensifier?.totalReps
    })
    profile.prescriptions[prescription.id] = prescription
    return {
      exposureId: ctx.newId(`exposure:${routine.id}:${occ.occurrenceId}:${ctx.now}:${i}`),
      exerciseId: occ.exerciseId, exerciseNameSnapshot: occ.exerciseName || occ.exerciseId, mode: modeFor(occ, prescription),
      routineId: routine.id, occurrenceId: occ.occurrenceId, trackId,
      excludedFromProgression: routine.excludeFromProgression === true || occ.excludeFromProgression === true,
      prescriptionId: prescription.id,
      ...(occ.sg ? { sg: occ.sg } : {}),
      ...(occ.side ? { side: true } : {}),
      assisted,
      ...(occ.warmupRestSec > 0 ? { warmupRestSec: occ.warmupRestSec } : {}),
      ...(occ.bodyweight != null ? { bodyweight: occ.bodyweight } : {}),
      ...(occ.intensifier && supports(occ.rule)[occ.intensifier.type] ? { intensifier: occ.intensifier } : {}),
      performance: { sets: [] }
    }
  })
}
