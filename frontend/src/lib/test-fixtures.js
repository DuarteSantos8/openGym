import { migrateProfileV1ToV2 } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { defaultPlanRule } from './prescription/index.js'

/** A PlanRule occurrence for tests: `preset`'s template with `options` (its numbers) over the defaults. */
export function ruleOccurrence(exerciseId, { preset = 'linear', occurrenceId = 'occ-' + exerciseId, routineId = 'r1', unit = 'kg', options = {}, revision = 1 } = {}) {
  return { occurrenceId, exerciseId, rule: { ...defaultPlanRule(preset, { id: 'rule-' + occurrenceId, exerciseId, routineId, unit, ...options }), revision } }
}

// A minimal, realistic engineSchemaVersion-2 profile for tests that need the canonical shape
// (routines with a rule occurrence, workouts with logged exposures) instead of hand-rolling one
// per test file. Shared by plan-share, export-profile, import-csv and import-hevy tests.
export function canonicalProfile(over = {}) {
  return {
    engineSchemaVersion: 2, unit: 'kg',
    prescriptions: {}, oneRepMaxes: {}, progression: {},
    customEx: [], week: {}, exWeights: {}, bodyweight: [],
    routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [ruleOccurrence('0025', { occurrenceId: 'occ1', options: { load: { mode: 'absolute', value: 60, unit: 'kg' } } })] }],
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

// Older fixtures enter through the same converter as real v1 profiles, so compatibility tests
// exercise the canonical engine.
export function migratedFixture(state) {
  return migrateProfileV1ToV2(state, LIB_BY_ID).profile
}
