// The starter-plan catalog. Training data only: the chooser's plan names and descriptions are
// written as string literals inside t() calls in sheets.jsx, because check-source-strings.mjs
// only finds them there — copy parked in here would silently ship English in every language.
//
// A routine is [key, name, emoji, [[exerciseId, sets, reps], …]]. A timed exercise (a plank, a
// hang) is [exerciseId, sets, seconds, 'time'] (#964): three 40 s holds, not three reps. The key is what a plan's
// schedule points at, so a weekday never depends on the position of a routine in the array.
// Names stay canonical English — they become ordinary user routines, which are not translated.
import { uid } from './format.js'
import { EXIDX } from './exercises.js'
import { eqAvailable, ALL_EQUIPMENT } from './equipment.js'
import { defaultConfig } from './history.js'
import { STARTER_PLANS, AWAY_PLANS } from '../../../api/coach/core/starter-plans.js'
export { AWAY_PLANS }

// The plans themselves live with the Coach's core (api/coach/core/starter-plans.js), which reads
// them for its routines library; this module builds them into routines.
const PLANS = STARTER_PLANS
const PPL = PLANS.ppl.routines

// One catalogue line as a routine entry: reps by default, seconds when the line says 'time'.
export function starterEntry([id, sets, amount, mode]) {
  if (mode === 'time') return { ...defaultConfig(id, 'time'), id, sets, sec: amount, weight: 0 }
  return { id, sets, reps: amount, weight: 0 }
}

const build = routines =>
  routines.map(([, name, emoji, list]) => ({ id: uid(), name, emoji, ex: list.map(starterEntry) }))

// Fresh routine objects (new ids) — [push, pull, legs]. The demo build seeds a history on
// top of exactly these three, so this entry point keeps its shape.
export const starterRoutines = () => build(PPL)

// [{ id, days }] for the chooser. The day count is read off the schedule rather than stored
// beside it, so the two can never disagree.
export const starterPlanOptions = () =>
  Object.entries(PLANS).map(([id, { schedule }]) => ({ id, days: schedule.length }))

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
export const substituteFor = (ex, equipment, taken, machines) => {
  const hasBall = equipment.includes('stability ball') || equipment.includes('bosu ball')
  const exWords = words(ex), exSm = new Set([ex.mg, ...(ex.sm || [])])
  const loaded = ex.eq !== 'body weight'
  let best = null, bestScore = -Infinity
  for (const c of Object.values(EXIDX)) {
    if (c.bp !== ex.bp || taken.has(c.id) || !eqAvailable(equipment, c, machines)) continue
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
// that leaves it empty). Sets and reps (or seconds) carry over unchanged.
export const fitRoutines = (routines, equipment, machines) => {
  let swapped = 0, dropped = 0
  const fitted = routines.map(([key, name, emoji, list]) => {
    const taken = new Set(list.map(([id]) => id))
    const out = []
    for (const line of list) {
      const [id, ...plan] = line
      const ex = EXIDX[id]
      if (!ex || eqAvailable(equipment, ex, machines)) { out.push(line); continue }
      const sub = substituteFor(ex, equipment, taken, machines)
      if (!sub) { dropped++; continue }
      taken.add(sub.id)
      swapped++
      out.push([sub.id, ...plan])
    }
    return [key, name, emoji, out]
  }).filter(([, , , list]) => list.length)
  return { routines: fitted, swapped, dropped }
}

// Fresh routines plus the weekdays to put them on, or null for an unknown id — a caller that
// treats null as "change nothing" can never half-apply a plan. With an equipment list the
// plan is fitted to it first, and `fit` reports how many exercises that swapped or dropped.
// `machines`, the profile's machine kinds (lib/machine-kinds.js), narrows the machines it may use.
export const buildStarterPlan = (id, equipment, machines) => {
  const plan = PLANS[id]
  if (!plan) return null
  const fit = equipment ? fitRoutines(plan.routines, equipment, machines) : null
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

// Starter programmes (#159): a starter plan's routines run as a block, as data. Generic shapes
// written for this app, not any published programme: the weeks are the numbers, the names and
// descriptions live in t() calls in views/Programmes.jsx for the same reason as the plans'. A
// target is keyed by exercise id (lib/programmes.js), a %1RM only on the barbell lifts.
const BARBELL = ['0043', '0025', '0027', '0085', '0047']
const pcts = (pct, rpe) => ({ rpe, t: Object.fromEntries(BARBELL.map(id => [id, { pct }])) })
const PROGRAMMES = {
  // Four weeks on the 5×5 routines: heavier each week, then a light one to come back fresh.
  'strength-4': { plan: '5x5', weeks: [pcts(72.5, 7), pcts(77.5, 8), pcts(82.5, 8.5), { ...pcts(60, 6), deload: true }] },
  // Six weeks of upper/lower by effort only: the policy keeps the weights, the RPE climbs.
  'hypertrophy-6': { plan: 'upper-lower', weeks: [{ rpe: 7 }, { rpe: 7.5 }, { rpe: 8 }, { rpe: 8.5 }, { rpe: 9 }, { rpe: 6, deload: true }] },
  // Twelve weeks of plain linear progression on the 5×5 routines, a deload every fourth week.
  'linear-12': { plan: '5x5', weeks: Array.from({ length: 12 }, (_, i) => ((i + 1) % 4 === 0 ? { deload: true } : {})) },
}

/** [{ id, weeks, days }] for the chooser. */
export const starterProgrammeOptions = () =>
  Object.entries(PROGRAMMES).map(([id, p]) => ({ id, weeks: p.weeks.length, days: PLANS[p.plan].schedule.length }))

/**
 * Fresh routines and the programme over them (not saved, not started), or null for an unknown id.
 * `name` is what the chooser showed, in the language on screen.
 */
export const buildStarterProgramme = (id, name, now = Date.now()) => {
  const def = PROGRAMMES[id]
  const plan = def && buildStarterPlan(def.plan)
  if (!plan) return null
  const days = {}
  for (const { day, routineId } of plan.schedule) (days[day] = days[day] || []).push(routineId)
  return { routines: plan.routines, programme: { id: uid(), name, at: now, src: id, days, weeks: JSON.parse(JSON.stringify(def.weeks)) } }
}
