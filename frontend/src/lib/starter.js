// The starter-plan catalog. Training data only: the chooser's plan names and descriptions are
// written as string literals inside t() calls in sheets.jsx, because check-source-strings.mjs
// only finds them there — copy parked in here would silently ship English in every language.
//
// A routine is [key, name, emoji, [[exerciseId, sets, reps], …]]. The key is what a plan's
// schedule points at, so a weekday never depends on the position of a routine in the array.
// Names stay canonical English — they become ordinary user routines, which are not translated.
import { uid } from './format.js'
import { EXDB, isBodyweightEq } from './exercises.js'

// Benjamin-specific home training: resolve exercises by name so the profile survives dataset id changes.
const pick = (...terms) => {
  const qs = terms.map(x => x.toLowerCase())
  const exact = EXDB.find(e => isBodyweightEq(e.id) && qs.some(q => String(e.n || '').toLowerCase() === q))
  if (exact) return exact.id
  const bodyweight = EXDB.find(e => isBodyweightEq(e.id) && qs.some(q => String(e.n || '').toLowerCase().includes(q)))
  if (bodyweight) return bodyweight.id
  return EXDB.find(e => qs.some(q => String(e.n || '').toLowerCase().includes(q)))?.id || null
}
const benEx = (id, sets, reps) => id ? [id, sets, reps] : null
const BEN_PUSH = pick('push-up', 'push up')
const BEN_PULL = pick('pull-up', 'pull up')
const BEN_SQUAT = pick('bodyweight squat', 'air squat', 'squat')
const BEN_LUNGE = pick('bodyweight lunge', 'reverse lunge', 'lunge')
const BEN_BRIDGE = pick('glute bridge', 'hip bridge')
const BEN_PLANK = pick('plank')
const BEN_PIKE = pick('pike push-up', 'pike push up')
const BEN_OPTIONAL = pick('mountain climber', 'mountain climbers')
const BEN_HOME = [
  ['ben-a', 'Benjamin · Full Body A', 'figureStrength', [benEx(BEN_PUSH, 3, 12), benEx(BEN_PULL, 3, 5), benEx(BEN_SQUAT, 3, 15), benEx(BEN_BRIDGE, 3, 15), benEx(BEN_PLANK, 3, 45)].filter(Boolean)],
  ['ben-b', 'Benjamin · Full Body B', 'figureStrength', [benEx(BEN_PIKE, 3, 8), benEx(BEN_PULL, 3, 5), benEx(BEN_LUNGE, 3, 10), benEx(BEN_BRIDGE, 3, 15), benEx(BEN_PLANK, 3, 45)].filter(Boolean)],
  ['ben-c', 'Benjamin · Full Body C', 'figureStrength', [benEx(BEN_PUSH, 3, 12), benEx(BEN_PULL, 3, 5), benEx(BEN_SQUAT, 3, 15), benEx(BEN_LUNGE, 2, 10), benEx(BEN_OPTIONAL, 3, 30)].filter(Boolean)],
  ['ben-short', 'Benjamin · Short Full Body', 'figureStrength', [benEx(BEN_PUSH, 2, 12), benEx(BEN_PULL, 2, 5), benEx(BEN_SQUAT, 2, 15), benEx(BEN_PLANK, 2, 45)].filter(Boolean)]
]


const PPL = [
  ['push', 'Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['pull', 'Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['legs', 'Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

const UPPER_LOWER = [
  ['upper-a', 'Upper A', 'barbell', [['0025', 3, 8], ['2330', 3, 10], ['0047', 2, 10], ['1323', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
  ['lower-a', 'Lower A', 'legs', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
  ['upper-b', 'Upper B', 'barbell', [['0047', 3, 8], ['0027', 3, 8], ['0426', 2, 10], ['2330', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0313', 2, 12]]],
  ['lower-b', 'Lower B', 'legs', [['0739', 3, 10], ['0085', 2, 10], ['0585', 2, 12], ['0586', 3, 12], ['0605', 3, 15]]]
]

const FULL_BODY = [
  ['fb-a', 'Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 3, 12], ['0334', 2, 12], ['0031', 2, 12]]],
  ['fb-b', 'Full Body B', 'figureStrength', [['0085', 3, 8], ['0047', 3, 10], ['1323', 3, 10], ['0585', 3, 12], ['0334', 2, 12], ['0241', 2, 12]]],
  ['fb-c', 'Full Body C', 'figureStrength', [['0739', 3, 10], ['0025', 2, 10], ['0027', 3, 10], ['0426', 2, 10], ['0586', 3, 12], ['0605', 3, 15]]]
]

const FIVE_BY_FIVE = [
  ['5x5-a', '5×5 A', 'barbell', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
  ['5x5-b', '5×5 B', 'barbell', [['0085', 5, 5], ['0426', 5, 5], ['2330', 5, 5]]],
  ['5x5-c', '5×5 C', 'barbell', [['0739', 5, 5], ['0047', 5, 5], ['1323', 5, 5]]]
]

// [weekday, routineKey] — weekday is a DAYN index, so 1 is Monday. Fixed weeks only: every
// plan repeats the same seven days, which is all the weekly plan model can represent.
const PLANS = {
  ppl: { routines: PPL, schedule: [[1, 'push'], [3, 'pull'], [5, 'legs']] },
  'upper-lower': { routines: UPPER_LOWER, schedule: [[1, 'upper-a'], [2, 'lower-a'], [4, 'upper-b'], [5, 'lower-b']] },
  'full-body': { routines: FULL_BODY, schedule: [[1, 'fb-a'], [3, 'fb-b'], [5, 'fb-c']] },
  '5x5': { routines: FIVE_BY_FIVE, schedule: [[1, '5x5-a'], [3, '5x5-b'], [5, '5x5-c']] },
  'benjamin-home': { routines: BEN_HOME, schedule: [[1, 'ben-a'], [3, 'ben-b'], [5, 'ben-c']] }
}

const build = routines =>
  routines.map(([, name, emoji, list]) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

// Fresh routine objects (new ids) — [push, pull, legs]. The demo build seeds a history on
// top of exactly these three, so this entry point keeps its shape.
export const starterRoutines = () => build(BEN_HOME.slice(0, 3))

// [{ id, days }] for the chooser. The day count is read off the schedule rather than stored
// beside it, so the two can never disagree.
export const starterPlanOptions = () =>
  Object.entries(PLANS).map(([id, { schedule }]) => ({ id, days: schedule.length }))

// The weekdays a plan would claim, or null for an unknown id.
export const starterPlanDays = id => PLANS[id]?.schedule.map(([day]) => day) ?? null

// Fresh routines plus the weekdays to put them on, or null for an unknown id — a caller that
// treats null as "change nothing" can never half-apply a plan.
export const buildStarterPlan = id => {
  const plan = PLANS[id]
  if (!plan) return null
  const routines = build(plan.routines)
  // key → the id just minted for it, so the schedule below names its routine
  const byKey = Object.fromEntries(plan.routines.map(([key], i) => [key, routines[i].id]))
  return { routines, schedule: plan.schedule.map(([day, key]) => ({ day, routineId: byKey[key] })) }
}
