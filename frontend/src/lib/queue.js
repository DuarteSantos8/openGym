// The floating coach week (`S.queue`): the week's sessions are an ordered list, and the first
// one not done yet is "today's session" on whatever day you next train. No weekday is attached
// to any of them — the weekday model (`S.week` / `S.dayPlan`) stays for the routines you plan
// yourself, and effectiveRoutineIds (history.js) puts the two side by side.
//
//   S.queue = null | {
//     ids:      string[]      routine ids in slot order = the week's sessions
//     since:    number        ms epoch of the apply; a workout STARTED at/after it is this week's
//     startsOn: 'YYYY-MM-DD'  local date the queue becomes active (the planner's calendar-week rule)
//     label:    string        progress-row title, e.g. 'US W1'
//   }
//
// The app never writes `S.queue`; a planner does — any API client that PUTs state with a queue
// (a coaching agent, a script). null = the weekday model alone.
//
// DONE RULE — kept word for word with the api's reminder copy (api/queue.js), and the rule a
// planner has to mirror, so nobody disagrees about which session is next: a session is done
// when any FINISHED workout on that routine exists after the week was applied. Missed sets are
// the planner's business. `S.active` is not in `S.workouts`, so a session in progress never
// counts. The name clause is for a "past workout" logged with an early clock: its start predates
// `since`, but it is dated inside the week (on or after `startsOn`) and its name — a merged
// session reads 'US W1 D1 + Core' — says which routines were done. The date bound matters: a
// planner may reuse its routine ids and names every week (W1 again after a restart), so a
// workout from a past week that happens to carry this week's name must never count.

import { isoOf } from './format.js'

const routineIdsOf = w => (Array.isArray(w.routineIds) ? w.routineIds : (w.routineId ? [w.routineId] : []))
const nameParts = w => String(w.name || '').split(' + ')

// Tolerant reader: whole-state sync is last-writer-wins, so a half-written or older-shaped
// queue can arrive from another client. A bad shape reads as "no queue" rather than taking
// Home down with it. A session whose routine no longer exists (deleted in the editor — the
// app never rewrites S.queue) is dropped from the week: it could never be started or logged,
// and keeping it would pin the whole week on it; a queue left with no session at all reads as
// no queue. A missing startsOn means active since the day of the apply.
const queueOf = S => {
  const q = S?.queue
  if (!q || typeof q !== 'object' || !Array.isArray(q.ids)) return null
  const routines = Array.isArray(S.routines) ? S.routines : []
  const ids = q.ids.filter(id => routines.some(r => r.id === id))
  if (!ids.length) return null
  return { ...q, ids, startsOn: typeof q.startsOn === 'string' ? q.startsOn : isoOf(new Date(q.since || 0)) }
}

const isDone = (S, q, id) => {
  const name = S.routines.find(r => r.id === id)?.name
  return S.workouts.some(w => routineIdsOf(w).includes(id)
    && ((w.start ?? 0) >= q.since || (String(w.d || '') >= q.startsOn && nameParts(w).includes(name))))
}

/** The week's sessions already done, in slot order. `[]` without a queue. */
export function queueDone(S) {
  const q = queueOf(S)
  return q ? q.ids.filter(id => isDone(S, q, id)) : []
}

/** The sessions still to do, in slot order — the first is the next one. `[]` without a queue. */
export function queueRemaining(S) {
  const q = queueOf(S)
  return q ? q.ids.filter(id => !isDone(S, q, id)) : []
}

/**
 * The queue's answer for a date: the next undone session, on exactly one day — today, or
 * `startsOn` while that is still ahead (Home's "next week is waiting"). Every other date gets
 * null, so the calendar and the reminders do not paint the same session onto every day.
 * Dates are compared as ISO strings; `today` is passed in so callers and tests agree on it.
 */
export function queueNext(S, iso, today) {
  const q = queueOf(S)
  if (!q) return null
  // The one date the queue answers for is known before any workout is looked at — the calendar
  // asks for thirty dates in a row, so the done-scan runs only for the one that can match.
  const on = today > q.startsOn ? today : q.startsOn
  if (iso !== on) return null
  const remaining = queueRemaining(S)
  return remaining.length ? remaining[0] : null
}

/**
 * Everything Home's progress row shows, derived once. `items` keep slot order; `state` is
 * 'done', 'next' (the first undone one, whether or not the queue is active yet) or 'later'.
 * `waiting` = the queue is sitting on a future `startsOn`. null without a queue.
 */
export function queueView(S, today) {
  const q = queueOf(S)
  if (!q) return null
  const remaining = queueRemaining(S)
  // A routine the planner has since retired keeps its id as the name — better than a blank chip.
  const nameOf = id => S.routines.find(r => r.id === id)?.name ?? id
  return {
    label: q.label || '',
    items: q.ids.map(id => ({
      id, name: nameOf(id),
      state: !remaining.includes(id) ? 'done' : id === remaining[0] ? 'next' : 'later',
    })),
    remaining,
    complete: remaining.length === 0,
    startsOn: q.startsOn,
    waiting: today < q.startsOn,
  }
}
