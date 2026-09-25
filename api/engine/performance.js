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
  return out
}

function targetOf(exposure, p) {
  if (!p) return null
  return {
    mode: exposure.mode || 'reps', sets: p.rows.length, reps: p.prefill.reps,
    ...(p.prefill.durationSeconds != null ? { sec: p.prefill.durationSeconds } : {}),
    ...(p.parameters.load.resolved ? { weight: p.parameters.load.resolved.value } : {})
  }
}

export function legacyEntriesOf(workout, prescriptions = {}) {
  if (!Array.isArray(workout?.exposures)) return workout?.entries || []
  return workout.exposures.map(x => ({
    id: x.exerciseId, rid: x.routineId ?? null,
    target: targetOf(x, prescriptions?.[x.prescriptionId]),
    ...(x.muscleSnapshot ? { muscleSnapshot: x.muscleSnapshot } : {}),
    sets: (x.performance?.sets || []).map(row => legacySet(row, x.mode))
  }))
}
