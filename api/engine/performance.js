import { ruleOfPrescription } from './generate.js'

// A finished workout read back in the v1 entry shape ({ id, target, sets: [{ w, r, … }] }) for the
// readers that still speak it: the Coach payload and cohort, effort and muscle stats, admin.
// Read-only. A workout that was never migrated (a v1 state file on the server) comes back as is.
const obs = (row, metric) => row.observations?.find(o => o.metric === metric)?.value

function legacySet(row, mode) {
  const out = { done: row.status === 'completed' }
  if (row.resistance?.kind === 'external-load') out.w = row.resistance.value
  else if (row.resistance?.kind === 'bodyweight') out.w = 0
  const r = obs(row, 'repetitions'), d = obs(row, 'duration'), speed = obs(row, 'speed')
  if (r != null) out.r = r
  if (d != null) { if (mode === 'cardio') out.min = d / 60; else out.sec = d }
  if (speed != null) out.speed = speed
  if (row.rir != null) out.rir = row.rir
  if (row.rpeEntered != null) out.rpe = row.rpeEntered
  if (row.role === 'warmup') out.warmup = true
  // A drop chain is the row's segments: read back as the v1 row it was logged as.
  if (row.segments?.length) { out.type = 'dropset'; out.drops = row.segments.map(s => legacySet(s, mode)).map(({ w, r }) => ({ w, r })) }
  if (row.clusters?.length) { out.type = 'restpause'; out.clusters = row.clusters.map(c => ({ ...c })) }
  return out
}

function targetOf(exposure, p) {
  // A migrated v1 entry no prescription could hold keeps what v1 prescribed for it (migration).
  if (!p) return exposure.legacyTarget ? { ...exposure.legacyTarget } : null
  // v1's cardio target is minutes and speed; a hold's is seconds.
  const duration = p.prefill.durationSeconds == null ? {}
    : exposure.mode === 'cardio' ? { min: p.prefill.durationSeconds / 60, ...(p.prefill.speed != null ? { speed: p.prefill.speed } : {}) }
      : { sec: p.prefill.durationSeconds }
  return {
    mode: exposure.mode || 'reps',
    ...Object.fromEntries(['side', 'bodyweight', 'assisted', 'intensifier', 'warmupRestSec'].filter(k => exposure[k] != null).map(k => [k, exposure[k]])), sets: p.rows.length, reps: p.prefill.reps, ...duration,
    ...(p.parameters.load.resolved ? { weight: p.parameters.load.resolved.value } : {})
  }
}

function plannedOf(p) {
  const { sets, reps, durationSeconds } = ruleOfPrescription(p).parameters
  return durationSeconds ? { sets: sets.min, sec: durationSeconds.min }
    : { sets: sets.min, reps: reps.max, ...(reps.min !== reps.max ? { repsMin: reps.min } : {}) }
}

export function legacyEntriesOf(workout, prescriptions = {}) {
  if (!Array.isArray(workout?.exposures)) return workout?.entries || []
  return workout.exposures.map(x => ({
    id: x.exerciseId, rid: x.routineId ?? null,
    target: targetOf(x, prescriptions?.[x.prescriptionId]),
    ...(prescriptions?.[x.prescriptionId] ? { planned: plannedOf(prescriptions[x.prescriptionId]) } : x.legacyPlanned ? { planned: x.legacyPlanned } : {}),
    ...(x.muscleSnapshot ? { muscleSnapshot: x.muscleSnapshot } : {}),
    ...(x.performance?.note ? { note: x.performance.note, ...(x.performance.notePin ? { notePin: true } : {}) } : {}),
    sets: (x.performance?.sets || []).map(row => legacySet(row, x.mode))
  }))
}
