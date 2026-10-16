// The live target ring on About you (§3b, prototype v4 calcRange): while answers are missing, a
// range over typical adults for each unknown, narrowing with every answer. It is a picture of how
// close the target is, never the target: the number the person starts on comes from the hub's
// POST /hub/api/onboarding/preview, the one formula (fitness-hub src/onboarding/targets.ts). The
// constants below are that module's, so the range brackets what the server will answer.

const BMR = { perCm: 6.25, perKg: 9.99, perYear: 4.92, male: 5, female: -161, unspecified: -78 }
const AGE_MIN = 15
const MULTIPLIER = [1.2, 1.375, 1.55, 1.725, 1.9]
const DAY_STEP = { sitting: 0, on_feet: 1, physical: 2 }
const GOAL_FACTOR = { lose: 0.8, keep: 1, unsure: 1, build: 1.1 }
const LOSE_MAX_WEEKLY_SHARE = 0.0075
const KCAL_PER_KG = 7700

const trainingStep = days => (days <= 0 ? 0 : days <= 2 ? 1 : days <= 4 ? 2 : 3)

function kcal({ sex, birthYear, heightCm, weightKg }, { goal, activity, trainingDays }, year) {
  const age = Math.max(AGE_MIN, year - birthYear)
  const bmr = BMR.perCm * heightCm + BMR.perKg * weightKg - BMR.perYear * age + BMR[sex]
  const level = Math.min(MULTIPLIER.length - 1, (DAY_STEP[activity] ?? 0) + trainingStep(trainingDays || 0))
  const tdee = Math.round(bmr * MULTIPLIER[level])
  let factor = GOAL_FACTOR[goal || 'keep'] ?? 1
  if (factor < 1) {
    const maxDeficit = (LOSE_MAX_WEEKLY_SHARE * weightKg * KCAL_PER_KG) / 7
    if (tdee * (1 - factor) > maxDeficit) factor = Math.ceil((1 - maxDeficit / tdee) * 100) / 100
  }
  return Math.round(tdee * factor)
}

// What a typical adult might be, for an answer not given yet: the two ends of each.
const SPREAD = { sex: ['female', 'male'], heightCm: [155, 190], weightKg: [55, 100] }
const ages = year => [year - 25, year - 60]

const r50 = n => Math.round(n / 50) * 50

/**
 * { lo, hi, answered } in kcal a day, rounded to 50, over every combination of the unknowns.
 * `answered` is how many of the four body answers are in. With all four, lo === hi.
 */
export function estimateRange(answers, now = new Date()) {
  const year = now.getFullYear()
  const body = answers?.body || {}
  const pick = (v, alts) => (v == null ? alts : [v])
  const context = { goal: answers?.goal, activity: answers?.activity?.value || 'sitting', trainingDays: answers?.trainingDays }
  let lo = Infinity, hi = -Infinity
  for (const sex of pick(body.sex, SPREAD.sex)) {
    for (const birthYear of pick(body.birthYear, ages(year))) {
      for (const heightCm of pick(body.heightCm, SPREAD.heightCm)) {
        for (const weightKg of pick(body.weightKg, SPREAD.weightKg)) {
          const k = kcal({ sex, birthYear, heightCm, weightKg }, context, year)
          lo = Math.min(lo, k)
          hi = Math.max(hi, k)
        }
      }
    }
  }
  const answered = ['sex', 'birthYear', 'heightCm', 'weightKg'].filter(k => body[k] != null).length
  return { lo: r50(lo), hi: r50(hi), answered }
}
