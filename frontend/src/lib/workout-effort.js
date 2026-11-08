// The whole workout's effort, 1 to 10, as Apple Fitness asks for it after a workout: Easy (1-3),
// Moderate (4-6), Hard (7-8), All out (9-10). It goes to Apple Health with the workout (iOS 18,
// watchOS 11: HealthKit's workout effort score), and stays on the saved workout as `effort`.
//
// Settings → Apple Health → "Effort after a workout" (S.workoutEffort):
//   'ask'   the finish summary (phone and Apple Watch) asks for it; the default
//   'auto'  never asks: worked out from the effort of each set, logged or estimated
//   'never' never asks and writes none
//
// A saved workout carries `effort` (1-10, whole numbers) and `effortBy`: 'phone', 'watch' or
// 'auto'. The Apple Watch links its own rating to the workout it saved; the iPhone links the
// others (AppleHealthPlugin.swift), so one score is never written twice.
import { anchorsByWorkout, resolveSetRir } from './recovery.js'
import { isWarmupRow } from './workout-model.js'
import { bodyweightKgOf } from './structuralBalance.js'

export const EFFORT_MODES = ['ask', 'auto', 'never']
export const EFFORT_MIN = 1
export const EFFORT_MAX = 10
// Below this many sets with a known effort the average is a guess, and none is written.
export const AUTO_MIN_SETS = 3

export const effortModeOf = S => (EFFORT_MODES.includes(S?.workoutEffort) ? S.workoutEffort : 'ask')

/** A score as it is kept: a whole number from 1 to 10, or null for anything else. */
export function cleanEffort(v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= EFFORT_MIN && n <= EFFORT_MAX ? n : null
}

// Apple Fitness's four words, by the same bands.
export const EFFORT_LEVELS = [
  { max: 3, word: 'Easy' },
  { max: 6, word: 'Moderate' },
  { max: 8, word: 'Hard' },
  { max: 10, word: 'All out' },
]
export function effortWord(v) {
  const n = cleanEffort(v)
  if (n == null) return null
  return EFFORT_LEVELS.find(l => n <= l.max).word
}

/**
 * The workout's effort from its sets, for 'auto': the average of each finished work set's effort
 * on the RPE scale (RIR 2 is RPE 8), rounded to a whole number. A set nobody rated is estimated
 * from its load against the lifter's recent best (recovery.js resolveSetRir), the same reading
 * Stats and the muscle map give it. Warm-ups do not count. null when fewer than AUTO_MIN_SETS
 * sets have an effort at all: an empty workout or one of cardio nobody rated gets no score.
 */
export function autoEffort(S, w) {
  if (!w || !Array.isArray(w.entries)) return null
  const all = (S?.workouts || []).includes(w) ? S.workouts : [...(S?.workouts || []), w]
  const opts = { unit: S?.unit, bodyweightKg: S ? bodyweightKgOf(S) : null }
  const anchors = anchorsByWorkout(all, opts).get(w)
  let sum = 0, n = 0
  for (const e of w.entries) {
    for (const s of e?.sets || []) {
      if (!s?.done || isWarmupRow(s)) continue
      const r = resolveSetRir(s, s, e, w, anchors, opts)
      if (r == null || !Number.isFinite(r.rir)) continue
      sum += 10 - Math.max(0, r.rir)
      n++
    }
  }
  if (n < AUTO_MIN_SETS) return null
  return Math.min(EFFORT_MAX, Math.max(EFFORT_MIN, Math.round(sum / n)))
}

/**
 * Puts a score on a saved workout (`s` is the store's draft). `by` says who rated it. null takes
 * the score away. Returns the workout, or null when there is no workout with that id.
 */
export function setWorkoutEffort(s, wid, v, by, stamp = null) {
  const w = (s?.workouts || []).find(x => x && x.id === wid)
  if (!w) return null
  const n = cleanEffort(v)
  if (n == null) { delete w.effort; delete w.effortBy }
  else { w.effort = n; w.effortBy = by === 'watch' || by === 'auto' ? by : 'phone' }
  if (stamp) stamp(w)
  return w
}
