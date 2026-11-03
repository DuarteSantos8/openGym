import { FATIGUE_STATES, fatigueHalfLifeOf } from './recovery.js'
import { dateLocale } from './i18n-core.js'

/**
 * Select the consumer-facing fatigue state for one numeric recovery value.
 * Values below .25 are ready, .25 through .5 are recovering, and values above .5 are fatigued.
 * Keeping this boundary selector in production code prevents views and tests from drifting apart.
 *
 * @param {number} value Numeric fatigue value from fatigueOf().
 * @returns {'ready'|'recovering'|'fatigued'} The stable state label for the UI.
 */
export function fatigueStateOf(value) {
  return value < 0.25
    ? FATIGUE_STATES.READY
    : value <= 0.5
      ? FATIGUE_STATES.RECOVERING
      : FATIGUE_STATES.FATIGUED
}

// Boundaries fatigueStateOf draws: below READY_BELOW the muscle reads ready,
// at or below RECOVERING_BELOW (but above ready) it reads recovering.
export const FATIGUE_READY_BELOW = 0.25
export const FATIGUE_RECOVERING_BELOW = 0.5

/**
 * Milliseconds until a fatigued muscle drops back through the display bands,
 * assuming no new training. Exact, not simulated: after the last stimulus the
 * accumulated volume decays as one exponential with the muscle's own half-life,
 * so the crossing time solves in closed form from the saturation curve.
 *
 * @param {number} value Current fatigue value from fatigueOf(), in [0, 1).
 * @param {string} slug Drawable muscle slug (owns the half-life).
 * @returns {{toRecoveringMs: number|null, toReadyMs: number|null}} Null where already below the band.
 */
export function fatigueRecoveryMs(value, slug) {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= FATIGUE_READY_BELOW) return { toRecoveringMs: null, toReadyMs: null }
  const halfLife = fatigueHalfLifeOf(slug)
  if (!(halfLife > 0)) return { toRecoveringMs: null, toReadyMs: null }
  const v0 = -Math.log(1 - Math.min(v, 1 - 1e-9))
  const msFor = target => {
    if (v <= target) return null
    return Math.max(0, halfLife * Math.log2(v0 / -Math.log(1 - target)))
  }
  return { toRecoveringMs: msFor(FATIGUE_RECOVERING_BELOW), toReadyMs: msFor(FATIGUE_READY_BELOW) }
}

/**
 * Localised "in N hours/days" for a recovery duration, via the platform's own
 * plural rules (Intl.RelativeTimeFormat) so no locale pack carries the words.
 *
 * @param {number|null} ms Duration in milliseconds, or null when already recovered.
 * @returns {string|null} Localised duration, or null for null input.
 */
export function fmtRecoveryIn(ms) {
  if (ms == null || !(ms >= 0)) return null
  const minutes = Math.round(ms / 60000)
  const [n, unit] = minutes < 60 ? [Math.max(1, minutes), 'minute'] : minutes < 2880 ? [Math.max(1, Math.round(minutes / 60)), 'hour'] : [Math.max(1, Math.round(minutes / 1440)), 'day']
  try { return new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'always' }).format(n, unit) }
  catch { return `${n} ${unit}` }
}
