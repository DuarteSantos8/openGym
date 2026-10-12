// Treadmill incline per cardio set (Discord "Add incline level for treadmill").
//
// A cardio set is minutes at a speed; `incline` is the grade on top of it, in percent, on the
// set itself: { min: 30, speed: 5.5, incline: 12, done: true }. It is optional everywhere. A set
// without it is a flat one, exactly what every set logged before this was, so nothing stored is
// ever rewritten and an older app that does not know the key leaves it alone (the server puts a
// key it never knew back from the stored copy, api/sync-stamps.js keepKeys).
import { isCustomEx } from './exercises.js'

// Treadmills top out around 15 %, incline trainers at 40 %. Half a percent is the finest step
// any of them shows.
export const INCLINE_MAX = 40
export const INCLINE_STEP = 0.5

/**
 * A typed or stepped incline as it is stored: on the half percent, between 0 and 40. Nothing
 * (a cleared field) stays nothing, so the key goes rather than holding a 0 nobody typed.
 */
export function clampIncline(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.min(INCLINE_MAX, Math.max(0, Math.round(n / INCLINE_STEP) * INCLINE_STEP))
}

// Where a grade means something: on the machines that have one, and on foot, where a hill is the
// same thing outdoors. Read off the catalogue's English name and equipment. A bike, a rower, a
// rope or a jumping jack has no incline to set, whatever else its name says.
const HILLY = /treadmill|\bwalk|\brun\b|running|\bjog|sprint|stepmill|stair|stepper|elliptical|cross ?trainer|\bhik(e|ing)|incline|trot|march/i
const FLAT = /bike|bicycl|cycl|row(ing|er)?\b|rope|skat|swim|\bski\b|erg\b|jack|burpee|punch|shuffle|hop|jump|climber|crawl/i
const HILLY_EQ = new Set(['elliptical machine', 'stepmill machine'])

/**
 * Whether a cardio exercise offers the incline column. A catalogue exercise does when its name
 * or equipment says treadmill, walking, running, stairs or elliptical. Your own exercise does
 * unless its name says it is a bike, a rower and the like: its name can be in any language, and
 * an optional field you never fill costs nothing.
 */
export function inclineFits(ex) {
  if (!ex || typeof ex !== 'object') return false
  const name = String(ex.n || '')
  if (FLAT.test(name)) return false
  if (HILLY.test(name) || HILLY_EQ.has(String(ex.eq || '').toLowerCase())) return true
  return isCustomEx(ex)
}

/** Whether a set carries a grade worth showing: anything above flat. */
export const hasIncline = s => Number(s?.incline) > 0

/** What a new row takes over from the set it follows: its incline, when it had one. */
export const inclineFrom = s => (hasIncline(s) ? { incline: Number(s.incline) } : {})
