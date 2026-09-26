// Generate one immutable prescription per routine occurrence. The engine decides; this boundary
// only gathers its inputs (rule, track state, newest log, current 1RM) and stores its output.
import { currentOneRm, defaultPlanRule, generatePrescription, needsOneRm, supports } from './prescription/index.js'
import { EXIDX, isAssisted } from './exercises.js'

/** Newest finished, non-excluded exposure on a track — a reverse scan, typically 1-3 workouts. */
export function lastLogFor(profile, trackId) {
  const workouts = profile.workouts || []
  for (let i = workouts.length - 1; i >= 0; i--) {
    const exposures = workouts[i].exposures || []
    for (let j = exposures.length - 1; j >= 0; j--) {
      const x = exposures[j]
      if (x.trackId === trackId && x.prescriptionId && !x.excludedFromProgression) return x
    }
  }
  return null
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
    const state = profile.progression?.[trackId] || null
    const lastLog = lastLogFor(profile, trackId)
    const prescription = generatePrescription({
      id: ctx.newId(`prescription:${routine.id}:${occ.occurrenceId}:${ctx.now}:${i}`),
      now: new Date(ctx.now).toISOString(),
      trackId, rule: occ.rule, state,
      lastPrescription: profile.prescriptions[state?.lastPrescriptionId ?? lastLog?.prescriptionId] || null,
      // The engine reads a log's id; a saved exposure carries it as exposureId.
      lastLog: lastLog && { ...lastLog, id: lastLog.exposureId },
      oneRm: currentOneRm(profile.oneRepMaxes, occ.exerciseId),
      // Lighter is harder on an assisted machine: a percentage ramp would run backwards.
      warmup: isAssisted(occ.exerciseId) ? null : occ.warmup ?? null,
      equipment: EXIDX[occ.exerciseId]?.eq ?? null
    })
    profile.prescriptions[prescription.id] = prescription
    return {
      exposureId: ctx.newId(`exposure:${routine.id}:${occ.occurrenceId}:${ctx.now}:${i}`),
      exerciseId: occ.exerciseId, exerciseNameSnapshot: occ.exerciseName || occ.exerciseId,
      routineId: routine.id, occurrenceId: occ.occurrenceId, trackId,
      excludedFromProgression: routine.excludeFromProgression === true || occ.excludeFromProgression === true,
      prescriptionId: prescription.id,
      ...(occ.sg ? { sg: occ.sg } : {}),
      ...(occ.intensifier && supports(occ.rule)[occ.intensifier.type] ? { intensifier: occ.intensifier } : {}),
      performance: { sets: [] }
    }
  })
}
