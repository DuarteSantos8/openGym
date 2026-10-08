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
export { PRESETS, PRESET_IDS, SET_REPS_MAX, REPS_MAX, INCREMENT_TYPES, COMPLETION_METRICS, OPERATOR_METRICS, RECOVERY_METHODS, MAX_PHASES, MAX_GROUPS, MAX_ROWS, MAX_OPERATORS, WENDLER_CYCLE, cardioParameters, defaultPlanRule, editPlan, isTemplateRule, needsOneRm, planOptions, planPhase, pyramidDirection, rptOffsets, supports, validateIntensifier, validatePlanRule, withRest, presetForPolicy, policyOfPreset } from './rules.js'
export { DELOAD_AFTER, DELOAD_FACTOR, DELOAD_FACTOR_MAX, DELOAD_FACTOR_MIN, defaultDeload, deloadLoad, deloadedLoad, isValidDeloadFactor, selectDeloadCandidate } from './deload.js'
export { reconcileDerivedOneRms, appendOneRm, currentOneRm, DEFAULT_FORMULA, FORMULAS, REP_CAP, WEIGHTED_REP_CAP, FORMULA_NAMES, formulaOf, ensembleCV, weightedEstimate, estimate1RM } from './one-rm.js'
export { generatePrescription, ruleOfPrescription } from './generate.js'
export { bestLoad, chronologicalWorkouts, planFingerprint, replayProgression, resolveProgressionContext } from './context.js'
export { groupIdOf, operatorFor, phaseById, phaseOf, restOf } from './program.js'
export { auditExecution, missingReference, normalizeEffort, summarizeActual } from './audit.js'
export { advanceProgression, initialProgressionState, verdictOf } from './advance.js'
export { legacyEntriesOf } from './performance.js'
export { migrateOccurrence, migrateWarmups, planWarmupRows, validateWarmup, warmupClass, warmupMaxCount, warmupSteps } from './warmup.js'
