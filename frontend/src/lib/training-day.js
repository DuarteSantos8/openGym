import { effectiveRoutineIds, effectiveRoutines, nextTrainingDay, workoutDay } from './history.js'
import { todayISO } from './format.js'
import { queueOf, pinState, queueView } from './queue.js'
import { scheduleModeOf } from './rotation.js'
import { workoutRunning } from './tab-route.js'
import { dayNoteOf } from './day-notes.js'
import { t } from './i18n-core.js'

/** A workout's name as a list shows it: a saved session can have none. */
export const workoutLabel = w => w.name || t('Workout')

// The workouts of each day, built once per workouts array: the store clones S on every change, so
// a new array is a new index, and the week strip's nine reads a render (and the clock's ticks)
// cost one pass over the history instead of one each.
const byDayCache = new WeakMap()
export function workoutsByDay(workouts) {
  let index = byDayCache.get(workouts)
  if (!index) {
    index = new Map()
    for (const w of workouts) {
      const day = workoutDay(w)
      if (day) index.set(day, [...(index.get(day) || []), w])
    }
    byDayCache.set(workouts, index)
  }
  return index
}

/**
 * What a day holds for training, as Home's hero and the Training hub's today row tell it. One
 * of (by `kind`):
 *   - 'editing'  an open editor on a saved workout (S.active with editingWorkoutId): not a session
 *                in progress, the way back to it is an edit;
 *   - 'running'  a session in progress (`live` once its clock runs; a backfill has none);
 *   - 'done'     today's plan is covered by what was logged today (`workout`, the last one);
 *   - 'planned'  today has routines to start (`routines`, `ids`, `name`, `rescheduled`);
 *   - 'rest'     nothing planned today (`next`: nextTrainingDay, or null where the schedule has no
 *                weekday to name);
 *   - 'past-logged' / 'past-missed' / 'past-rest'  a day before today: its workouts, what was
 *                planned and not logged, or rest.
 * A session in progress wins on today only; a past day reads as that day.
 */
export function trainingDay(S, date = todayISO(), today = todayISO()) {
  if (date < today) {
    const workouts = workoutsByDay(S.workouts).get(date)
    if (workouts) return { kind: 'past-logged', workouts }
    const routines = effectiveRoutines(S, date)
    if (routines.length) return { kind: 'past-missed', routines, ids: routines.map(r => r.id), name: nameOf(routines) }
    return { kind: 'past-rest' }
  }
  if (S.active) return { kind: S.active.editingWorkoutId ? 'editing' : 'running', active: S.active, live: workoutRunning(S) }

  // A weekday can hold several routines; the session's name joins them (§9).
  const routines = effectiveRoutines(S, today)
  // The last session logged for today, once today's plan is covered: a freestyle session on a
  // planned day, or the rotation's first session done when its next one is today's too, leaves the
  // day offering what is still to do. A queue session is never "covered" by an earlier workout:
  // the queue only names one it does not count as done yet.
  const loggedToday = S.workouts.filter(w => w.d === today)
  const queueIds = queueOf(S)?.ids || []
  const covered = id => !queueIds.includes(id) && loggedToday.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const done = routines.every(r => covered(r.id)) ? loggedToday.at(-1) : null
  if (done) return { kind: 'done', workout: done }
  if (routines.length) {
    // A fulfilled pin (a coach session pinned to today and since done) reads as no override.
    const rescheduled = S.dayPlan[today] !== undefined && pinState(S, S.dayPlan[today]) !== 'done'
    return { kind: 'planned', routines, ids: effectiveRoutineIds(S, today), name: nameOf(routines), rescheduled }
  }
  return { kind: 'rest', next: nextSession(S, today) }
}

/** The next day after `today` with something to train (nextTrainingDay), or null where the
 *  schedule has no weekday to name: a planner-written queue (no rotationId) still names its
 *  weekday before it starts, but our own rotation has none (lib/rotation.js), and naming one would
 *  leak the fixed week into a schedule that never had one. */
export function nextSession(S, today = todayISO()) {
  const plannerQueue = !!queueView(S, today) && !queueOf(S)?.rotationId
  return scheduleModeOf(S) === 'rotation' && !plannerQueue ? null : nextTrainingDay(S, today)
}

/** A day's routines as one session name (§9): "Push + Pull". */
export const nameOf = routines => routines.map(r => r.name).join(' + ')

/** The week strip's dot for a day: trained, a day off with a note (#261, excused rather than
 *  missed), a changed plan, the plan, or nothing. */
export function dayMark(S, iso) {
  if (workoutsByDay(S.workouts).has(iso)) return 'done'
  if (dayNoteOf(S, iso)) return 'noted'
  const planned = effectiveRoutineIds(S, iso).length > 0
  if (!planned) return undefined
  return S.dayPlan[iso] !== undefined ? 'ovr' : 'plan'
}
