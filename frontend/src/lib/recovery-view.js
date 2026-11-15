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

/**
 * When each muscle that is still tired will be ready again (gm-live, 1.4.5): "Chest ready in
 * ~18 h (Thu 07:00)". From the same half-life model as the fatigue map, assuming no new training,
 * soonest first. Only muscles above the ready band; `fatigue` is fatigueOf()'s map, keyed by the
 * drawable muscles (since 1.4.5 the three delt heads and the lats on their own).
 *
 * @param {Record<string, number>} fatigue Fatigue values by muscle slug.
 * @param {number} now Current time in milliseconds.
 * @returns {Array<{slug: string, ms: number, at: number, state: string}>}
 */
export function recoveryEtas(fatigue, now) {
  const out = []
  for (const [slug, value] of Object.entries(fatigue || {})) {
    const { toReadyMs } = fatigueRecoveryMs(value, slug)
    if (toReadyMs == null || !(toReadyMs > 0)) continue
    out.push({ slug, ms: toReadyMs, at: now + toReadyMs, state: fatigueStateOf(value) })
  }
  return out.sort((a, b) => a.ms - b.ms || a.slug.localeCompare(b.slug))
}

/**
 * "~18 h" or "~3 d": a recovery duration short and approximate, in the platform's own unit words
 * (Intl.NumberFormat unit style) so no locale pack carries them. Hours up to two days, then days.
 */
export function fmtRecoveryShort(ms) {
  if (ms == null || !(ms >= 0)) return null
  const hours = ms / 3600000
  const [n, unit] = hours < 1 ? [Math.max(1, Math.round(ms / 60000)), 'minute'] : hours < 48 ? [Math.max(1, Math.round(hours)), 'hour'] : [Math.max(2, Math.round(hours / 24)), 'day']
  try { return '~' + new Intl.NumberFormat(dateLocale(), { style: 'unit', unit, unitDisplay: 'narrow' }).format(n) }
  catch { return `~${n} ${unit[0]}` }
}

/**
 * The moment itself, the way a person plans with it: "Thu 07:00", or just "07:00" when it is
 * still today. Rounded to the quarter hour, since the model is not that precise either.
 */
export function fmtReadyAt(at, now = Date.now()) {
  if (!Number.isFinite(at)) return null
  const q = 15 * 60000
  const d = new Date(Math.round(at / q) * q)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  try {
    const time = new Intl.DateTimeFormat(dateLocale(), { hour: 'numeric', minute: '2-digit' }).format(d)
    if (sameDay) return time
    return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' }).format(d) + ' ' + time
  } catch { return d.toISOString().slice(11, 16) }
}
