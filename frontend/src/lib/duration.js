// Durations in whole seconds, as the rest timer stores them (S.restSec, S.restPauseSec, an
// exercise's target.restSec). The scroll-wheel picker (components/DurationWheel.jsx) reads and
// writes them as minutes + seconds, and every place that shows one goes through fmtDuration, so
// a value off the old 60/90/120/150/180 list ("1:45") reads the same everywhere.
import { t, tn } from './i18n.js'

// The rest timer's range: 0 is "no rest timer", 15 minutes the most a wheel offers.
export const REST_MAX = 15 * 60
// A rest-pause burst's rest: never 0 (lib/history.js clamps it to 5 s), five minutes at most.
export const REST_PAUSE_MIN = 5
export const REST_PAUSE_MAX = 5 * 60

/** Whole seconds within [min, max]. Anything that is not a number reads as `min`. */
export function clampDuration(sec, min = 0, max = REST_MAX) {
  const n = Math.round(Number(sec))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** { m, s } for a number of seconds: 90 → { m: 1, s: 30 }. */
export function splitDuration(sec) {
  const n = Math.max(0, Math.round(Number(sec)) || 0)
  return { m: Math.floor(n / 60), s: n % 60 }
}

/** Minutes and seconds back into seconds, clamped to the wheel's range. */
export function joinDuration(m, s, min = 0, max = REST_MAX) {
  return clampDuration((Number(m) || 0) * 60 + (Number(s) || 0), min, max)
}

/**
 * The short form a row shows: "45s" under a minute, "1:30" from a minute up, "Off" for 0 when
 * the caller says 0 means off. Digits stay Western, like the rest of the app's numbers.
 */
export function fmtDuration(sec, { off = null } = {}) {
  const n = Math.max(0, Math.round(Number(sec)) || 0)
  if (!n && off != null) return off
  if (n < 60) return n + 's'
  const { m, s } = splitDuration(n)
  return m + ':' + String(s).padStart(2, '0')
}

/**
 * What a screen reader says: "1 minute 30 seconds", "45 seconds", "2 minutes". 0 is `off` when
 * given (the rest timer's "Off"), "0 seconds" otherwise.
 */
export function durationText(sec, { off = null } = {}) {
  const { m, s } = splitDuration(sec)
  if (!m && !s) return off != null ? off : tn('{0} second', '{0} seconds', 0)
  return [m ? tn('{0} minute', '{0} minutes', m) : null, s ? tn('{0} second', '{0} seconds', s) : null]
    .filter(Boolean).join(' ')
}

/** The rest timer's own wording for a row or a preview: "1:30" or "Off". */
export const fmtRest = sec => fmtDuration(sec, { off: t('Off') })
