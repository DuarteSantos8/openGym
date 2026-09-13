// Jackson–Pollock 3-site skinfold → body density → body-fat % (Siri).
//
// Men (Jackson & Pollock, Br J Nutr 1978): chest + abdomen + thigh
// Women (Jackson, Pollock & Ward, Med Sci Sports Exerc 1980): triceps + suprailiac + thigh
// %BF = 495 / density − 450 (Siri, 1961)
//
// Skinfolds are millimetres. Age is whole years. The profile's `body` field ('male' | 'female')
// picks the site set and equation — same field the muscle diagram already uses.

export const JP3_SITES_MALE = ['chest', 'abdomen', 'thigh']
export const JP3_SITES_FEMALE = ['triceps', 'suprailiac', 'thigh']

export function jp3SitesFor(body) {
  return body === 'female' ? JP3_SITES_FEMALE : JP3_SITES_MALE
}

export function isFemaleBody(body) {
  return body === 'female'
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

export function clampBodyFatPct(n) {
  const v = Math.round(Number(n) * 10) / 10
  if (!Number.isFinite(v) || v <= 0 || v >= 80) return null
  return v
}
