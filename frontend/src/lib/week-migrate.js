// From the old "Rotation" way of training to the fixed week.
//
// Older versions of the app could run the routines as a loop (S.rotation, S.queue with a
// `rotationId`, S.scheduleMode). That mode is gone: every weekday holds its own session. A profile
// that still carries a loop is turned into a week here, once, when it is loaded:
//
//   - the loop's sessions go on the days of the week in order, from the first day of the week; a
//     rest day in the loop leaves its day empty;
//   - a profile whose week already has sessions keeps them: the loop only fills the empty days,
//     and only with sessions the week does not hold yet;
//   - at most seven days exist, so a longer loop is cut there (the routines themselves are never
//     deleted: the rest stay in the Routines list);
//   - the loop's own fields are dropped. A floating week written by a coach or a planner (a queue
//     without `rotationId`) is not this app's loop and is left alone.
//
// Pure and idempotent: nothing is touched when there is no loop, and a second call finds nothing.

import { weekOrder, weekStartOf } from './format.js'

const REST = 'rest'

/** The saved loop, as ids and 'rest' entries, keeping only routines that still exist. */
export function loopOf(S) {
  const routines = Array.isArray(S?.routines) ? S.routines : []
  const known = id => routines.some(r => r.id === id)
  let seq = Array.isArray(S?.rotation?.sequence) ? S.rotation.sequence : null
  // A pass managed by the old loop with no saved definition beside it: its ids are the loop.
  if (!seq && S?.queue && typeof S.queue === 'object' && S.queue.rotationId && Array.isArray(S.queue.ids)) seq = S.queue.ids
  if (!seq) return []
  const out = seq.filter(id => id === REST || known(id))
  return out.some(id => id !== REST) ? out : []
}

const hasLoopFields = S => !!S && (S.rotation != null || S.scheduleMode != null || !!S.queue?.rotationId)

/**
 * Turns a profile's loop into week days, in place. Returns true when the profile changed.
 * `S.week` maps a weekday number (0 = Sunday) to a routine id or a list of them.
 */
export function migrateRotationToWeek(S) {
  if (!S || typeof S !== 'object' || !hasLoopFields(S)) return false
  const loop = loopOf(S)
  if (loop.length) {
    const week = S.week && typeof S.week === 'object' ? S.week : {}
    const placed = new Set(Object.values(week).flatMap(v => [].concat(v || [])))
    const todo = loop.filter(id => id === REST || !placed.has(id))
    const next = { ...week }
    let i = 0
    for (const day of weekOrder(weekStartOf(S))) {
      if (i >= todo.length) break
      if ([].concat(week[day] || []).length) continue
      const id = todo[i++]
      if (id !== REST) next[day] = [id]
    }
    S.week = next
  }
  delete S.rotation
  delete S.scheduleMode
  if (S.queue?.rotationId) S.queue = null
  return true
}
