import batch from './exercise-muscle-batch-2.json' with { type: 'json' }

/**
 * ExRx-informed metadata for machine, cable, sled, and Smith-machine catalogue entries.
 * `exercises.js` applies this as a runtime overlay so the raw generated catalogue remains
 * compatible with imports and historical records.
 */
export const MACHINE_BATCH_2 = Object.freeze(batch)
