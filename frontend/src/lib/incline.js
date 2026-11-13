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

/* ---------------------------------------------------------------- resistance level -- */
//
// The same idea for the machines that have no grade but a resistance knob (Discord "Add the
// resistance level selector for cardio machines", 2026-11-05): an exercise bike, a rower, a cross
// trainer, a stepper. `level` on the set, 1 to 30, a whole step: { min: 20, speed: 25, level: 8 }.
// Optional and additive in exactly the way `incline` is.
export const LEVEL_MAX = 30

/** A typed or stepped level as it is stored: a whole number from 1 to 30; nothing (or 0) is no level. */
export function clampLevel(v) {
  if (v == null || v === '') return null
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(LEVEL_MAX, n)
}

const LEVELED = /bike|bicycl|cycl|spin|row(ing|er)?\b|\berg\b|elliptical|cross ?trainer|stepper|stepmill|stair ?master|stair climber machine|arc trainer|ski ?erg/i
const LEVELED_EQ = new Set(['stationary bike', 'elliptical machine', 'stepmill machine', 'skierg machine', 'upper body ergometer'])
const NO_KNOB = /\brope\b|jump|jack|burpee|run|walk|swim|skat/i

/**
 * Whether a cardio exercise offers the resistance level: a catalogue or own exercise whose name
 * or equipment says bike, rower, elliptical, cross trainer or stepper. A run, a walk or a rope has
 * no knob to turn.
 */
export function levelFits(ex) {
  if (!ex || typeof ex !== 'object') return false
  const name = String(ex.n || '')
  // A treadmill has a grade, not a knob, and a bike outdoors has gears (whatever the catalogue
  // files "run on treadmill" under).
  if (/treadmill|outdoor|aqua/i.test(name)) return false
  if (NO_KNOB.test(name) && !LEVELED_EQ.has(String(ex.eq || '').toLowerCase())) return false
  return LEVELED.test(name) || LEVELED_EQ.has(String(ex.eq || '').toLowerCase())
}

/** Whether a set (or a routine slot) carries a level. */
export const hasLevel = s => Number(s?.level) > 0

/** What a new row takes over from the set it follows: its level, when it had one. */
export const levelFrom = s => (hasLevel(s) ? { level: Number(s.level) } : {})

/**
 * The cardio row's third column: 'level' or 'incline' or null. What the rows already carry wins,
 * so a log never changes column under you; a machine with both (an elliptical) opens on its
 * level, the one most people turn.
 */
export function cardioCol(ex, sets = []) {
  if (sets.some(hasLevel)) return 'level'
  if (sets.some(hasIncline)) return 'incline'
  if (levelFits(ex)) return 'level'
  if (inclineFits(ex)) return 'incline'
  return null
}
