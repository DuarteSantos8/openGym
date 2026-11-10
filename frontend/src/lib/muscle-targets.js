// Weekly sets per muscle against a target range: "Chest 14 / 10–20 sets this week" (Stats card,
// and a line on Home when switched on).
//
// WHAT COUNTS. This calendar week's working sets (the profile's week start), ticked, warm-ups
// left out, through the same muscle weights every muscle map and the fatigue model use
// (muscles.js musclesOf → loadOfWorkouts): a set credits each primary muscle with 1.0 and each
// supporting muscle with 0.4 (muscles.js SECONDARY). So 3 sets of bench press are 3 chest sets
// and 1.2 triceps and shoulder sets. A per-side set is one set, a timed hold counts like a rep set,
// cardio counts towards no main muscle.
//
// THE RANGES. Per main muscle group, a low and a high end of weekly working sets, in the spirit
// of the hypertrophy "volume landmarks": below the low end little growth is expected (roughly a
// minimum effective volume, MEV), past the high end more sets stop paying (towards a maximum
// recoverable volume, MRV). Defaults are rounded from Israetel, Hoffmann & Smith, "Scientific
// Principles of Hypertrophy Training" / RP Strength's volume landmarks, and sit inside the 10 to
// 20 sets per muscle per week that Schoenfeld, Ogborn & Krieger (2017, J Sports Sci 35(11),
// "Dose-response relationship between weekly resistance training volume and increases in muscle
// mass") found to keep paying. They are a starting point, not a verdict: every muscle's range can
// be changed (Settings → Plan & schedule → Weekly sets per muscle), stored as
// S.muscleTargets = { [slug]: [low, high] }, synced like any setting.
//
// Below the range is "room for more", never a failing grade.
import { loadOfWorkouts, MUSCLE_NAME } from './muscles.js'
import { weekKey, weekStartOf, todayISO } from './format.js'

// The main groups, in body order, with their default [low, high] weekly working sets.
export const DEFAULT_TARGETS = {
  chest: [10, 20],
  'upper-back': [10, 20],
  deltoids: [8, 20],
  biceps: [8, 18],
  triceps: [6, 16],
  quadriceps: [8, 18],
  hamstring: [6, 16],
  gluteal: [4, 16],
  calves: [8, 16],
  abs: [6, 16],
}
export const TARGET_MUSCLES = Object.keys(DEFAULT_TARGETS)
export const TARGET_MAX = 40

/** The `[low, high]` range of a muscle: the profile's own when it set one, else the default. */
export function targetOf(S, slug) {
  const own = S?.muscleTargets?.[slug]
  if (Array.isArray(own) && own.length === 2) {
    const lo = Math.round(Number(own[0])), hi = Math.round(Number(own[1]))
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi >= lo && hi <= TARGET_MAX) return [lo, hi]
  }
  return DEFAULT_TARGETS[slug] ? [...DEFAULT_TARGETS[slug]] : null
}

/** 'below', 'in' or 'above' the range. */
export const statusOf = (sets, [lo, hi]) => (sets < lo - 1e-9 ? 'below' : sets > hi + 1e-9 ? 'above' : 'in')

/** Sets rounded for the screen: whole, or one decimal when the supporting-muscle share leaves one. */
export const roundSets = n => Math.round((Number(n) || 0) * 10) / 10

/**
 * Every main muscle's working sets this week against its range:
 * [{ slug, name, sets, lo, hi, status }], in body order. `today` pins the week for tests.
 */
export function weeklyMuscleSets(S, today = todayISO()) {
  const ws = weekStartOf(S)
  const wk = weekKey(today, ws)
  const workouts = (S?.workouts || []).filter(w => w && weekKey(w.d, ws) === wk)
  const load = loadOfWorkouts(workouts)
  return TARGET_MUSCLES.map(slug => {
    const [lo, hi] = targetOf(S, slug)
    const sets = roundSets(load[slug] || 0)
    return { slug, name: MUSCLE_NAME[slug], sets, lo, hi, status: statusOf(sets, [lo, hi]) }
  })
}

/** The muscle with the most room left this week (furthest under its low end), or null when none is. */
export function mostRoom(rows) {
  const below = (rows || []).filter(r => r.status === 'below')
  if (!below.length) return null
  return below.reduce((a, b) => ((b.lo - b.sets) / b.lo > (a.lo - a.sets) / a.lo ? b : a))
}

/** S.muscleTargets with `slug` set to [lo, hi] (put in order and bounds), or back on the default. */
export function withTarget(targets, slug, range) {
  const out = { ...(targets && typeof targets === 'object' ? targets : {}) }
  if (!range) { delete out[slug]; return out }
  let [lo, hi] = range.map(n => Math.max(0, Math.min(TARGET_MAX, Math.round(Number(n) || 0))))
  if (hi < lo) [lo, hi] = [hi, lo]
  const d = DEFAULT_TARGETS[slug]
  if (d && d[0] === lo && d[1] === hi) delete out[slug]
  else out[slug] = [lo, hi]
  return out
}
