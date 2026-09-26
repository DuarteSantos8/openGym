// The training engine: prescription generation, progression, 1RM and warm-up planning. The only
// import surface for code outside this folder.
//
// Pure on purpose: nothing here imports from outside api/engine — no exercise catalogue, no
// storage, no Coach. It runs unchanged under bare node (API) and Vite (web, Capacitor), and the
// same inputs always give the same prescription.
//
// The v1 → v2 profile migration uses this engine but is not part of it: it lives in api/migration,
// because it is a one-off data conversion and needs the built-in exercise catalogue to tell
// cardio, bodyweight and assisted exercises apart — a dependency this folder does not take.
export { canonicalJSON, contentHash, deepFreeze } from './canonical.js'
export { roundLoad, resolveExpression, resolveLoad, applyIncrement } from './load.js'
export { PRESETS, PRESET_IDS, INCREMENT_TYPES, COMPLETION_METRICS, INCREMENTING_GATES, WENDLER_CYCLE, defaultPlanRule, needsOneRm, rptOffsets, supports, validateIntensifier, validatePlanRule, presetForPolicy, policyOfPreset } from './rules.js'
export { appendOneRm, currentOneRm, DEFAULT_FORMULA, FORMULAS, REP_CAP, estimate1RM } from './one-rm.js'
export { generatePrescription, ruleOfPrescription } from './generate.js'
export { auditExecution, missingReference, normalizeEffort, summarizeActual } from './audit.js'
export { advanceProgression, initialProgressionState } from './advance.js'
export { legacyEntriesOf } from './performance.js'
export { migrateOccurrence, migrateWarmups, planWarmupRows, validateWarmup, warmupClass, warmupMaxCount, warmupSteps } from './warmup.js'
