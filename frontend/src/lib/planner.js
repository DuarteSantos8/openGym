// "Find my plan" (EP22): six answers in, one plan out. No model, no network, no account: the same
// answers always give the same plan, on any device, in any build.
//
// What it does, in order:
//   1. picks one of the starter plans (api/coach/core/starter-plans.js) from the equipment, the
//      days and the experience;
//   2. spreads that plan's sessions over as many weekdays as asked for, never two hard days more
//      in a row than the count forces, and never more days than a first month should have;
//   3. sets a starting dose (sets, reps, rest) for the goal when the person is new, and leaves
//      the plan as written for someone who has trained for a while;
//   4. trims each session from the end (the main lifts come first in every starter plan) until
//      it fits the minutes;
//   5. says why, as codes the screen turns into sentences (views/Onboarding.jsx), so every line
//      of the explanation is something this file actually did.
//
// The numbers follow general resistance-training guidance for healthy adults, not anyone's
// medical situation: novices 2 to 3 days a week, 1 to 3 sets of 8 to 12 repetitions, more days
// and sets with experience (ACSM position stand, Progression Models in Resistance Training for
// Healthy Adults, Med Sci Sports Exerc 2009;41(3):687-708), and muscle-strengthening work on at
// least 2 days a week (WHO guidelines on physical activity and sedentary behaviour, 2020).
// Ticking a limitation only ever makes the plan gentler. It diagnoses nothing, is never stored,
// and two of the answers add a line asking the person to check with a professional first.
import { STARTER_PLANS } from '../../../api/coach/core/starter-plans.js'

export const GOALS = ['general', 'muscle', 'strength', 'fatloss', 'mobility']
export const EQUIPMENT = ['gym', 'dumbbells', 'bands', 'none', 'hotel']
export const EXPERIENCE = ['never', 'some', 'regular']
export const DAYS = [2, 3, 4, 5]
export const MINUTES = [20, 30, 45, 60]
export const LIMITS = ['knees', 'back', 'shoulders', 'pregnancy', 'clinician']
// The two that ask for a professional's word before starting, not only a gentler plan.
const ASK_FIRST = ['pregnancy', 'clinician']

export const DEFAULT_ANSWERS = Object.freeze({ goal: 'general', days: 3, minutes: 45, equipment: 'gym', experience: 'never', limits: [] })

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback)

/** Answers with every field one of its options: anything else falls back to the default. */
export function cleanAnswers(a) {
  const x = a && typeof a === 'object' ? a : {}
  return {
    goal: pick(x.goal, GOALS, DEFAULT_ANSWERS.goal),
    days: pick(Number(x.days), DAYS, DEFAULT_ANSWERS.days),
    minutes: pick(Number(x.minutes), MINUTES, DEFAULT_ANSWERS.minutes),
    equipment: pick(x.equipment, EQUIPMENT, DEFAULT_ANSWERS.equipment),
    experience: pick(x.experience, EXPERIENCE, DEFAULT_ANSWERS.experience),
    limits: LIMITS.filter(l => Array.isArray(x.limits) && x.limits.includes(l)),
  }
}

/** The experience level (lib/experience.js) an answer stands for. The quiz never says Experienced. */
export const levelFor = experience => (experience === 'regular' ? 'intermediate' : 'beginner')

// The most days a week the plan will ask of someone: three when they have never lifted, four
// with a little behind them. More is not better in the first months, recovered is.
const MAX_DAYS = { never: 3, some: 4, regular: 5 }

// Weekdays as DAYN indexes (1 Monday … 6 Saturday), with a rest day wherever the count allows.
const WEEKDAYS = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6] }

const AWAY = { dumbbells: 'dumbbells', bands: 'bands', none: 'home-bw', hotel: 'hotel' }

function planIdFor(a, days, caution) {
  if (AWAY[a.equipment]) return AWAY[a.equipment]
  if (a.experience === 'never') return 'full-body'
  // Five sets of five heavy is an hour's work and no place to start gently.
  if (a.goal === 'strength' && days <= 3 && a.minutes >= 60 && !caution) return '5x5'
  if (days >= 5 && a.experience === 'regular') return 'ppl'
  if (days >= 4) return 'upper-lower'
  return 'full-body'
}

// Where a new lifter starts, by goal. Rest in seconds.
const BEGINNER_DOSE = {
  general: { sets: 2, reps: 12, rest: 75 },
  muscle: { sets: 3, reps: 10, rest: 90 },
  strength: { sets: 3, reps: 8, rest: 120 },
  fatloss: { sets: 2, reps: 12, rest: 60 },
  mobility: { sets: 2, reps: 12, rest: 60 },
}
// For someone who trains already the plans are right as written; only these goals change them.
const TRAINED_DOSE = {
  fatloss: { sets: 3, reps: 12, rest: 60 },
  mobility: { sets: 2, reps: 12, rest: 60 },
}
const GENTLE_DOSE = { sets: 2, reps: 12, rest: 90 }
// What the estimate assumes between sets when the plan is left as written.
const WRITTEN_REST = { '5x5': 180 }
const DEFAULT_REST = 90
export const writtenRestFor = id => WRITTEN_REST[id] || DEFAULT_REST

function doseFor(a, planId, caution) {
  if (caution) return { ...GENTLE_DOSE }
  if (levelFor(a.experience) === 'beginner') return { ...BEGINNER_DOSE[a.goal] }
  if (a.goal === 'strength' && planId !== '5x5') return { sets: 4, reps: 6, rest: 150 }
  return TRAINED_DOSE[a.goal] ? { ...TRAINED_DOSE[a.goal] } : null
}

const isTimed = line => line[3] === 'time'
const dosed = (line, dose) => {
  if (!dose) return line
  // A hold keeps its seconds; only how often it is done follows the dose.
  if (isTimed(line)) return [line[0], Math.min(line[1], dose.sets), line[2], 'time']
  return [line[0], dose.sets, dose.reps]
}

const WORK_SEC = 40, SETUP_SEC = 60, WARMUP_SEC = 300

/** Roughly how long a session takes, in minutes: the sets, the rests, moving between exercises and a warm-up. */
export function sessionMinutes(list, rest = DEFAULT_REST) {
  let sec = WARMUP_SEC
  for (const line of list) sec += line[1] * ((isTimed(line) ? line[2] : WORK_SEC) + rest) + SETUP_SEC
  return Math.round(sec / 60)
}

const MIN_EXERCISES = 3
function trimmed(list, minutes, rest) {
  const out = [...list]
  // Two minutes of grace: an estimate is not worth a dropped exercise.
  while (out.length > MIN_EXERCISES && sessionMinutes(out, rest) > minutes + 2) out.pop()
  return out
}

/**
 * The plan for a set of answers:
 *   { planId, level, days, weekdays, routines, schedule, dose, minutes, why, caution, askFirst }
 * `routines` and `schedule` are in the starter catalogue's own shape, ready for
 * lib/starter.js buildPlanFrom. `dose` is null when the plan is used as written. `minutes` is the
 * longest session's estimate. `why` is a list of codes, in the order the screen shows them.
 */
export function planFor(answers) {
  const a = cleanAnswers(answers)
  const caution = a.limits.length > 0
  const days = Math.min(a.days, MAX_DAYS[a.experience])
  const planId = planIdFor(a, days, caution)
  const plan = STARTER_PLANS[planId]
  const dose = doseFor(a, planId, caution)
  const rest = dose ? dose.rest : writtenRestFor(planId)

  const weekdays = WEEKDAYS[days]
  // Session i is the plan's routine i, round and round: two bodyweight sessions fill three days as A, B, A.
  const used = weekdays.map((_, i) => plan.routines[i % plan.routines.length])
  let trimmedAny = false
  const routines = [...new Set(used)].map(([key, name, glyph, list]) => {
    const fitted = trimmed(list.map(line => dosed(line, dose)), a.minutes, rest)
    if (fitted.length < list.length) trimmedAny = true
    return [key, name, glyph, fitted]
  })
  const schedule = weekdays.map((day, i) => [day, used[i][0]])

  const why = []
  if (a.equipment !== 'gym') why.push('equipment')
  else why.push('plan-' + planId)
  // With a limitation ticked the dose is the gentle one, not the goal's: the goal line would claim
  // something this plan does not do.
  if (!caution) why.push('goal-' + a.goal)
  if (days < a.days) why.push('days-capped')
  if (trimmedAny) why.push('trimmed')
  if (caution) why.push('caution')

  return {
    planId, level: levelFor(a.experience), days, weekdays, routines, schedule, dose,
    rest, minutes: Math.max(...routines.map(r => sessionMinutes(r[3], rest))),
    why, caution, askFirst: a.limits.some(l => ASK_FIRST.includes(l)),
  }
}

/** Every combination of answers (without the limitations), for tests and for checking the catalogue. */
export function everyAnswer() {
  const out = []
  for (const goal of GOALS) for (const days of DAYS) for (const minutes of MINUTES)
    for (const equipment of EQUIPMENT) for (const experience of EXPERIENCE) out.push({ goal, days, minutes, equipment, experience, limits: [] })
  return out
}
