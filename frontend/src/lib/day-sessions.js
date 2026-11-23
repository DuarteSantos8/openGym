// A day's plan as the sessions you train it in (#908). Two routines on one weekday are one
// combined session by default (docs/dev/COMBINE_ROUTINES.md). A weekday marked "separately" in
// Plan (S.weekApart[weekday] = true) keeps each routine its own session instead: a run in the
// morning and ankle work in the evening, each with its own Start, each done on its own.
//
// Pure, read from S: Home's today rows, the Start button and the start picker all use it.
import { isLive } from './routine-folders.js'
import { effectiveRoutineIds } from './history.js'
import { queueOf } from './queue.js'
import { todayISO } from './format.js'

const weekdayOf = iso => new Date(iso + 'T12:00:00').getDay()

/** Whether the weekday of `iso` trains its routines one at a time. */
export const dayApart = (S, iso) => !!(S?.weekApart && S.weekApart[weekdayOf(iso)] === true)

/** S.weekApart with `day` (0 to 6) set apart or back together; a false key is dropped. */
export function withDayApart(map, day, apart) {
  const out = { ...(map && typeof map === 'object' && !Array.isArray(map) ? map : {}) }
  if (apart) out[day] = true
  else delete out[day]
  return out
}

/**
 * The sessions planned on `iso`, each a list of routine ids in plan order: one list for a
 * combined day (the way it always was), one per routine on a day trained separately. [] on a
 * rest day.
 */
export function daySessions(S, iso, today = todayISO()) {
  const ids = effectiveRoutineIds(S, iso, today)
  if (!ids.length) return []
  return dayApart(S, iso) ? ids.map(id => [id]) : [ids]
}

/**
 * Today's sessions with what is done: [{ ids, routines, done }] where `done` is the last workout
 * logged today that covers every routine of the session, else null. A coach-week session is never
 * covered by an earlier workout (the queue only names one it does not count as done yet).
 */
export function daySessionsStatus(S, iso = todayISO()) {
  const logged = (S.workouts || []).filter(w => w.d === iso)
  const queueIds = queueOf(S)?.ids || []
  const covered = id => !queueIds.includes(id) && logged.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  return daySessions(S, iso).map(ids => {
    const routines = ids.map(id => (S.routines || []).find(r => r.id === id)).filter(isLive)
    const doneW = routines.length && routines.every(r => covered(r.id)) ? logged.filter(w => ids.some(id => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))).at(-1) || null : null
    return { ids, routines, done: doneW }
  })
}

/** The session the Start button begins today: the first one not done yet with exercises in it, else null. */
export function nextSessionIds(S, iso = todayISO()) {
  const s = daySessionsStatus(S, iso).find(x => !x.done && x.routines.some(r => (r.ex || []).length))
  return s ? s.ids : null
}
