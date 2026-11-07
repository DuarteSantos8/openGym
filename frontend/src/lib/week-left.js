// Workouts left this week (#753, thanks @unabomberlive): "2 of 4 left this week" on Home and in
// the widget snapshot, so the week's plan reads as a countdown and not only as a tally.
//
//  - Fixed week (and a planner's coach week): the streak card's own fraction (queue.js
//    weekTally), planned minus done, so the two lines never disagree.
//  - Rotation: a loop runs by order, not by weekday, so it has no week of its own. With a target
//    set (Settings → Plan & schedule → Workouts per week, S.weekTarget, 1 to 7) it is that target
//    minus this calendar week's workouts; with none, nothing is said (the loop's own progress row
//    already shows where it stands).
//
// Nothing is stored here; null means "nothing to say" (no plan, or no target).
import { weekTally, queueOf } from './queue.js'
import { scheduleModeOf } from './rotation.js'
import { weekKey, weekStartOf, todayISO } from './format.js'

export const WEEK_TARGET_MAX = 7

/** The rotation's weekly target, 1 to 7, or null when none is set. */
export function weekTargetOf(S) {
  const n = Math.round(Number(S?.weekTarget))
  return n >= 1 && n <= WEEK_TARGET_MAX ? n : null
}

/** `{ left, of, done }` for the week `today` is in, or null when there is no plan to count down. */
export function workoutsLeft(S, today = todayISO()) {
  if (!S) return null
  const st = { ...S, routines: S.routines || [], workouts: S.workouts || [], week: S.week || {} }
  const q = queueOf(st)
  const managed = !!q && !!st.rotation && q.rotationId === st.rotation.id
  if (scheduleModeOf(st) === 'rotation' && (managed || !q)) {
    const of = weekTargetOf(st)
    if (!of) return null
    const ws = weekStartOf(st)
    const wk = weekKey(today, ws)
    const done = st.workouts.filter(w => w && weekKey(w.d, ws) === wk).length
    return { left: Math.max(0, of - done), of, done }
  }
  let tally
  try { tally = weekTally(st, today) } catch { return null }
  if (!(tally?.planned > 0)) return null
  return { left: Math.max(0, tally.planned - tally.done), of: tally.planned, done: tally.done }
}
