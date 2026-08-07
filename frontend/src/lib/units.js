// Pure helpers for the canonical weight representation.
//
// Persisted weights are kilograms. A profile's display unit is a boundary concern: callers use
// kgFromStored when accepting a value in a profile/file unit and storedFromKg when rendering it.
// This module deliberately has no React, store, or browser dependencies.

export const CANONICAL_UNIT = 'kg'
export const LB_TO_KG = 0.45359237
export const KG_TO_LB = 1 / LB_TO_KG

const UNIT_FIELDS = new Set(['unit', 'u', 'weightUnit', 'storedUnit', 'weight_unit', 'loadUnit'])
const WEIGHT_FIELDS = new Set([
  'w', 'weight', 'topW', 'fallbackWeight', 'resolvedWeight', 'inc',
  'bw', 'workW', 'workWeight', 'workResolvedWeight', 'loadFallback', 'fallback'
])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function isPounds(unit) {
  return /^(?:lb|lbs|pound|pounds)$/i.test(String(unit ?? '').trim())
}

/** Normalize the supported display/source spellings without making unknown values hazardous. */
export function normalizeUnit(unit) {
  return isPounds(unit) ? 'lb' : CANONICAL_UNIT
}

/** Convert a stored/display weight into canonical kilograms. Unknown units are treated as kg. */
export function kgFromStored(value, unit = CANONICAL_UNIT) {
  const n = numeric(value)
  if (n === null) return value
  return isPounds(unit) ? n * LB_TO_KG : n
}

/** Convert canonical kilograms to a profile/file unit without display rounding. */
export function storedFromKg(value, unit = CANONICAL_UNIT) {
  const n = numeric(value)
  if (n === null) return value
  return isPounds(unit) ? n / LB_TO_KG : n
}

/**
 * Round a value for display controls before passing it to fmtNum.
 *
 * The app uses half-kilogram display increments and whole-pound increments. The larger 2.5 kg
 * and 5 lb progression jumps are policy increments, not a reason to lose precision in display
 * conversion.
 */
export function unitRound(value, unit = CANONICAL_UNIT) {
  const n = numeric(value)
  if (n === null) return value
  const step = isPounds(unit) ? 1 : 0.5
  return Math.round(n / step) * step
}

/** Bodyweight is already canonical after the state migration; the display unit is irrelevant. */
export function kgBodyweight(bwKg, _unit) {
  return bwKg
}

function unitOf(record, inheritedUnit) {
  if (isRecord(record)) {
    for (const key of UNIT_FIELDS) {
      if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') {
        return record[key]
      }
    }
  }
  return inheritedUnit
}

function convertWeight(value, unit) {
  return kgFromStored(value, unit)
}

function migrateNode(value, inheritedUnit = CANONICAL_UNIT) {
  if (Array.isArray(value)) return value.map(item => migrateNode(item, inheritedUnit))
  if (!isRecord(value)) return value

  const localUnit = unitOf(value, inheritedUnit)
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    // Unit metadata is a one-time migration input, never a field we write into canonical state.
    if (UNIT_FIELDS.has(key)) continue

    if (key === 'vol') {
      // Volume is recomputed from canonical rows below when possible. Keep a converted fallback
      // for legacy records that only carried the derived number.
      out[key] = numeric(child) === null ? child : convertWeight(child, localUnit)
      continue
    }

    if (WEIGHT_FIELDS.has(key) && numeric(child) !== null) {
      out[key] = convertWeight(child, localUnit)
      continue
    }

    // A direct numeric `bodyweight` is a weigh-in; the boolean bodyweight flag is not a load.
    if (key === 'bodyweight' && numeric(child) !== null) {
      out[key] = convertWeight(child, localUnit)
      continue
    }

    out[key] = migrateNode(child, localUnit)
  }

  if (Array.isArray(out.entries)) {
    const rows = out.entries.flatMap(entry => Array.isArray(entry?.sets) ? entry.sets : [])
    if (rows.length) {
      out.vol = rows.reduce((total, set) => {
        if (!set || set.done !== true) return total
        const w = numeric(set.w)
        const reps = numeric(set.r)
        return w === null || reps === null ? total : total + w * reps
      }, 0)
    }
  }

  return out
}

/**
 * Convert legacy workout records to canonical kilograms without mutating the input.
 *
 * Missing unit metadata is deliberately interpreted as kg: that is the representation used by
 * every pre-canonical openGym profile. Existing unit metadata may live on a workout, entry, set,
 * target, warm-up row, or weight prescription; it is consumed and removed. Therefore the result
 * has no per-set unit stamps and running this function again is a no-op.
 */
export function migrateWorkoutsToKg(workouts) {
  if (!Array.isArray(workouts)) return []
  return workouts.map(workout => migrateNode(workout, CANONICAL_UNIT))
}

// Descriptive aliases are useful to boundary callers while the canonical names remain the
// public contract for this slice.
export const toKg = kgFromStored
export const fromKg = storedFromKg
