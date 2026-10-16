// The starter-plan catalog. Training data only: the chooser's plan names and descriptions are
// written as string literals inside t() calls in sheets.jsx, because check-source-strings.mjs
// only finds them there — copy parked in here would silently ship English in every language.
//
// A routine is [key, name, emoji, [[exerciseId, sets, reps], …]]. The key is what a plan's
// schedule points at, so a weekday never depends on the position of a routine in the array.
// Names stay canonical English — they become ordinary user routines, which are not translated.
import { uid } from './format.js'
import { EXIDX } from './exercises.js'
import { eqAvailable, ALL_EQUIPMENT } from './equipment.js'

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

// Two days a week: the whole body both days, so each session carries what three would split
// between them (squat or hinge, a press, a pull, and the small stuff).
const FULL_BODY_2 = [
  ['fb2-a', '2-Day Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 2, 12], ['0426', 2, 10], ['0031', 2, 12], ['0605', 2, 15]]],
  ['fb2-b', '2-Day Full Body B', 'figureStrength', [['0085', 3, 8], ['0047', 3, 8], ['0027', 3, 10], ['0739', 3, 10], ['0334', 2, 12], ['0241', 2, 12], ['0585', 2, 12]]]
]

// Five days a week: upper/lower to start the week, then push/pull/legs to finish it. The two
// halves train each muscle about twice, and the Wednesday and Sunday are rest.
const UL_PPL = [
  ['ulp-upper', 'Upper', 'barbell', [['0025', 3, 8], ['0027', 3, 8], ['0426', 3, 10], ['2330', 3, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
  ['ulp-lower', 'Lower', 'legs', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
  ['ulp-push', 'Push', 'barbell', [['0047', 3, 8], ['0289', 3, 10], ['0405', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 2, 10]]],
  ['ulp-pull', 'Pull', 'pullup', [['0198', 3, 10], ['0293', 3, 10], ['1323', 3, 10], ['5609', 3, 15], ['0313', 3, 12]]],
  ['ulp-legs', 'Legs', 'legs', [['0739', 3, 10], ['1060', 3, 10], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

// Six days a week: push/pull/legs twice. The first of each pair is the heavy one, the second
// swaps the lifts for their close cousins, so the muscles get two different stimuli, not the
// same session twice. Sunday is rest.
const PPL_6 = [
  ['ppl6-push-a', 'Push A', 'barbell', [['0025', 4, 8], ['0426', 3, 10], ['0314', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 2, 10]]],
  ['ppl6-pull-a', 'Pull A', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['5609', 3, 15], ['0031', 3, 10]]],
  ['ppl6-legs-a', 'Legs A', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
  ['ppl6-push-b', 'Push B', 'barbell', [['0047', 4, 8], ['0405', 3, 10], ['0289', 3, 10], ['0178', 3, 15], ['0241', 3, 12]]],
  ['ppl6-pull-b', 'Pull B', 'pullup', [['1326', 3, 8], ['0293', 3, 10], ['0861', 3, 10], ['0313', 3, 12], ['0031', 2, 12]]],
  ['ppl6-legs-b', 'Legs B', 'legs', [['0032', 3, 5], ['1992', 3, 10], ['1060', 3, 10], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

// [weekday, routineKey] — weekday is a DAYN index, so 1 is Monday. Fixed weeks only: every
// plan repeats the same seven days, which is all the weekly plan model can represent.
//
// `onboarding: true` keeps a plan out of the starter-plan chooser (starterPlanOptions() with no
// argument): that sheet looks a plan's name and description up by id in its own copy table
// (src/sheets/starter.jsx), and an id it has no copy for would break it. Onboarding picks a plan
// by its day count from starterPlanOptions({ all: true }). A plan loses the flag when the chooser
// has its copy.
const PLANS = {
  ppl: { routines: PPL, schedule: [[1, 'push'], [3, 'pull'], [5, 'legs']] },
  'upper-lower': { routines: UPPER_LOWER, schedule: [[1, 'upper-a'], [2, 'lower-a'], [4, 'upper-b'], [5, 'lower-b']] },
  'full-body': { routines: FULL_BODY, schedule: [[1, 'fb-a'], [3, 'fb-b'], [5, 'fb-c']] },
  '5x5': { routines: FIVE_BY_FIVE, schedule: [[1, '5x5-a'], [3, '5x5-b'], [5, '5x5-c']] },
  'full-body-2': { onboarding: true, routines: FULL_BODY_2, schedule: [[1, 'fb2-a'], [4, 'fb2-b']] },
  'upper-lower-ppl': { onboarding: true, routines: UL_PPL, schedule: [[1, 'ulp-upper'], [2, 'ulp-lower'], [4, 'ulp-push'], [5, 'ulp-pull'], [6, 'ulp-legs']] },
  'ppl-6': {
    onboarding: true, routines: PPL_6,
    schedule: [[1, 'ppl6-push-a'], [2, 'ppl6-pull-a'], [3, 'ppl6-legs-a'], [4, 'ppl6-push-b'], [5, 'ppl6-pull-b'], [6, 'ppl6-legs-b']]
  }
}

const build = routines =>
  routines.map(([, name, emoji, list]) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

// Fresh routine objects (new ids) — [push, pull, legs]. The demo build seeds a history on
// top of exactly these three, so this entry point keeps its shape.
export const starterRoutines = () => build(PPL)

// [{ id, days }] for the chooser. The day count is read off the schedule rather than stored
// beside it, so the two can never disagree. `{ all: true }` also lists the onboarding plans (2,
// 5 and 6 days), which the chooser sheet has no copy for (see PLANS); the chooser calls this with
// no argument and gets what it always did.
export const starterPlanOptions = ({ all = false } = {}) =>
  Object.entries(PLANS).filter(([, plan]) => all || !plan.onboarding).map(([id, { schedule }]) => ({ id, days: schedule.length }))

// The weekdays a plan would claim, or null for an unknown id.
export const starterPlanDays = id => PLANS[id]?.schedule.map(([day]) => day) ?? null

// Words that name the equipment, not the movement ("barbell", "lever", "machine"…), so that
// "barbell bench press" and "dumbbell bench press" read as the same lift.
const EQ_WORDS = new Set(ALL_EQUIPMENT.flatMap(e => e.split(/[^a-z0-9]+/)).concat(['lever', 'leverage', 'machine', 'sled']))
const words = ex => new Set(ex.n.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !EQ_WORDS.has(w)))
const jaccard = (a, b) => {
  const inter = [...a].filter(x => b.has(x)).length
  return inter ? inter / (a.size + b.size - inter) : 0
}

// Names that are not working sets: stretches, holds, mobility and warm-up drills. Never a
// stand-in for a lift, whatever body part and muscle they share with it.
const NOT_A_LIFT = /stretch|isometric|squeeze|yoga|\bpose\b|toe touch|\broll(er)?\b|mobility|circles|warm-?up|boxing|against wall/i
// "… on exercise ball" is tagged with its weight (dumbbell), but needs a ball nobody ticked.
const NEEDS_BALL = /exercise ball|stability ball|swiss ball|bosu/i

// The best stand-in for `ex` among exercises the equipment list allows. Same body part, and it
// has to share the target muscle, the main muscle or a helper muscle with `ex`. Closest wins:
// same target muscle, then the movement by name, then helper muscles. When `ex` is a loaded
// lift, one that is loaded too beats a body-weight drill — a push-up is not a bench press.
// `taken` keeps a routine from ending up with the same exercise twice. null when nothing fits.
export const substituteFor = (ex, equipment, taken) => {
  const hasBall = equipment.includes('stability ball') || equipment.includes('bosu ball')
  const exWords = words(ex), exSm = new Set([ex.mg, ...(ex.sm || [])])
  const loaded = ex.eq !== 'body weight'
  let best = null, bestScore = -Infinity
  for (const c of Object.values(EXIDX)) {
    if (c.bp !== ex.bp || taken.has(c.id) || !eqAvailable(equipment, c)) continue
    if (NOT_A_LIFT.test(c.n) || (!hasBall && NEEDS_BALL.test(c.n))) continue
    const sm = jaccard(exSm, new Set([c.mg, ...(c.sm || [])]))
    if (c.tg !== ex.tg && c.mg !== ex.mg && !sm) continue
    const score = 2 * (c.tg === ex.tg) + (c.mg === ex.mg) + 3 * jaccard(exWords, words(c)) + 2 * sm
      - (loaded && c.eq === 'body weight' ? 3 : 0)
    // id as the last key: the same equipment always gives the same plan
    if (score > bestScore || (score === bestScore && c.id < best.id)) { best = c; bestScore = score }
  }
  return best
}

// Re-cuts a routine list for an equipment list: what you can already do stays, what you can't
// is swapped for its closest match, and what has no match is dropped (with its routine, when
// that leaves it empty). Sets and reps carry over unchanged.
const fitRoutines = (routines, equipment) => {
  let swapped = 0, dropped = 0
  const fitted = routines.map(([key, name, emoji, list]) => {
    const taken = new Set(list.map(([id]) => id))
    const out = []
    for (const [id, sets, reps] of list) {
      const ex = EXIDX[id]
      if (!ex || eqAvailable(equipment, ex)) { out.push([id, sets, reps]); continue }
      const sub = substituteFor(ex, equipment, taken)
      if (!sub) { dropped++; continue }
      taken.add(sub.id)
      swapped++
      out.push([sub.id, sets, reps])
    }
    return [key, name, emoji, out]
  }).filter(([, , , list]) => list.length)
  return { routines: fitted, swapped, dropped }
}

// Fresh routines plus the weekdays to put them on, or null for an unknown id — a caller that
// treats null as "change nothing" can never half-apply a plan. With an equipment list the
// plan is fitted to it first, and `fit` reports how many exercises that swapped or dropped.
export const buildStarterPlan = (id, equipment) => {
  const plan = PLANS[id]
  if (!plan) return null
  const fit = equipment ? fitRoutines(plan.routines, equipment) : null
  const source = fit ? fit.routines : plan.routines
  const routines = build(source)
  // key → the id just minted for it, so the schedule below names its routine
  const byKey = Object.fromEntries(source.map(([key], i) => [key, routines[i].id]))
  return {
    routines,
    schedule: plan.schedule.filter(([, key]) => byKey[key]).map(([day, key]) => ({ day, routineId: byKey[key] })),
    ...(fit && { fit: { swapped: fit.swapped, dropped: fit.dropped } })
  }
}

// What each equipment choice the onboarding offers leaves available, as buildStarterPlan takes
// it: a full gym (null, the plan as written), dumbbells only, or nothing (body weight). The API's
// copy of the fitted plans (api/starter-plans.js) is checked against these, never a copy of them.
export const STARTER_EQUIPMENT_LISTS = { gym: null, dumbbells: ['dumbbell'], none: [] }
