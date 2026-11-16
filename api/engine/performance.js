import { planPhase } from './rules.js'

// A finished workout read back in the v1 entry shape ({ id, target, sets: [{ w, r, … }] }) for the
// readers that still speak it: the Coach payload and cohort, effort and muscle stats, admin.
// Read-only. A workout that was never migrated (a v1 state file on the server) comes back as is.
const obs = (row, metric) => row.observations?.find(o => o.metric === metric)?.value

function legacySet(row, mode) {
  const out = { done: row.status === 'completed' }
  if (row.resistance?.kind === 'external-load') out.w = row.resistance.value
  else if (row.resistance?.kind === 'bodyweight') out.w = 0
  const r = obs(row, 'repetitions'), d = obs(row, 'duration'), speed = obs(row, 'speed'), incline = obs(row, 'incline')
  const level = obs(row, 'level'), m = obs(row, 'distance')
  if (r != null) out.r = r
  if (mode === 'time' && r != null && d == null) out.mode = 'reps'
  if (mode === 'reps' && d != null && r == null) out.mode = 'time'
  if (d != null) { if (mode === 'cardio') out.min = d / 60; else out.sec = d }
  if (speed != null) out.speed = speed
  if (incline != null) out.incline = incline
  if (level != null) out.level = level
  if (m != null) out.m = m
  if (row.failure) out.failure = true
  if (row.rir != null) out.rir = row.rir
  if (row.rpeEntered != null) out.rpe = row.rpeEntered
  if (row.role === 'warmup') out.warmup = true
  if (row.side) out.side = row.side
  if (row.max) out.max = true
  if (typeof row.note === 'string') out.note = row.note
  for (const k of ['edited', 'wp', 'wb', 'at', 'restSec', 'restOff', 'hr', 'restHr', 'sid', 'eat', 'tag', 'km']) if (row[k] != null) out[k] = row[k]
  if (Array.isArray(row.media)) out.media = row.media
  if (Array.isArray(row.bands)) out.bands = row.bands
  if (row.sides?.L && row.sides?.R) out.sides = { L: legacySet(row.sides.L, mode), R: legacySet(row.sides.R, mode) }
  // A drop chain is the row's segments: read back as the v1 row it was logged as.
  if (row.segments?.length) { out.type = 'dropset'; out.drops = row.segments.map(s => legacySet(s, mode)).map(({ w, r }) => ({ w, r })) }
  if (row.clusters?.length) { out.type = 'restpause'; out.clusters = row.clusters.map(c => ({ ...c })) }
  return out
}

function targetOf(exposure, p) {
  // A migrated v1 entry no prescription could hold keeps what v1 prescribed for it (migration).
  if (!p) return exposure.legacyTarget || exposure.mode || ['side', 'bodyweight', 'assisted', 'dbLoad'].some(k => exposure[k] != null) ? { ...(exposure.mode ? { mode: exposure.mode } : {}), ...(exposure.legacyTarget || {}), ...Object.fromEntries(['side', 'bodyweight', 'assisted', 'dbLoad', 'bells', 'lastToFailure', 'backoff'].filter(k => exposure[k] != null).map(k => [k, exposure[k]])) } : null
  // v1's cardio target is minutes and speed; a hold's is seconds.
  const duration = p.prefill.durationSeconds == null ? {}
    : exposure.mode === 'cardio' ? { min: p.prefill.durationSeconds / 60, ...(p.prefill.speed != null ? { speed: p.prefill.speed } : {}) }
      : { sec: p.prefill.durationSeconds }
  return {
    mode: exposure.mode || 'reps',
    ...Object.fromEntries(['side', 'bodyweight', 'assisted', 'sgName', 'sgRest', 'sgCircuit', 'tempo', 'dup', 'intensifier', 'warmupRestSec', 'dbLoad', 'bells', 'lastToFailure', 'backoff'].filter(k => exposure[k] != null).map(k => [k, exposure[k]])), sets: p.rows.length, reps: p.prefill.reps, ...duration,
    ...(p.parameters.load.resolved ? { weight: p.parameters.load.resolved.value } : {})
  }
}

function plannedOf(p) {
  const { sets, reps, durationSeconds } = planPhase(p.ruleSnapshot).parameters
  return durationSeconds ? { sets: sets.min, sec: durationSeconds.min }
    : p.prefill?.metres > 0 ? { sets: sets.min, m: p.prefill.metres }
      : { sets: sets.min, reps: reps.max, ...(reps.min !== reps.max ? { repsMin: reps.min } : {}) }
}

export function legacyEntriesOf(workout, prescriptions = {}) {
  if (!Array.isArray(workout?.exposures)) return workout?.entries || []
  return workout.exposures.map(x => ({
    id: x.exerciseId, rid: x.routineId ?? null,
    ...(x.sg ? { sg: x.sg } : {}),
    // The machine brand of a lift kept per gym (v1.4.5 #988).
    ...(x.brand ? { brand: x.brand } : {}),
    target: targetOf(x, prescriptions?.[x.prescriptionId]),
    ...(prescriptions?.[x.prescriptionId] ? { planned: plannedOf(prescriptions[x.prescriptionId]) } : x.legacyPlanned ? { planned: x.legacyPlanned } : {}),
    ...(x.muscleSnapshot ? { muscleSnapshot: x.muscleSnapshot } : {}),
    ...(x.performance?.note ? { note: x.performance.note, ...(x.performance.notePin ? { notePin: true } : {}) } : {}),
    sets: (x.performance?.sets || []).map(row => legacySet(row, x.mode))
  }))
}
