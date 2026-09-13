// Body-fat estimators used by the log sheet.
//
// 1) Jackson–Pollock 3-site skinfolds (calipers, mm) → body density → Siri %BF
//    Men (Jackson & Pollock, Br J Nutr 1978): chest + abdomen + thigh
//    Women (Jackson, Pollock & Ward, Med Sci Sports Exerc 1980): triceps + suprailiac + thigh
//
// 2) U.S. Navy / Hodgdon–Beckett circumference method (tape, inches in the published eqs)
//    Men: neck + waist + height
//    Women: neck + waist + hip + height
//    Classic inch formulas (Hodgdon & Beckett, NHRC 1984). Inputs may be cm; we convert.
//
// Profile `body` ('male' | 'female') picks the sex-specific sites / equations — same field
// as the muscle diagram. `age` is years (JP3 only). `height` is stored in centimetres.

export const JP3_SITES_MALE = ['chest', 'abdomen', 'thigh']
export const JP3_SITES_FEMALE = ['triceps', 'suprailiac', 'thigh']

export const NAVY_CIRC_MALE = ['neck', 'waist']
export const NAVY_CIRC_FEMALE = ['neck', 'waist', 'hip']

export function isFemaleBody(body) {
  return body === 'female'
}

export function jp3SitesFor(body) {
  return isFemaleBody(body) ? JP3_SITES_FEMALE : JP3_SITES_MALE
}

export function navyCircKeysFor(body) {
  return isFemaleBody(body) ? NAVY_CIRC_FEMALE : NAVY_CIRC_MALE
}

/** Sum three skinfolds (mm). Returns null if any site is missing or non-positive. */
export function sumSkinfolds(sites, body) {
  const keys = jp3SitesFor(body)
  if (!sites || typeof sites !== 'object') return null
  let sum = 0
  for (const k of keys) {
    const v = Number(sites[k])
    if (!Number.isFinite(v) || v <= 0) return null
    sum += v
  }
  return sum
}

/**
 * Body density (g/cm³) from Jackson–Pollock 3-site equations.
 * @returns {number|null}
 */
export function jp3BodyDensity(sites, age, body) {
  const S = sumSkinfolds(sites, body)
  const A = Number(age)
  if (S == null || !Number.isFinite(A) || A < 10 || A > 100) return null
  if (isFemaleBody(body)) {
    return 1.0994921 - 0.0009929 * S + 0.0000023 * S * S - 0.0001392 * A
  }
  return 1.10938 - 0.0008267 * S + 0.0000016 * S * S - 0.0002574 * A
}

/** Siri conversion: density → body-fat percentage. */
export function siriBodyFatPct(density) {
  const d = Number(density)
  if (!Number.isFinite(d) || d <= 0) return null
  const pct = 495 / d - 450
  return Number.isFinite(pct) ? pct : null
}

/**
 * Full Jackson–Pollock 3-site estimate, rounded to one decimal.
 * @returns {number|null} body-fat %
 */
export function jp3BodyFatPct(sites, age, body) {
  const dens = jp3BodyDensity(sites, age, body)
  if (dens == null) return null
  const pct = siriBodyFatPct(dens)
  if (pct == null) return null
  return Math.round(pct * 10) / 10
}

export function cmToIn(cm) {
  const n = Number(cm)
  if (!Number.isFinite(n) || n <= 0) return null
  return n / 2.54
}

export function inToCm(inches) {
  const n = Number(inches)
  if (!Number.isFinite(n) || n <= 0) return null
  return n * 2.54
}

/** Length unit paired with the profile weight unit: lb → in, kg → cm. */
export function lengthUnitFor(weightUnit) {
  return weightUnit === 'lb' ? 'in' : 'cm'
}

/** Convert a UI length (cm or in) to inches for the Navy formulas. */
export function toInches(value, lengthUnit) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return lengthUnit === 'in' ? n : cmToIn(n)
}

/**
 * U.S. Navy circumference body-fat % (Hodgdon & Beckett).
 * @param {object} circ — { neck, waist, hip? } in the given lengthUnit
 * @param {number} height — height in the given lengthUnit
 * @param {'male'|'female'|string} body
 * @param {'cm'|'in'} lengthUnit
 * @returns {number|null}
 */
export function navyBodyFatPct(circ, height, body, lengthUnit = 'cm') {
  if (!circ || typeof circ !== 'object') return null
  const neck = toInches(circ.neck, lengthUnit)
  const waist = toInches(circ.waist, lengthUnit)
  const heightIn = toInches(height, lengthUnit)
  if (neck == null || waist == null || heightIn == null) return null
  if (waist <= neck) return null

  let pct
  if (isFemaleBody(body)) {
    const hip = toInches(circ.hip, lengthUnit)
    if (hip == null) return null
    const value = waist + hip - neck
    if (value <= 0) return null
    pct = 163.205 * Math.log10(value) - 97.684 * Math.log10(heightIn) - 78.387
  } else {
    pct = 86.010 * Math.log10(waist - neck) - 70.041 * Math.log10(heightIn) + 36.76
  }
  return clampBodyFatPct(pct)
}

export function clampBodyFatPct(n) {
  const v = Math.round(Number(n) * 10) / 10
  if (!Number.isFinite(v) || v <= 0 || v >= 80) return null
  return v
}

/** Short label for a saved method key. */
export function bodyFatMethodLabel(method) {
  if (method === 'jp3') return 'JP3'
  if (method === 'navy') return 'Navy'
  if (method === 'manual') return 'Manual'
  return method || ''
}
