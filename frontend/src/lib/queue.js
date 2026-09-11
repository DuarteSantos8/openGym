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

import { isoOf, weekKey, weekStartOf } from './format.js'

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

// The DONE RULE for one workout and one session — `isDone` asks it across the log.
const countsFor = (S, q, w, id) => routineIdsOf(w).includes(id)
  && ((w.start ?? 0) >= q.since
    || (String(w.d || '') >= q.startsOn && nameParts(w).includes(S.routines.find(r => r.id === id)?.name)))
const isDone = (S, q, id) => S.workouts.some(w => countsFor(S, q, w, id))

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

/**
 * The streak card's fraction, `done / planned`, for the week `today` is in. Without a queue it
 * is what it always was: the calendar week's finished workouts over the weekdays that hold a
 * plan (a combined day is one day, one workout). With an active queue the coach week is the
 * unit, and your own training counts beside it: `planned` is the queue's sessions plus the
 * weekdays you plan yourself (a weekday whose routines the queue already covers adds nothing),
 * and `done` is the queue's finished sessions plus this calendar week's workouts on top of them
 * — your own days, freestyle sessions, a redo of a session already done, a queue-routine workout
 * from before the apply. A merged 'US W1 D2 + Core' session counts for both sides: the queue's
 * session through the queue, your Core day as training on top, the two units `planned` added.
 * A queue still ahead of its `startsOn` (queueView's `waiting`) is next week's plan, so until
 * then the card is the calendar-week count alone and the progress row speaks for the coming week.
 */
export function weekTally(S, today) {
  const ws = weekStartOf(S)
  const thisWeek = S.workouts.filter(w => weekKey(w.d, ws) === weekKey(today, ws))
  const q0 = queueOf(S)
  const q = q0 && today >= q0.startsOn ? q0 : null
  // "Covered by the queue" is tested against the raw ids: a queue routine deleted mid-week is
  // gone from `q.ids`, but a weekday pointer to it is still not a day you planned yourself.
  const ownIds = ids => [].concat(ids || []).filter(id => !(q && S.queue.ids.includes(id)))
  const ownDays = Object.values(S.week || {}).filter(ids => ownIds(ids).length).length
  if (!q) return { done: thisWeek.length, planned: ownDays }
  // The workout that earns each session its credit is the earliest one the DONE RULE accepts
  // (by date, not array position — a backfilled log is not always in order); every other
  // workout this week is training on top, and so is a crediting workout's own half.
  const chrono = (a, b) => ((a.d || '') < (b.d || '') ? -1 : (a.d || '') > (b.d || '') ? 1 : (a.start || 0) - (b.start || 0))
  const credited = new Set(q.ids.map(id => S.workouts.filter(w => countsFor(S, q, w, id)).sort(chrono)[0]).filter(Boolean))
  const other = thisWeek.filter(w => !credited.has(w) || ownIds(routineIdsOf(w)).length).length
  return { done: queueDone(S).length + other, planned: q.ids.length + ownDays }
}
