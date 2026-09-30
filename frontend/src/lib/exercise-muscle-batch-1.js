import batch from './exercise-muscle-batch-1.json' with { type: 'json' }
import olympic from './exercise-muscle-olympic.json' with { type: 'json' }
import { MACHINE_BATCH_2 } from './exercise-muscle-batch-2.js'

/**
 * ExRx-informed metadata for the first compound-lift batch. The raw generated catalogue remains
 * untouched; exercises.js applies this layer to the runtime index.
 */
export const COMPOUND_LIFT_BATCH_1 = Object.freeze(batch)
export const OLYMPIC_LIFT_METADATA = Object.freeze(olympic)

// Keep the phase-2 artifact in its own module for auditing while preserving the phase-1 resolver
// interface consumed by exercises.js and downstream muscle helpers.
export { MACHINE_BATCH_2 }

/**
 * Populated owner-approved correction overlay, separate from the generated batches. These
 * corrections retain explicit zero-credit muscle associations without editing generated data.
 * Explicit metadata on a user/custom exercise wins as well.
 */
const completeWeights = weights => Object.freeze(weights)
const overridesFor = (ids, muscleWeights) => Object.fromEntries(
  ids.map(id => [id, Object.freeze({ muscleWeights })])
)

const PULL_UP_WEIGHTS = completeWeights({
  'upper-back': 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4, triceps: 0
})
const PULLDOWN_WEIGHTS = completeWeights({
  'upper-back': 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4, trapezius: 0.4, triceps: 0
})
const L_PULL_UP_WEIGHTS = completeWeights({
  'upper-back': 1, abs: 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4,
  'hip-flexors': 0.4, triceps: 0
})
const T_BAR_ROW_WEIGHTS = completeWeights({
  'upper-back': 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4, trapezius: 0.4,
  chest: 0, triceps: 0
})
const CHEST_PRESS_WEIGHTS = completeWeights({ chest: 1, deltoids: 0.4, triceps: 0.4, biceps: 0 })
const CLOSE_GRIP_PRESS_WEIGHTS = completeWeights({ triceps: 1, chest: 0.4, deltoids: 0.4, biceps: 0 })
const CALF_PRESS_WEIGHTS = completeWeights({ calves: 1, hamstring: 0 })
const CALF_PRESS_QUADRICEPS_WEIGHTS = completeWeights({ calves: 1, quadriceps: 0.4, hamstring: 0 })
const CALF_PRESS_GLUTEAL_WEIGHTS = completeWeights({ calves: 1, gluteal: 0.4, hamstring: 0 })
const HIP_ABDUCTION_WEIGHTS = completeWeights({ gluteal: 1, hamstring: 0 })
const LEG_PRESS_WEIGHTS = completeWeights({
  quadriceps: 1, gluteal: 1, adductors: 1, hamstring: 0.4, calves: 0
})
const SMITH_HACK_SQUAT_WEIGHTS = completeWeights({
  quadriceps: 1, gluteal: 1, adductors: 1, hamstring: 0.4,
  'lower-back': 0.4, abs: 0.4, obliques: 0.4, calves: 0
})
const MACHINE_FLY_WEIGHTS = completeWeights({
  chest: 1, deltoids: 0.4, serratus: 0.4, biceps: 0
})
const TRICEPS_EXTENSION_WEIGHTS = completeWeights({ triceps: 1, deltoids: 0 })

export const USER_EXERCISE_MUSCLE_OVERRIDES = Object.freeze({
  ...overridesFor(['1429', '1432', '0652', '0651', '0017', '0015', '0970', '0841'], PULL_UP_WEIGHTS),
  ...overridesFor(['1325', '1347', '2330', '2616', '2736', '3563', '0007', '0150', '0153', '0177', '0198', '0197', '0205', '0245', '0579', '0673', '0818'], PULLDOWN_WEIGHTS),
  ...overridesFor(['3418'], L_PULL_UP_WEIGHTS),
  ...overridesFor(['1349', '0606'], T_BAR_ROW_WEIGHTS),
  ...overridesFor(['1254', '1256', '1257', '1299', '1300', '1301', '1479', '2144', '3758', '0025', '0033', '0045', '0047', '0122', '0151', '0169', '0289', '0301', '0314', '0748', '0577', '0576'], CHEST_PRESS_WEIGHTS),
  ...overridesFor(['0030', '0751'], CLOSE_GRIP_PRESS_WEIGHTS),
  ...overridesFor(['2289', '2335', '0738'], CALF_PRESS_WEIGHTS),
  ...overridesFor(['1391'], CALF_PRESS_QUADRICEPS_WEIGHTS),
  ...overridesFor(['2334', '1392'], CALF_PRESS_GLUTEAL_WEIGHTS),
  ...overridesFor(['0597', '3006'], HIP_ABDUCTION_WEIGHTS),
  ...overridesFor(['1425', '1463', '1464', '2287', '2611', '0739', '0741', '0743', '0760'], LEG_PRESS_WEIGHTS),
  ...overridesFor(['0755'], SMITH_HACK_SQUAT_WEIGHTS),
  ...overridesFor(['0596'], MACHINE_FLY_WEIGHTS),
  ...overridesFor(['0607'], TRICEPS_EXTENSION_WEIGHTS),
})

export function exerciseMuscleMetadataFor(id) {
  return {
    ...(COMPOUND_LIFT_BATCH_1[id] || {}),
    ...(MACHINE_BATCH_2[id] || {}),
    ...(OLYMPIC_LIFT_METADATA[id] || {}),
    ...(USER_EXERCISE_MUSCLE_OVERRIDES[id] || {})
  }
}
