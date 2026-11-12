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

// The seconds wheel steps by 1 (00 to 59) or, when the profile says so (S.wheelStep, Settings ›
// Workout), by 5 (00, 05 … 55). Anything else in the profile reads as 1, the default.
export const WHEEL_STEPS = [1, 5]

/** The seconds wheel's step for a profile: 5 when S.wheelStep is 5, else 1. */
export const wheelStepOf = S => (S && S.wheelStep === 5 ? 5 : 1)

/** How many rows the seconds wheel has: 60 at a 1-second step, 12 at 5. */
export const secRows = step => 60 / (step || 1)

/** The seconds a row stands for: row 3 is 15 s at a 5-second step. */
export const secAt = (row, step) => row * (step || 1)

/** The row a number of seconds sits on, rounded down to the grid: 6 s is row 1 (05) at a 5-second step. */
export const secRow = (s, step) => Math.floor((Number(s) || 0) / (step || 1))

/** A duration on the seconds wheel's grid, rounded down: 1:06 is 1:05 at a 5-second step. */
export const snapDuration = (sec, step) => Math.floor((Number(sec) || 0) / (step || 1)) * (step || 1)

/** Rows Page Up/Down jump on the seconds wheel: about 10 seconds, at least one row. */
export const secPage = step => Math.max(1, Math.round(10 / (step || 1)))

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

/** Where a rest wheel opens (#735): on the rest of its own, else on the one that applies without
 *  it, so the dials show the break you'd actually get instead of sitting at 0:00. */
export const restWheelValue = (own, applies) => (own > 0 ? Math.round(own) : applies > 0 ? Math.round(applies) : 0)
