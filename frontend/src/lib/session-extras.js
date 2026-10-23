// Exercises added to a planned session that its routine did not have (the session's "Add
// exercise"). They belong to that workout only — the routine is never changed by them — and are
// marked on the entry with `extra: true`, from the moment they are added through finishing into
// the history. Everything that reads training (volume, sets, PRs, progression, muscles, stats)
// reads them like any other entry, because they are training that happened; only the question
// "how much of the plan got done" tells them apart (sessionPlanSummary).
//
// A freestyle session has no plan, so nothing in it is extra. An exercise swapped in for a planned
// one takes that one's place and stays planned; a routine brought in whole ("Add routine") is
// planned too, by that routine.
import { isWarmupRow } from './workout-model.js'

export const isExtra = entry => entry?.extra === true

const workSets = entry => (Array.isArray(entry?.sets) ? entry.sets : [])
  .filter(s => s && s.done === true && !isWarmupRow(s))

/**
 * How a session went against its plan: the planned exercises and how many of them were done, the
 * extra ones, and their work sets. `w.planEx`, written at finish when it differs from what the
 * entries alone say (an extra was added or a planned exercise was left out), is the number of
 * planned exercises; without it every non-extra entry is one. A freestyle session has `planned:
 * 0` and its exercises count as done, not extra.
 * Returns { planned, plannedDone, extra, plannedSets, extraSets, totalSets, totalDone }.
 */
export function sessionPlanSummary(w) {
  const entries = Array.isArray(w?.entries) ? w.entries.filter(Boolean) : []
  const extras = entries.filter(isExtra)
  const plannedEntries = entries.filter(e => !isExtra(e))
  const done = e => workSets(e).length > 0
  const isPlannedSession = entries.some(e => e.rid) || (Array.isArray(w?.routineIds) && w.routineIds.length > 0) || extras.length > 0
  const plannedSets = plannedEntries.reduce((n, e) => n + workSets(e).length, 0)
  const extraSets = extras.reduce((n, e) => n + workSets(e).length, 0)
  const plannedDone = plannedEntries.filter(done).length
  return {
    planned: isPlannedSession ? (Number.isInteger(w?.planEx) && w.planEx >= plannedDone ? w.planEx : plannedEntries.length) : 0,
    plannedDone: isPlannedSession ? plannedDone : 0,
    extra: extras.filter(done).length,
    plannedSets, extraSets,
    totalSets: plannedSets + extraSets,
    totalDone: entries.filter(done).length,
  }
}

/**
 * The number of planned exercises a running session had, for `planEx` at finish — counted before
 * the entries without a completed set drop out, so a planned exercise skipped still counts as
 * planned. null when it would say nothing the finished entries do not (no extra, nothing skipped).
 */
export function plannedExerciseCount(activeEntries, finishedEntries) {
  const all = Array.isArray(activeEntries) ? activeEntries.filter(Boolean) : []
  if (!all.some(e => e.rid || isExtra(e))) return null
  const planned = all.filter(e => !isExtra(e)).length
  const kept = (Array.isArray(finishedEntries) ? finishedEntries : []).filter(e => !isExtra(e)).length
  const anyExtra = all.some(isExtra)
  return anyExtra || planned !== kept ? planned : null
}
