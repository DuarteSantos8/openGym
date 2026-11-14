// Strength level per lift: Beginner, Novice, Intermediate, Advanced or Elite, from your best
// estimated 1RM against your body weight (exercise details and a Stats card). Worked out on this
// device only, from data already in the profile; nothing is sent anywhere.
//
// THE STANDARDS are bodyweight ratios (1RM ÷ body weight) at the start of each level, per lift and
// sex, rounded from the widely published Strength Level tables (strengthlevel.com, "Strength
// Standards", bodyweight-ratio view, which grade one-rep maxes from millions of logged lifts:
// Beginner is stronger than about 5% of lifters, Novice 20%, Intermediate 50%, Advanced 80% and
// Elite 95%). Dumbbell lifts are per dumbbell. They are one population's numbers, a rough map and
// not a verdict, and they read most fairly with your sex set: without it the men's table is used,
// as those tables do, and the screen says so.
//
// AGE. From 40 on, each threshold is divided by the masters age coefficient for that age
// (McCulloch's coefficients, as used for masters powerlifting: 1.00 at 40, 1.13 at 50, 1.30 at
// 60, 1.59 at 70, 2.03 at 80, interpolated in between), so a 60-year-old's 1.3 × is graded like a
// 40-year-old's 1.69 ×. Under 40, no adjustment.
//
// THE NUMBERS. The best estimated 1RM ever logged for the lift (onerm.js best1RM, the profile's
// formula; dumbbells read per bell) against the latest weigh-in. No weigh-in, no level: the
// screens hide it.
import { best1RM, formulaOf } from './onerm.js'
import { lastBW } from './history.js'

export const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite']
// English keys for t(); "lifter" keeps "Advanced" apart from the settings word of the same name.
export const LEVEL_NAME = {
  beginner: 'Beginner lifter', novice: 'Novice lifter', intermediate: 'Intermediate lifter',
  advanced: 'Advanced lifter', elite: 'Elite lifter',
}

// Per lift: the catalogue ids it covers, whether it is per dumbbell, and [Beginner, Novice,
// Intermediate, Advanced, Elite] bodyweight ratios for men (m) and women (f).
export const STANDARDS = {
  squat: { ids: ['0043', '3593'], m: [0.75, 1.25, 1.5, 2.25, 2.75], f: [0.5, 0.75, 1.25, 1.5, 2] },
  bench: { ids: ['0025'], m: [0.5, 0.75, 1, 1.5, 2], f: [0.25, 0.5, 0.75, 1, 1.5] },
  deadlift: { ids: ['0032', '0117'], m: [1, 1.5, 2, 2.5, 3], f: [0.5, 1, 1.25, 1.75, 2.5] },
  press: { ids: ['1162'], m: [0.35, 0.55, 0.8, 1.05, 1.35], f: [0.2, 0.35, 0.5, 0.75, 1] },
  row: { ids: ['0027'], m: [0.5, 0.75, 1, 1.5, 1.75], f: [0.25, 0.4, 0.65, 0.9, 1.2] },
  frontSquat: { ids: ['0042'], m: [0.55, 0.8, 1.2, 1.6, 2], f: [0.35, 0.55, 0.85, 1.15, 1.5] },
  incline: { ids: ['0047'], m: [0.4, 0.65, 0.85, 1.2, 1.5], f: [0.2, 0.4, 0.6, 0.85, 1.1] },
  rdl: { ids: ['0085'], m: [0.6, 1, 1.4, 1.9, 2.4], f: [0.4, 0.65, 1, 1.4, 1.8] },
  hipThrust: { ids: ['1060'], m: [0.5, 1, 1.75, 2.5, 3.25], f: [0.5, 1, 1.5, 2.25, 3] },
  curl: { ids: ['0031'], m: [0.2, 0.4, 0.6, 0.85, 1.15], f: [0.1, 0.2, 0.4, 0.6, 0.85] },
  dbBench: { ids: ['0289'], perBell: true, m: [0.2, 0.35, 0.5, 0.75, 1], f: [0.1, 0.2, 0.35, 0.5, 0.7] },
  dbPress: { ids: ['0405'], perBell: true, m: [0.15, 0.25, 0.4, 0.6, 0.8], f: [0.1, 0.15, 0.25, 0.4, 0.55] },
  dbCurl: { ids: ['0294'], perBell: true, m: [0.1, 0.2, 0.3, 0.45, 0.6], f: [0.05, 0.1, 0.2, 0.3, 0.4] },
}
const BY_ID = Object.fromEntries(Object.entries(STANDARDS).flatMap(([k, v]) => v.ids.map(id => [id, k])))

/** The lift an exercise is graded as, or null for one with no standard. */
export const liftOf = exId => BY_ID[exId] || null

// McCulloch's masters coefficients at the ages they are tabled, interpolated in between.
const AGE_COEF = [[40, 1], [45, 1.06], [50, 1.13], [55, 1.21], [60, 1.3], [65, 1.43], [70, 1.59], [75, 1.79], [80, 2.03]]
export function ageCoefficient(age) {
  const a = Number(age)
  if (!Number.isFinite(a) || a <= 40) return 1
  if (a >= 80) return 2.03
  for (let i = 1; i < AGE_COEF.length; i++) {
    const [a1, c1] = AGE_COEF[i]
    if (a <= a1) {
      const [a0, c0] = AGE_COEF[i - 1]
      return c0 + (c1 - c0) * (a - a0) / (a1 - a0)
    }
  }
  return 1
}

/** 'male', 'female' or null (not set). */
export const sexOf = S => (S?.sex === 'female' || S?.sex === 'male' ? S.sex : null)
/** Age in whole years this year, from the year of birth, or null. */
export function ageOf(S, year = new Date().getFullYear()) {
  const b = Math.round(Number(S?.birthYear))
  return b >= 1900 && b <= year ? year - b : null
}

/** The thresholds a lifter is graded against: the table for their sex, adjusted for their age. */
export function thresholdsFor(lift, { sex = null, age = null } = {}) {
  const st = STANDARDS[lift]
  if (!st) return null
  const k = ageCoefficient(age)
  return (sex === 'female' ? st.f : st.m).map(r => Math.round(r / k * 1000) / 1000)
}

/** The level index (0 Beginner … 4 Elite) a bodyweight ratio reaches. */
export function levelAt(ratio, thresholds) {
  let lv = 0
  thresholds.forEach((t, i) => { if (ratio >= t - 1e-9) lv = i })
  return lv
}

/**
 * The level of exercise `exId` for profile `S`, or null when it has no standard, no estimated 1RM
 * or no weigh-in. `{ lift, level, name, ratio, e1rm, bw, next, sex, age, perBell }`: `next` is the
 * level above and the 1RM that reaches it (null at Elite).
 */
export function strengthLevel(S, exId, { formula = formulaOf(S) } = {}) {
  const lift = liftOf(exId)
  if (!lift) return null
  const bwEntry = lastBW(S || { bodyweight: [] })
  const bw = Number(bwEntry?.w)
  if (!(bw > 0)) return null
  const st = STANDARDS[lift]
  const best = best1RM(S, exId, formula, st.perBell ? 'each' : undefined)
  if (!best || !(best.est > 0)) return null
  const sex = sexOf(S), age = ageOf(S)
  const th = thresholdsFor(lift, { sex, age })
  const ratio = best.est / bw
  const level = levelAt(ratio, th)
  const next = level < LEVELS.length - 1 ? { level: level + 1, name: LEVELS[level + 1], ratio: th[level + 1], weight: Math.ceil(th[level + 1] * bw * 2) / 2 } : null
  return { lift, level, name: LEVELS[level], ratio: Math.round(ratio * 100) / 100, e1rm: best.est, bw, next, sex, age, perBell: !!st.perBell, thresholds: th }
}

/** Every graded lift the profile has a level for, strongest level first. */
export function strengthLevels(S) {
  const out = []
  for (const [lift, st] of Object.entries(STANDARDS)) {
    let best = null
    for (const id of st.ids) {
      const lv = strengthLevel(S, id)
      if (lv && (!best || lv.ratio > best.ratio)) best = { ...lv, id }
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => b.level - a.level || b.ratio - a.ratio || Object.keys(STANDARDS).indexOf(a.lift) - Object.keys(STANDARDS).indexOf(b.lift))
}
