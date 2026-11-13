// Active energy for a workout logged on the phone (#724, D#917). Apple Health and Health Connect
// show a workout without calories as 0 kcal, and nothing on the phone measures them, so openGym
// writes an estimate: MET of what was done × body weight × time. The Apple Watch app measures its
// own and saves those instead (WorkoutManager.swift); this is only for the phone's copy.
//
// Active energy leaves out what the body burns at rest anyway (Apple Health adds that as resting
// energy on its own), so each MET counts minus the 1 MET of sitting still.
import { exerciseType, sessionType } from './health-connect.js'
import { hasCompletedWork, isWarmupRow, modeForEntry } from './workout-model.js'
import { bodyweightAt } from './relative-strength.js'

const LB_PER_KG = 2.2046226218

// Compendium of Physical Activities, rounded. Strength sits between "general" (3.5) and
// "vigorous" (6.0): a session with its rests in it, not one long set.
export const MET = {
  strength_training: 5, walking: 3.5, running: 9, biking_stationary: 7, biking: 7.5, elliptical: 5,
  stair_climbing_machine: 9, rowing: 7, jump_rope: 11, hiit: 8, mixed_cardio: 6, yoga: 2.5,
  flexibility: 2.3, other_workout: 4.5,
}

// No weigh-in at all: a grown-up of average weight, so the workout still gets something sane.
export const FALLBACK_KG = 75
// Body weights outside this are typos, not people (bodyKgFor).
export const MIN_BODY_KG = 20
export const MAX_BODY_KG = 400
// A workout left running overnight burns no more than a long one.
export const MAX_HOURS = 3

const metOf = type => MET[type] ?? MET.other_workout

// How hard it felt (1 to 10, "How hard it felt" on cardio) nudges the MET: 5 is as listed, 10 a
// good 40% more, 1 about a third less.
const effortFactor = rpe => {
  const r = Number(rpe)
  return r >= 1 && r <= 10 ? 0.6 + 0.08 * r : 1
}

/**
 * The body weight (kg) a workout is worked out with: the one the workout logged, else the weigh-in
 * nearest its day (any distance, an old one beats a guess), else FALLBACK_KG.
 */
export function bodyKgFor(S, w) {
  const toKg = v => (S?.unit === 'lb' ? v / LB_PER_KG : v)
  // A typo (800 instead of 80, a weight in grams) is no body weight: the next best is taken.
  const sane = v => Number.isFinite(v) && v >= MIN_BODY_KG && v <= MAX_BODY_KG
  const own = toKg(Number(w?.bw))
  if (sane(own)) return own
  const near = toKg(bodyweightAt(S?.bodyweight, Number(w?.start), Infinity))
  return sane(near) ? near : FALLBACK_KG
}

/**
 * Estimated active kcal for a finished workout, rounded, or null without a start and end. Cardio
 * with its minutes logged counts those minutes at its own MET (and effort); the rest of the
 * session counts at strength training's MET, or the session's own type when nothing was lifted.
 */
export function activeKcal(w, kg) {
  const start = Number(w?.start), end = Number(w?.end)
  if (!(start > 0) || !(end > start) || !(kg > 0)) return null
  const hours = Math.min(MAX_HOURS, (end - start) / 3600e3)
  const done = (w.entries || []).filter(e => (e.sets || []).some(hasCompletedWork))
  let cardioHours = 0, kcal = 0
  for (const e of done) {
    if (modeForEntry(e) !== 'cardio') continue
    const met = metOf(exerciseType(e))
    for (const s of e.sets || []) {
      if (isWarmupRow(s) || !hasCompletedWork(s)) continue
      const h = Math.max(0, Number(s.min) || 0) / 60
      if (!h) continue
      const take = Math.min(h, hours - cardioHours)
      if (take <= 0) break
      cardioHours += take
      kcal += (met * effortFactor(s.rpe) - 1) * kg * take
    }
  }
  const type = sessionType(w)
  const lifted = done.some(e => exerciseType(e) === 'strength_training')
  const base = metOf(lifted ? 'strength_training' : type)
  kcal += (base - 1) * kg * Math.max(0, hours - cardioHours)
  return Math.max(0, Math.round(kcal))
}
