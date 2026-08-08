// Canonical, backwards-compatible workout shapes.
//
// This module deliberately does not infer a warm-up from an array position. Legacy records
// without a phase use the work default; a warm-up is only a warm-up when its phase is explicit.
// The helpers return plain JSON-safe values so they can be used at import/load boundaries and
// by the workout, progression, history, and statistics layers without mutating the source.

export const PHASES = ['warmup', 'work']

/** Resolve a row's phase without allowing a stale legacy flag to override an explicit phase. */
export function phaseForSet(set, fallback = 'work') {
  if (!set || typeof set !== 'object') return normalizePhase(undefined, fallback)
  if (set.phase != null && set.phase !== '') return normalizePhase(set.phase, fallback)
  return set.warmup === true ? 'warmup' : normalizePhase(undefined, fallback)
}

/** Canonical warm-up test: an explicit phase wins; the legacy boolean fills its absence. */
export function isWarmupRow(set) {
  return phaseForSet(set) === 'warmup'
}
export const MODES = ['reps', 'time', 'cardio']
export const TARGET_MODES = ['reps', 'time']
export const TARGET_KINDS = ['fixed', 'amrap']
export const WEIGHT_UNITS = ['kg', 'lb']
export const LEGACY_WEIGHT_UNIT = 'legacy'
export const UNKNOWN_WEIGHT_UNIT = 'unknown'

const has = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key)
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const WEIGHT_UNIT_ALIASES = {
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb'
}
const MODE_UNIT_ALIASES = {
  rep: 'reps', reps: 'reps', repetition: 'reps', repetitions: 'reps',
  sec: 'time', secs: 'time', second: 'time', seconds: 'time', time: 'time',
  min: 'cardio', mins: 'cardio', minute: 'cardio', minutes: 'cardio', cardio: 'cardio'
}

function numericValue(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function hasPositiveWeight(input) {
  const source = objectOf(input)
  if (['w', 'weight', 'topW'].some(key => {
    const n = numericValue(source[key])
    return n != null && n > 0
  })) return true
  if (source.result && hasPositiveWeight(source.result)) return true
  if (Array.isArray(source.sets) && source.sets.some(set => hasPositiveWeight(set))) return true
  if (Array.isArray(source.entries) && source.entries.some(entry => hasPositiveWeight(entry))) return true
  return false
}

function hasDirectPositiveWeight(input) {
  const source = objectOf(input)
  return ['w', 'weight', 'topW'].some(key => {
    const n = numericValue(source[key])
    return n != null && n > 0
  })
}

function hasExplicitWeightUnit(input) {
  const source = objectOf(input)
  return ['unit', 'weightUnit', 'loadUnit'].some(key => !!normalizeWeightUnit(source[key]))
}

// A container may have a unit of its own, but that does not make an explicitly weighted child
// safe when the child itself has no provenance. Keep walking the raw shape rather than stamping
// or otherwise changing it; callers can then fail closed while the user's original JSON stays
// intact for repair/export.
function hasMissingWeightUnit(input) {
  const source = objectOf(input)
  if (hasDirectPositiveWeight(source) && !hasExplicitWeightUnit(source)) return true
  if (source.result && hasMissingWeightUnit(source.result)) return true
  if (source.target && typeof source.target === 'object' && hasMissingWeightUnit(source.target)) return true
  if (Array.isArray(source.sets) && source.sets.some(set => hasMissingWeightUnit(set))) return true
  if (Array.isArray(source.entries) && source.entries.some(entry => hasMissingWeightUnit(entry))) return true
  return false
}

/** Normalize the weight unit attached to a profile, target, entry, workout, or set. */
export function normalizeWeightUnit(value, fallback = null) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.unit : value
  const token = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (WEIGHT_UNIT_ALIASES[token]) return WEIGHT_UNIT_ALIASES[token]
  if (fallback == null) return null
  const fallbackToken = typeof fallback === 'string' ? fallback.trim().toLowerCase() : ''
  return WEIGHT_UNIT_ALIASES[fallbackToken] || null
}

function modeFromUnit(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.unit : value
  const token = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return MODE_UNIT_ALIASES[token] || null
}

function collectWeightUnits(input, out = new Set()) {
  const source = objectOf(input)
  const weighted = hasPositiveWeight(source)
  for (const key of ['unit', 'weightUnit', 'loadUnit']) {
    const unit = normalizeWeightUnit(source[key])
    if (unit && weighted) out.add(unit)
  }
  if (source.target && typeof source.target === 'object') collectWeightUnits(source.target, out)
  if (source.result && typeof source.result === 'object') collectWeightUnits(source.result, out)
  if (Array.isArray(source.sets)) source.sets.forEach(set => collectWeightUnits(set, out))
  if (Array.isArray(source.entries)) source.entries.forEach(entry => collectWeightUnits(entry, out))
  return out
}

function hasUnknownWeightUnit(input) {
  const source = objectOf(input)
  const weighted = hasPositiveWeight(source)
  for (const key of ['unit', 'weightUnit', 'loadUnit']) {
    const raw = source[key]
    if (weighted && raw != null && raw !== '' && !normalizeWeightUnit(raw)) return true
  }
  if (source.result && typeof source.result === 'object' && hasUnknownWeightUnit(source.result)) return true
  if (source.target && typeof source.target === 'object' && hasUnknownWeightUnit(source.target)) return true
  if (Array.isArray(source.sets) && source.sets.some(set => hasUnknownWeightUnit(set))) return true
  if (Array.isArray(source.entries) && source.entries.some(entry => hasUnknownWeightUnit(entry))) return true
  return false
}

function hasExplicitWeightUnitBelow(input) {
  const source = objectOf(input)
  const children = [source.result, source.target,
    ...(Array.isArray(source.sets) ? source.sets : []),
    ...(Array.isArray(source.entries) ? source.entries : [])]
  const entries = Array.isArray(source.entries) ? source.entries : []
  const weightedEntries = entries.filter(entry => hasPositiveWeight(entry))
  if (weightedEntries.length > 1
    && weightedEntries.some(entry => hasExplicitWeightUnit(entry))
    && weightedEntries.some(entry => !hasExplicitWeightUnit(entry))) return true
  return children.filter(child => child != null).some(child => {
    const childSource = objectOf(child)
    const isContainer = Array.isArray(childSource.sets) || Array.isArray(childSource.entries)
    if (hasDirectPositiveWeight(child) && !isContainer) return hasExplicitWeightUnit(child)
    return hasExplicitWeightUnitBelow(child)
  })
}

function hasPartialMissingWeightUnit(input) {
  // The current object is a provenance boundary too. A workout/entry unit is not an implicit
  // stamp for a positive descendant: every positive weighted object must carry its own unit.
  return hasMissingWeightUnit(input)
    && (hasExplicitWeightUnit(input) || hasExplicitWeightUnitBelow(input))
}

const WORK_LOAD_FIELDS = [
  'w', 'weight', 'resolvedWeight', 'weightPrescription', 'load', 'loadMode', 'loadPercent', 'loadFallback',
  'workW', 'workWeight', 'workResolvedWeight', 'workWeightPrescription', 'workLoad', 'workLoadMode',
  'workLoadPercent', 'workLoadFallback'
]

/** Clone a target while removing work-load fields; explicitly nested warm-up branches are kept. */
export function withoutWorkLoad(input) {
  const scrub = (value, preserveLoad = false) => {
    if (Array.isArray(value)) return value.map(item => scrub(item, preserveLoad))
    if (!value || typeof value !== 'object') return value
    const out = {}
    Object.entries(value).forEach(([key, child]) => {
      const warmupBranch = /^warmup/i.test(key)
      if (!preserveLoad && WORK_LOAD_FIELDS.includes(key)) return
      out[key] = scrub(child, preserveLoad || warmupBranch)
    })
    return out
  }
  return scrub(input)
}

/**
 * Resolve the weight unit for a history record.
 *
 * New records carry an explicit kg/lb value. Older locally-created records do not; they remain
 * explicitly classified as `legacy` so compatibility can preserve the old profile-local
 * behaviour without pretending that the source unit was known. More than one explicit unit in
 * one record is ambiguous and returns null; silently selecting the first set would make
 * progression and PRs combine incomparable numbers.
 */
export function historyUnitFor(input, fallback = null) {
  if (hasUnknownWeightUnit(input) || hasPartialMissingWeightUnit(input)) return null
  const units = collectWeightUnits(input)
  if (units.size > 1) return null
  // `fallback` remains in the signature for callers compiled against the old helper. It is not
  // used for the legacy classification: callers can decide whether legacy data is acceptable
  // for their profile, while explicit kg/lb data can never cross units.
  return units.size === 1 ? [...units][0] : LEGACY_WEIGHT_UNIT
}

/** True when a single history record explicitly combines kg and lb values. */
export function historyUnitAmbiguous(input) {
  return hasUnknownWeightUnit(input) || hasPartialMissingWeightUnit(input) || collectWeightUnits(input).size > 1
}

/** True only when a history record can safely be read in the requested unit family. */
export function historyUnitCompatible(input, expectedUnit = null) {
  if (historyUnitAmbiguous(input)) return false
  const expected = normalizeWeightUnit(expectedUnit)
  const unit = historyUnitFor(input)
  // No provenance at all = legacy main-schema record: assume the profile unit so
  // normal persisted history (which never wrote units) stays visible. Records that
  // DO carry unit fields are still fail-closed on ambiguity/mismatch.
  if (!unit) return true
  if (!expected) return true
  // Unit-less records are the original profile-local history shape. Their loads were entered
  // under the active profile unit, so keep them visible without claiming that the serialized
  // source unit was known. Ambiguous records were rejected above before this compatibility path.
  if (unit === LEGACY_WEIGHT_UNIT) return true
  return unit === expected
}

/** Apply a workout's explicit provenance to an entry without overwriting an existing/unknown tag. */
export function historyEntryCompatible(entry, expectedUnit = null, inheritedUnit = null) {
  const source = objectOf(entry)
  const hasUnitField = ['unit', 'weightUnit', 'loadUnit'].some(key => source[key] != null && source[key] !== '')
  const inherited = normalizeWeightUnit(inheritedUnit)
  const contextual = inherited && !hasUnitField ? { ...source, unit: inherited } : source
  return historyUnitCompatible(contextual, expectedUnit)
}

/** A live workout cannot change labels while its frozen source unit is in use. */
export function canChangeWeightUnit(state, nextUnit) {
  const source = objectOf(state)
  const next = normalizeWeightUnit(nextUnit)
  const current = normalizeWeightUnit(source.unit)
  if (!next || !current) return false
  if (!source.active) return true
  const frozen = normalizeWeightUnit(source.active.unit ?? source.active.sourceUnit)
  return next === current && (!frozen || frozen === current)
}

function finite(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function nonNegative(value, fallback = 0) {
  const n = finite(value)
  return n == null || n < 0 ? fallback : n
}

/** Read a confirmed working-weight cache only when its unit is explicit and current. */
export function cachedWeightFor(cache, expectedUnit) {
  const source = objectOf(cache)
  const unit = normalizeWeightUnit(source.unit)
  const expected = normalizeWeightUnit(expectedUnit)
  const weight = finite(source.w)
  return unit && expected && unit === expected && weight != null && weight > 0 ? weight : 0
}

/** Create a unit-tagged confirmed working-weight cache entry. */
export function weightCacheEntry(weight, date, unit) {
  const normalized = normalizeWeightUnit(unit)
  const value = finite(weight)
  if (!normalized || value == null || value < 0) return null
  return { w: value, d: date, unit: normalized }
}

function positiveInt(value, fallback = 1) {
  const n = finite(value)
  return n == null || n < 1 ? fallback : Math.max(1, Math.round(n))
}

function optionalCap(value) {
  const n = finite(value)
  return n == null || n <= 0 ? null : Math.max(1, Math.round(n))
}

function optionalWeightPrescription(source, fallbackWeight) {
  const raw = objectOf(source.weightPrescription ?? source.load)
  const marker = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : ''
  if (marker === 'percentage' || marker === 'workset_percent' || raw.percent != null) {
    const percent = finite(raw.percent)
    if (percent != null && percent > 0) return {
      kind: marker === 'workset_percent' ? 'workset_percent' : 'percentage', percent: Math.min(200, percent),
      fallbackWeight: nonNegative(raw.fallbackWeight ?? raw.fallback, fallbackWeight)
    }
  }
  if (raw.kind === 'fixed' && has(raw, 'weight')) return { kind: 'fixed', weight: nonNegative(raw.weight, fallbackWeight) }
  return null
}

export function normalizePhase(value, fallback = 'work') {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (v === 'warmup' || v === 'warm-up' || v === 'warm_up') return 'warmup'
  if (v === 'work') return 'work'
  return fallback === 'warmup' ? 'warmup' : 'work'
}

/** Normalize an optional ordered phase selection without turning unknown values into work. */
export function normalizePhaseList(value, fallback = null) {
  if (value == null || value === '') {
    if (fallback == null) return null
    return normalizePhaseList(fallback, null)
  }
  const raw = Array.isArray(value) ? value : String(value).split(/[,+]/)
  const out = []
  raw.forEach(item => {
    const token = typeof item === 'string' ? item.trim().toLowerCase() : ''
    const phase = token === 'warmup' || token === 'warm-up' || token === 'warm_up'
      ? 'warmup' : token === 'work' ? 'work' : null
    if (phase && !out.includes(phase)) out.push(phase)
  })
  return out
}

/** Whether a target's authoritative phase selection contains warm-up but no work phase. */
export function isWarmupOnlyTarget(input = {}, fallback = {}) {
  const source = objectOf(input)
  const defaults = objectOf(fallback)
  const phases = normalizePhaseList(has(source, 'phases') ? source.phases : defaults.phases)
  return phases != null && !phases.includes('work')
}

export function normalizeMode(value, fallback = 'reps') {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (MODES.includes(v)) return v
  return MODES.includes(fallback) ? fallback : 'reps'
}

export function normalizeTargetKind(value, fallback = 'fixed') {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (v === 'amrap' || v === 'as-many-as-possible' || v === 'as_many_as_possible') return 'amrap'
  if (v === 'fixed') return 'fixed'
  return fallback === 'amrap' ? 'amrap' : 'fixed'
}

function targetKindOf(source, defaults) {
  const explicit = source.kind ?? source.targetKind ?? source.targetType ?? source.type
  if (source.amrap === true || source.isAmrap === true) return 'amrap'
  if (typeof source.reps === 'string' && source.reps.trim().toLowerCase() === 'amrap') return 'amrap'
  if (typeof source.sec === 'string' && source.sec.trim().toLowerCase() === 'amrap') return 'amrap'
  return normalizeTargetKind(explicit, defaults.kind || 'fixed')
}

function modeOf(source, defaults) {
  if (source.mode === 'amrap') return normalizeMode(defaults.mode, 'reps')
  if (has(source, 'mode')) return normalizeMode(source.mode, defaults.mode || 'reps')
  if (valueOf(source, ['sec', 'seconds', 'durationSec']) != null) return 'time'
  if (valueOf(source, ['min', 'speed']) != null) return 'cardio'
  if (modeFromUnit(source.unit)) return modeFromUnit(source.unit)
  return normalizeMode(defaults.mode, 'reps')
}

function valueOf(source, names) {
  for (const name of names) if (has(source, name)) return source[name]
  return undefined
}

// A logged row can carry a mode explicitly, or can be identified by the result fields that
// were available before `mode` was persisted. Null canonical placeholders are deliberately not
// signals: a normalised timed row has `r: null`, for example. Explicit row mode is authoritative,
// followed by the parent target mode. Only a row with neither authority may use its legacy result
// fields, retaining the historic time/cardio precedence for that single row.
function rawResultSignalsOf(input) {
  const source = objectOf(input)
  const result = objectOf(source.result)
  const hasValue = names => valueOf(source, names) != null || valueOf(result, names) != null
  const signals = []
  if (hasValue(['min', 'speed'])) signals.push('cardio')
  if (hasValue(['sec', 'seconds', 'durationSec'])) signals.push('time')
  if (hasValue(['r', 'reps', 'actualReps'])) signals.push('reps')
  const unitMode = modeFromUnit(source.unit ?? result.unit)
  if (unitMode) signals.push(unitMode)
  return [...new Set(signals)]
}

// A single legacy row sometimes contains a real duration and a stale reps field from an
// earlier mode. Keep the raw fields (normalizeLoggedSet does that below), but retain the old
// duration/cardio precedence when no explicit row or parent mode exists. Different rows with
// different resolved modes are still rejected by modeForEntry, so this does not combine a reps
// row with a timed row.
function resultSignalsOf(input) {
  const raw = rawResultSignalsOf(input)
  if (raw.includes('cardio')) return ['cardio']
  if (raw.includes('time')) return ['time']
  if (raw.includes('reps')) return ['reps']
  return []
}

function explicitModeOf(input) {
  const source = objectOf(input)
  const result = objectOf(source.result)
  for (const value of [source.mode, result.mode]) {
    const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (MODES.includes(token)) return token
  }
  return modeFromUnit(source.unit ?? result.unit)
}

function inferredTargetModeOf(input) {
  const source = objectOf(input)
  const direct = explicitModeOf(source)
  if (direct) return direct
  const token = typeof source.mode === 'string' ? source.mode.trim().toLowerCase() : ''
  if (token === 'amrap') return 'reps'
  if (valueOf(source, ['min', 'speed']) != null) return 'cardio'
  if (valueOf(source, ['sec', 'seconds', 'durationSec']) != null) return 'time'
  if (valueOf(source, ['reps', 'targetReps', 'minReps', 'amrapMinReps']) != null) return 'reps'
  return null
}

/**
 * Resolve the mode of one logged set without allowing a stale field from another mode to
 * leak into calculations. An explicit set mode wins because a warm-up can legitimately use
 * reps while the work target for the same exercise uses time. If neither the set nor target
 * recorded a mode, legacy result fields provide the only safe signal.
 */
export function modeForSet(input, target = {}) {
  const source = objectOf(input)
  const targetSource = objectOf(target)
  const rowMode = explicitModeOf(source)
  if (rowMode) return rowMode
  const parentMode = inferredTargetModeOf(targetSource)
  if (parentMode) return parentMode
  const resultMode = resultSignalsOf(source)[0]
  if (resultMode) return resultMode
  return 'reps'
}

/** Infer an entry mode from the same authoritative row/parent resolution as modeForSet. */
export function modeForEntry(input, fallback = null) {
  const source = objectOf(input)
  const target = has(source, 'target') ? objectOf(source.target) : source
  const sets = Array.isArray(source.sets) ? source.sets : []
  const workSets = sets.filter(set => phaseForSet(set) === 'work')
  const observedSets = workSets.length ? workSets : sets
  const signalModes = [...new Set(observedSets.map(set => modeForSet(set, target)))]
  const targetMode = inferredTargetModeOf(target)
  // A record containing incompatible work rows has no safe single unit family. Returning null
  // makes progression/statistics skip it instead of selecting whichever row happened to appear
  // first. Explicit row modes can therefore remain mixed only where the consumer intentionally
  // handles rows one at a time.
  if (signalModes.length > 1) return null
  const signal = signalModes[0] || null
  if (signal) return signal
  if (targetMode) return targetMode
  if (fallback != null) return normalizeMode(fallback, 'reps')
  return modeForSet(source, target)
}

/**
 * Normalize a planned target.
 *
 * Canonical reps/time shape:
 *   { phase, mode, kind, sets, reps, amrapMinReps, sec, weight }
 * `reps` is the fixed goal; `amrapMinReps` is the AMRAP minimum; `sec` is the fixed or timed
 * AMRAP minimum duration. Inapplicable numeric fields are null,
 * rather than undefined, so JSON round-trips preserve the shape. Cardio is retained as a
 * legacy-compatible mode with its min/speed fields, although new target kinds are reps/time.
 */
export function amrapMinRepsFor(input, fallback = null) {
  const source = objectOf(input)
  const value = valueOf(source, ['amrapMinReps', 'minReps', 'reps', 'targetReps'])
  const n = finite(value ?? fallback)
  return n == null || n < 1 ? null : Math.max(1, Math.round(n))
}

export function normalizeTarget(input, defaults = {}) {
  const source = objectOf(input)
  const fallback = objectOf(defaults)
  const phases = normalizePhaseList(has(source, 'phases') ? source.phases : fallback.phases)
  const warmupOnly = phases != null && !phases.includes('work')
  const phase = normalizePhase(source.phase, normalizePhase(fallback.phase, 'work'))
  const mode = modeOf(source, fallback)
  const kind = targetKindOf(source, fallback)
  const sets = positiveInt(valueOf(source, ['sets']) ?? fallback.sets, 1)
  const weight = nonNegative(valueOf(source, ['weight', 'w']) ?? fallback.weight, 0)
  const phaseSelection = phases == null ? {} : { phases }
  const weightField = warmupOnly ? {} : { weight }

  if (mode === 'cardio') {
    return {
      phase, ...phaseSelection, mode, kind: 'fixed', sets, reps: null, sec: null, ...weightField,
      min: nonNegative(valueOf(source, ['min']) ?? fallback.min, 20),
      speed: nonNegative(valueOf(source, ['speed']) ?? fallback.speed, 8)
    }
  }

  const repsValue = valueOf(source, ['amrapMinReps', 'reps', 'targetReps', 'minReps'])
  const secValue = valueOf(source, ['sec', 'seconds', 'durationSec', 'targetSec', 'minSec'])
  const amrapMinReps = kind === 'amrap' && mode === 'reps'
    ? amrapMinRepsFor(source, amrapMinRepsFor(fallback, fallback.reps))
    : null
  const reps = mode === 'reps'
    ? nonNegative(typeof repsValue === 'string' && repsValue.trim().toLowerCase() === 'amrap' ? null : repsValue ?? fallback.reps, null)
    : null
  const sec = mode === 'time'
    ? nonNegative(typeof secValue === 'string' && secValue.trim().toLowerCase() === 'amrap' ? null : secValue ?? fallback.sec, null)
    : null

  const out = { phase, ...phaseSelection, mode, kind, sets, reps, sec, ...weightField }
  if (amrapMinReps != null) out.amrapMinReps = amrapMinReps
  if (kind === 'amrap' && mode === 'time') {
    const maxSec = optionalCap(valueOf(source, ['amrapMaxSec', 'maxDurationSec', 'cap', 'maxSec']) ?? fallback.amrapMaxSec)
    if (maxSec != null) out.amrapMaxSec = maxSec
  }
  const unit = normalizeWeightUnit(source.unit ?? source.weightUnit)
  if (unit) out.unit = unit
  const prescription = warmupOnly ? null : optionalWeightPrescription(source, weight)
  if (prescription) out.weightPrescription = prescription
  return out
}

/** Normalize one planned set/block while retaining an explicit phase on the block. */
export function normalizePlannedSet(input, defaults = {}) {
  const source = objectOf(input)
  const targetInput = has(source, 'target') ? source.target : source
  const target = normalizeTarget(targetInput, defaults)
  const phase = phaseForSet(source, target.phase)
  return { phase, target: { ...target, phase } }
}

/**
 * Normalize one logged set. The existing flat result fields are retained for compatibility:
 * `w` is weight, `r` is actual reps, and `sec` is actual held seconds. A result for the other
 * mode is represented by null rather than being guessed or copied across a mode switch.
 */
export function normalizeLoggedSet(input, targetInput = {}) {
  const source = objectOf(input)
  const target = normalizeTarget(targetInput)
  const result = objectOf(source.result)
  const mode = modeForSet(source, targetInput)
  const phase = phaseForSet(source, target.phase)
  const done = source.done === true
  const w = nonNegative(valueOf(source, ['w', 'weight']) ?? valueOf(result, ['w', 'weight']), 0)
  const repsValue = valueOf(source, ['r', 'reps', 'actualReps']) ?? valueOf(result, ['r', 'reps', 'actualReps'])
  const secValue = valueOf(source, ['sec', 'seconds', 'actualSec']) ?? valueOf(result, ['sec', 'seconds', 'actualSec'])
  const r = mode === 'reps' ? nonNegative(repsValue, 0) : null
  const sec = mode === 'time' ? nonNegative(secValue, 0) : null
  const cap = optionalCap(valueOf(source, ['cap']) ?? target.cap)
  const out = { phase, done, w, r, sec, cap }
  const rawSignals = rawResultSignalsOf(source)
  if (rawSignals.length > 1) {
    // Never overwrite an ambiguous imported row with null placeholders and lose what the user
    // actually logged. The canonical mode follows the historic time/cardio precedence above;
    // rawResult makes the discarded secondary field auditable and survives another load/save.
    const rawResult = {}
    for (const key of ['r', 'reps', 'actualReps', 'sec', 'seconds', 'actualSec', 'min', 'minutes', 'speed']) {
      if (has(source, key)) rawResult[key] = source[key]
      else if (has(result, key)) rawResult[key] = result[key]
    }
    out.rawResult = rawResult
  }
  const unit = normalizeWeightUnit(source.unit ?? result.unit)
  if (unit) out.unit = unit
  if (mode === 'cardio') {
    out.min = nonNegative(valueOf(source, ['min', 'minutes']) ?? valueOf(result, ['min', 'minutes']), 0)
    out.speed = nonNegative(valueOf(source, ['speed']) ?? valueOf(result, ['speed']), 0)
  }
  return out
}

/**
 * Normalize a logged exercise entry. Missing legacy targets are reconstructed from the entry
 * and its first set only; no array position is consulted for phase.
 */
export function normalizeEntry(input, defaults = {}) {
  const source = objectOf(input)
  const rawSets = Array.isArray(source.sets) ? source.sets : []
  const nestedTarget = objectOf(source.target)
  const hasNestedTarget = has(source, 'target') && Object.keys(nestedTarget).length > 0
  // Flat target fields are an explicit plan shape. Nested logged rows are results, not a
  // prescription: never turn their first weight/reps/sec into a target for old history.
  const hasFlatTarget = has(source, 'mode') || has(source, 'reps') || has(source, 'sec')
    || has(source, 'seconds') || has(source, 'durationSec') || has(source, 'min') || has(source, 'speed')
    || has(source, 'weight') || has(source, 'kind') || has(source, 'targetKind') || has(source, 'targetType')
    || has(source, 'cap') || has(source, 'prog') || has(source, 'weightPrescription') || has(source, 'load')
    || (has(source, 'sets') && typeof source.sets === 'number')
  const targetSource = hasNestedTarget ? nestedTarget : hasFlatTarget ? source : null
  const target = targetSource ? normalizeTarget(targetSource, { ...defaults, phase: source.phase ?? defaults.phase }) : null
  const phase = phaseForSet(source, target?.phase || defaults.phase)
  const targetForSets = target ? { ...target, phase } : { phase }
  const out = {
    id: source.id ?? null,
    phase,
    ...(target ? { target: { ...target, phase } } : {}),
    sets: rawSets.map(set => normalizeLoggedSet(set, targetForSets))
  }
  const unit = normalizeWeightUnit(source.unit ?? source.weightUnit)
  if (unit) out.unit = unit
  if (finite(source.topW) != null) out.topW = nonNegative(source.topW, 0)
  return out
}

function normalizedSetForEligibility(set, target) {
  const t = normalizeTarget(target ?? set)
  const source = objectOf(set)
  const explicitSetMode = typeof source.mode === 'string' && MODES.includes(source.mode.trim().toLowerCase())
    ? normalizeMode(source.mode, 'reps') : null
  return { set: normalizeLoggedSet(set, t), target: t, mode: modeForSet(set, target ?? t), explicitSetMode }
}

/** A completed, explicitly work-phase set is eligible for progression/stall calculations. */
export function isProgressionEligible(set, target, expectedUnit = null) {
  if (!historyUnitCompatible(set, expectedUnit)) return false
  if (isWarmupRow(set)) return false
  const { set: normalized } = normalizedSetForEligibility(set, target)
  return normalized.done && normalized.phase === 'work'
}

/**
 * Default 1RM input is limited to completed work-phase repetition sets with a real load and
 * at least one actual rep. AMRAP caps are not applied to the actual result here: the caller can
 * decide whether a capped result is acceptable while the recorded result remains intact.
 */
export function is1RMEligible(set, target, expectedUnit = null) {
  if (!historyUnitCompatible(set, expectedUnit)) return false
  if (isWarmupRow(set)) return false
  const { set: normalized, target: normalizedTarget, mode, explicitSetMode } = normalizedSetForEligibility(set, target)
  return normalized.done && normalized.phase === 'work' && mode === 'reps'
    && normalizedTarget.mode === 'reps'
    && (!explicitSetMode || explicitSetMode === 'reps')
    && normalized.w > 0 && normalized.r >= 1
}

/** Completed reps volume; timed/cardio sets have no weight×rep volume and return zero. */
export function setVolume(set, target, expectedUnit = null) {
  if (!historyUnitCompatible(set, expectedUnit)) return 0
  const { set: normalized, target: normalizedTarget, mode, explicitSetMode } = normalizedSetForEligibility(set, target)
  if (!normalized.done || mode !== 'reps') return 0
  if (explicitSetMode && explicitSetMode !== mode) return 0
  if (normalized.phase === 'work' && normalizedTarget.mode !== 'reps' && explicitSetMode !== 'reps') return 0
  return normalized.w * normalized.r
}

/** Completed volume for an entry, preserving warm-up volume while ignoring timed/cardio rows. */
export function entryVolume(entry, expectedUnit = null, inheritedUnit = null) {
  if (!entry || !Array.isArray(entry.sets)) return 0
  if (!historyEntryCompatible(entry, expectedUnit, inheritedUnit)) return 0
  return entry.sets.reduce((total, set) => total + setVolume(set, entry.target || entry), 0)
}

/** Completed volume for a workout. This is the canonical persisted `workout.vol` calculation. */
export function workoutVolumeFromEntries(workout, expectedUnit = null) {
  if (!historyUnitCompatible(workout, expectedUnit)) return 0
  return (workout?.entries || []).reduce((total, entry) => total + entryVolume(entry, expectedUnit, workout.unit), 0)
}

function stampEntryWeightUnits(entry, unit) {
  const source = objectOf(entry)
  if (!hasPositiveWeight(source)) return { ...source }
  const out = { ...source, unit }
  if (source.target && typeof source.target === 'object') out.target = { ...source.target, unit }
  if (Array.isArray(source.sets)) {
    out.sets = source.sets.map(set => hasPositiveWeight(set) ? { ...set, unit } : { ...set })
  }
  return out
}

/** Stamp a finished workout with the unit in force when its loads were logged. */
export function stampCompletedWorkout(workout, unit) {
  const out = { ...objectOf(workout) }
  const normalized = normalizeWeightUnit(unit)
  if (normalized) {
    out.unit = normalized
    if (Array.isArray(out.entries)) out.entries = out.entries.map(entry => stampEntryWeightUnits(entry, normalized))
  }
  return out
}
