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
// 3) Lean-mass hold: given an anchor weight + BF%, estimate BF% at other scale weights
//    assuming fat-free mass stays constant (rough trend tool, not a lab method).
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

/** Fat-free mass from scale weight + body-fat %. Same unit as weight. */
export function leanMassFromWeight(weight, bodyFatPct) {
  const w = Number(weight)
  const pct = Number(bodyFatPct)
  if (!Number.isFinite(w) || w <= 0) return null
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null
  return w * (1 - pct / 100)
}

/**
 * Estimate BF% at another scale weight, holding fat-free mass fixed.
 * @returns {number|null} body-fat %, one decimal
 */
export function estimateBodyFatAtWeight(weight, leanMass) {
  const w = Number(weight)
  const lean = Number(leanMass)
  if (!Number.isFinite(w) || w <= 0) return null
  if (!Number.isFinite(lean) || lean <= 0) return null
  if (lean >= w) return null
  return clampBodyFatPct(((w - lean) / w) * 100)
}

/** Whole inches → 5'9" display. */
export function formatFtIn(totalInches) {
  const n = Math.round(Number(totalInches))
  if (!Number.isFinite(n) || n <= 0) return '—'
  const ft = Math.floor(n / 12)
  const inch = ((n % 12) + 12) % 12
  return ft + "'" + inch + '"'
}

/** Clamp height in whole inches (typical adult range). */
export function clampHeightInches(n, min = 48, max = 90) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

export function bodyFatMethodLabel(method) {
  if (method === 'jp3') return 'Caliper'
  if (method === 'navy') return 'Tape'
  if (method === 'manual') return 'Manual'
  if (method === 'estimate' || method === 'estimated') return 'Est.'
  return method || ''
}
