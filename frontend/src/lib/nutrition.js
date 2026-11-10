// Daily calorie and macro targets for the food diary (views/Food.jsx), from your body and the
// weekly weight change you aim for.
//
//   S.foodPlan = { heightCm, activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very',
//                  rate: kg per week, negative to lose, positive to gain, 0 to hold }
//
// Sex and year of birth are the profile's own (S.sex, S.birthYear, shared with the strength
// levels); the weight is your latest weigh-in, so the target follows you as you lose or gain.
//
// The maths:
//   - resting burn (BMR): Mifflin-St Jeor, 10 x kg + 6.25 x cm - 5 x age, +5 for men, -161 for women
//   - daily burn (TDEE): BMR times the activity factor
//   - target: TDEE plus the weekly change spread over the days, 7700 kcal per kg of body weight
//   - protein 2.0 g per kg while losing (keeps muscle in a deficit), 1.8 otherwise; fat 25% of the
//     calories but never under 0.6 g per kg; carbs the rest
//
// Safety: the weekly change is held to 1% of your body weight, and the target never goes under
// your BMR or under 1500 kcal for men and 1200 kcal for women (or under
// maintenance, when that is lower still). Either one is reported, so the
// screen can say why the number is not what the rate asked for.
import { sexOf, ageOf } from './strength-level.js'
import { workoutDuration } from './history.js'

export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }
export const ACTIVITY_LABEL = {
  sedentary: 'Desk job, little exercise',
  light: 'Exercise 1 to 3 days a week',
  moderate: 'Exercise 3 to 5 days a week',
  active: 'Exercise 6 or 7 days a week',
  very: 'Hard training or a physical job',
}
export const KCAL_PER_KG = 7700
const FLOOR = { male: 1500, female: 1200 }
const LB = 0.45359237

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** The latest weigh-in in kg, or null. */
export function weightKg(S) {
  const last = Array.isArray(S?.bodyweight) ? S.bodyweight[S.bodyweight.length - 1] : null
  const w = Number(last?.w)
  if (!(w > 0)) return null
  return S.unit === 'lb' ? w * LB : w
}

/** The inputs the calculation needs, and the names of the ones still missing. */
export function planInputs(S) {
  const p = isMap(S?.foodPlan) ? S.foodPlan : {}
  const inputs = {
    kg: weightKg(S), cm: Number(p.heightCm) > 0 ? Number(p.heightCm) : null,
    sex: sexOf(S), age: ageOf(S), activity: ACTIVITY[p.activity] ? p.activity : null,
    rate: Number.isFinite(Number(p.rate)) ? Number(p.rate) : 0,
  }
  const missing = ['kg', 'cm', 'sex', 'age', 'activity'].filter(k => inputs[k] == null)
  return { inputs, missing }
}

/**
 * { bmr, tdee, kcal, p, c, f, rate, capped, floored } for the inputs, or null with any missing.
 * kcal whole, macros in whole grams; `rate` is the weekly change actually planned (after the cap).
 */
export function targets({ kg, cm, sex, age, activity, rate = 0, burn = null }) {
  if (!(kg > 0 && cm > 0 && age > 0) || !FLOOR[sex] || !ACTIVITY[activity]) return null
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161)
  // `burn`: a measured daily burn (a watch's 28-day mean, lib/garmin.js realTdee) instead of the guess.
  const tdee = burn > 0 ? burn : bmr * ACTIVITY[activity]
  const limit = kg * 0.01
  const planned = Math.max(-limit, Math.min(limit, Number(rate) || 0))
  const capped = planned !== (Number(rate) || 0)
  const wanted = tdee + planned * KCAL_PER_KG / 7
  // Never under the floor, and the floor never over what you burn (a light, inactive body).
  const floor = Math.min(Math.max(bmr, FLOOR[sex]), tdee)
  const floored = wanted < floor
  const kcal = Math.round(Math.max(wanted, floor))
  const p = Math.round(kg * (planned < 0 ? 2.0 : 1.8))
  const f = Math.round(Math.max(kcal * 0.25 / 9, kg * 0.6))
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4))
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, p, c, f, rate: Math.round(planned * 100) / 100, capped, floored }
}

/** S.foodSplit as { p, c, f } percentages adding up to 100, or null when not set or broken. */
export function splitOf(S) {
  const x = isMap(S?.foodSplit) ? S.foodSplit : null
  if (!x) return null
  const v = { p: Number(x.p), c: Number(x.c), f: Number(x.f) }
  return Object.values(v).every(n => n >= 0) && Math.round(v.p + v.c + v.f) === 100 ? v : null
}

/** Grams of protein, carbs and fat for `kcal` split by percentages (4, 4 and 9 kcal per gram). */
export const gramsFor = (kcal, sp) => ({ p: Math.round(kcal * sp.p / 400), c: Math.round(kcal * sp.c / 400), f: Math.round(kcal * sp.f / 900) })

/**
 * The diary's daily goal: the calculated targets once the plan is complete, otherwise the
 * number typed in by hand (S.foodGoal). An own macro split (S.foodSplit) replaces the
 * recommended grams in either case; a typed number without one has no macro targets.
 * Null for neither.
 */
export function dailyGoal(S, { burn = null } = {}) {
  const { inputs, missing } = planInputs(S)
  const sp = splitOf(S)
  let out = null
  if (isMap(S?.foodPlan) && !missing.length) {
    const t = targets({ ...inputs, burn })
    if (t) out = { ...t, auto: true }
  }
  if (!out) {
    const k = Number(S?.foodGoal)
    if (k > 0) out = { kcal: Math.round(k), p: null, c: null, f: null, auto: false }
  }
  return out && sp ? { ...out, ...gramsFor(out.kcal, sp), split: true } : out
}

/*
 * Calories burned in workouts, added to the day's budget when you switch it on (S.foodEatBack).
 * Off by default: the activity level already counts your training, so this counts it twice
 * unless you picked "Desk job". Estimated, not measured: strength training at about 5 MET, of
 * which 1 is what you burn sitting anyway, so 4 kcal per kg per hour on top. A workout longer
 * than 3 hours counts as 3 (one left running).
 */
export const NET_MET = 4
export function workoutKcal(S, iso) {
  const kg = weightKg(S)
  if (!kg) return 0
  const hours = (Array.isArray(S?.workouts) ? S.workouts : [])
    .filter(w => w?.d === iso)
    .reduce((h, w) => h + Math.min(3, workoutDuration(w) / 3600000), 0)
  return Math.round(NET_MET * kg * hours)
}
