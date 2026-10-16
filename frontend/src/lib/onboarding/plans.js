// The Plan step's ready-made plan: which starter plan a number of training days gets, the days it
// suggests, and its sessions fitted to the equipment (lib/starter.js holds the plans themselves).
// Weekdays are DAYN indexes, as the app's weekly plan keeps them: 0 is Sunday, 1 Monday.
import { buildStarterPlan, starterPlanDays, STARTER_EQUIPMENT_LISTS } from '../starter.js'
import { EXIDX } from '../exercises.js'

// The catalogue has no one-day plan: one day gets the two-day full-body plan's first session.
const TEMPLATE = { 1: 'full-body-2', 2: 'full-body-2', 3: 'full-body', 4: 'upper-lower', 5: 'upper-lower-ppl', 6: 'ppl-6' }
/** The starter plan for `days` training days a week, or null (0 days has none). */
export const templateFor = days => TEMPLATE[days] || null

/** The weekdays a plan for `days` days starts on: the plan's own, Wednesday for a single day. */
export function suggestedDays(days) {
  if (!days) return []
  if (days === 1) return [3]
  return (starterPlanDays(templateFor(days)) || []).slice(0, days)
}

/** Monday first, as the week strips show it. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0]

/**
 * The plan's sessions for `days` and an equipment choice: [{ name, exercises: [{ id, name, sets, reps }] }],
 * one per training day, in order. Exercise names are the catalogue's (English); the caller shows
 * them through the exercise-name packs.
 */
export function starterSessions(days, equipment = 'gym') {
  const id = templateFor(days)
  if (!id) return []
  const built = buildStarterPlan(id, STARTER_EQUIPMENT_LISTS[equipment] ?? null)
  if (!built) return []
  return built.routines.slice(0, days).map(r => ({
    name: r.name,
    exercises: r.ex.map(e => ({ id: e.id, ex: EXIDX[e.id] || null, sets: e.sets, reps: e.reps })),
  }))
}

/**
 * Moves session `sel` to `day`: a free day takes it; a day holding another session selects that
 * one instead. Returns { weekdays, sel }.
 */
export function moveSession(weekdays, sel, day) {
  const at = weekdays.indexOf(day)
  if (at >= 0) return { weekdays, sel: at }
  const next = weekdays.slice()
  next[sel] = day
  return { weekdays: next, sel }
}
