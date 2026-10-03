import { defaultPlanRule } from './prescription/index.js'

/** A PlanRule occurrence for tests; `patch` edits the default rule of `preset`. */
export function ruleOccurrence(exerciseId, { preset = 'linear', occurrenceId = 'occ-' + exerciseId, routineId = 'r1', unit = 'kg', patch = rule => rule } = {}) {
  return { occurrenceId, exerciseId, rule: patch(defaultPlanRule(preset, { id: 'rule-' + occurrenceId, exerciseId, routineId, unit })) }
}

// A minimal, realistic engineSchemaVersion-2 profile for tests that need the canonical shape
// (routines with a rule occurrence, workouts with logged exposures) instead of hand-rolling one
// per test file. Shared by plan-share, export-profile, import-csv and import-hevy tests.
export function canonicalProfile(over = {}) {
  return {
    engineSchemaVersion: 2, unit: 'kg',
    prescriptions: {}, oneRepMaxes: {}, progression: {},
    customEx: [], week: {}, exWeights: {}, bodyweight: [],
    routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [ruleOccurrence('0025', { occurrenceId: 'occ1', patch: r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value: 60, unit: 'kg' } } }) })] }],
    workouts: [{ id: 'w0', d: '2026-01-01', status: 'completed', start: 1, routineIds: [], name: 'Push', exposures: [loggedExposure('0025', [{ r: 5, w: 60 }], { exposureId: 'exp0' })] }],
    ...over
  }
}

/** A finished exposure as Task 8 writes it: exact rows with roles, no prescription needed by readers. */
export function loggedExposure(exerciseId, rows, { mode = 'reps', exposureId = 'x-' + exerciseId, prescriptionId = null, muscleSnapshot } = {}) {
  return {
    exposureId, exerciseId, mode, prescriptionId, trackId: 'occ-' + exerciseId, excludedFromProgression: false,
    ...(muscleSnapshot ? { muscleSnapshot } : {}),
    performance: { sets: rows.map(({ role = 'work', r, sec, w, done = true, rir, rpe }) => ({
      role, status: done ? 'completed' : 'skipped', prescribed: false,
      observations: [...(r != null ? [{ metric: 'repetitions', unit: 'reps', value: r }] : []), ...(sec != null ? [{ metric: 'duration', unit: 's', value: sec }] : [])],
      resistance: w > 0 ? { kind: 'external-load', value: w, unit: 'kg' } : { kind: mode === 'cardio' ? 'none' : 'bodyweight' }, segments: [],
      ...(rir != null ? { rir } : {}), ...(rpe != null ? { rpeEntered: rpe } : {})
    })) }
  }
}
