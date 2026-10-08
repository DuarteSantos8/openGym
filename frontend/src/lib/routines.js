import { uid } from './format.js'
import { defaultPlanRule } from './prescription/index.js'
import { isAssisted, isBodyweightEq, isCardio } from './exercises.js'

/**
 * Create a deep copy of a routine with a new id and a "(Copy)" suffix.
 * All exercises and their configuration are preserved independently.
 */
export function copyRoutine(routine, suffix = 'Copy') {
  const copy = structuredClone(routine)
  copy.id = uid()
  // "Push (Copy)" copied again becomes "Push (Copy 2)", not "Push (Copy) (Copy)".
  const esc = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp('^(.*) \\(' + esc + '(?: (\\d+))?\\)$').exec(routine.name || '')
  copy.name = m ? m[1] + ' (' + suffix + ' ' + ((Number(m[2]) || 1) + 1) + ')' : routine.name + ' (' + suffix + ')'
  // An occurrence's progression track is its own occurrenceId (two occurrences of the same
  // exercise progress independently) — carrying the source's ids over verbatim would entangle
  // the copy's history with the original's. Legacy occurrences (no occurrenceId) have nothing
  // here to regenerate and pass through untouched.
  copy.ex = (copy.ex || []).map(e => e.occurrenceId == null ? e : {
    ...e,
    occurrenceId: uid(),
    ...(e.rule ? { rule: { ...e.rule, id: uid(), routineId: copy.id } } : {}),
  })
  return copy
}

/**
 * Delete a routine and every pointer to it, in place on a store draft. A weekday holds a list of
 * routine ids, so the deleted one is pulled from each day and the key dropped when it empties
 * (never store []); a day that never named it is left exactly as it was. A per-date reschedule
 * (dayPlan) naming it goes too: left behind, the day still counts as overridden and wears a
 * "rescheduled" badge for good with no way to clear it.
 *
 * Plan's swipe, RoutineEdit's button and the Coach's remove-routine all delete through here, so
 * the next thing that learns to point at a routine is cleaned up in one place, not three.
 * Returns the dropped dayPlan entries ({ iso: id }), which the Coach records so a revert can put
 * them back.
 */
export function deleteRoutine(s, id) {
  s.routines = s.routines.filter(r => r.id !== id)
  Object.keys(s.week || {}).forEach(d => {
    const ids = [].concat(s.week[d])
    if (!ids.includes(id)) return
    const next = ids.filter(rid => rid !== id)
    if (next.length) s.week[d] = next; else delete s.week[d]
  })
  const dropped = {}
  Object.keys(s.dayPlan || {}).forEach(iso => {
    if (s.dayPlan[iso] === id) { dropped[iso] = id; delete s.dayPlan[iso] }
  })
  return dropped
}

/**
 * Everything deleteRoutine is about to take away, so an Undo can put the routine back where it
 * was (Plan's swipe and minus, v1.3.11): the routine itself and its place in the list, its place
 * on each weekday that holds it, the reschedules that name it, and its places in the saved loop
 * and the live queue. deleteRoutine leaves the last two alone (an id that no longer resolves is
 * skipped where they are read), but a save in between may have dropped it, so they are kept too.
 * Null when there is no such routine.
 */
export function routineSnapshot(S, id) {
  const index = (S.routines || []).findIndex(r => r.id === id)
  if (index < 0) return null
  const week = {}
  Object.keys(S.week || {}).forEach(d => {
    const at = [].concat(S.week[d]).indexOf(id)
    if (at >= 0) week[d] = at
  })
  const dayPlan = {}
  Object.keys(S.dayPlan || {}).forEach(iso => { if (S.dayPlan[iso] === id) dayPlan[iso] = id })
  const seqAt = Array.isArray(S.rotation?.sequence) ? S.rotation.sequence.indexOf(id) : -1
  const queueAt = Array.isArray(S.queue?.ids) ? S.queue.ids.indexOf(id) : -1
  return { routine: structuredClone(S.routines[index]), index, week, dayPlan, seqAt, queueAt }
}

const putBack = (list, at, id) => {
  if (list.includes(id)) return list
  const next = list.slice()
  next.splice(Math.min(at, next.length), 0, id)
  return next
}

/**
 * Undo for deleteRoutine, in place on a store draft, from a routineSnapshot taken just before it.
 * Each pointer goes back to its old position, or to the end of a list that has since got
 * shorter; a reschedule only where that date has not been planned again since. False, and nothing
 * changed, when a routine with that id exists again (another device put it back first).
 */
export function restoreRoutine(s, snap) {
  if (!snap?.routine || !Array.isArray(s.routines)) return false
  const id = snap.routine.id
  if (s.routines.some(r => r.id === id)) return false
  s.routines.splice(Math.min(snap.index, s.routines.length), 0, structuredClone(snap.routine))
  if (Object.keys(snap.week).length) s.week = s.week || {}
  Object.entries(snap.week).forEach(([d, at]) => {
    s.week[d] = putBack(s.week[d] == null ? [] : [].concat(s.week[d]), at, id)
  })
  if (Object.keys(snap.dayPlan).length) s.dayPlan = s.dayPlan || {}
  Object.keys(snap.dayPlan).forEach(iso => { if (s.dayPlan[iso] == null) s.dayPlan[iso] = id })
  if (snap.seqAt >= 0 && Array.isArray(s.rotation?.sequence)) {
    s.rotation = { ...s.rotation, sequence: putBack(s.rotation.sequence, snap.seqAt, id) }
  }
  if (snap.queueAt >= 0 && Array.isArray(s.queue?.ids)) s.queue = { ...s.queue, ids: putBack(s.queue.ids, snap.queueAt, id) }
  return true
}

/**
 * A routine slot with another exercise in it (#110). The slot keeps its place, its superset, its
 * note and — when the two exercises are the same kind of work — its rule, warm-up and intensifier,
 * and only the exercise changes. Cardio, bodyweight and assistance-machine work each mean something
 * else by "load", so between kinds the slot starts from the new exercise's default rule.
 *
 * The replacement is a new occurrence: progression belongs to an occurrence (its track), so the new
 * exercise starts on its own line instead of inheriting the old exercise's load history, and the old
 * one keeps its history, ready if it comes back. Picking the exercise already in the slot changes
 * nothing.
 */
export function replaceSlotExercise(slot, id, S, rid) {
  const old = slot || {}
  if (old.exerciseId === id) return { ...old }
  const occurrenceId = uid()
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const preset = isCardio(id) ? 'autoregulated' : isBodyweightEq(id) ? 'bodyweight_ladder' : 'linear'
  const fresh = defaultPlanRule(preset, { id: occurrenceId, exerciseId: id, routineId: rid ?? null, unit })
  const sameKind = isCardio(old.exerciseId) === isCardio(id) && isBodyweightEq(old.exerciseId) === isBodyweightEq(id) && (typeof old.assisted === 'boolean' ? old.assisted : isAssisted(old.exerciseId)) === isAssisted(id)
  if (!sameKind || !old.rule) {
    const kept = Object.fromEntries(['sg', 'note'].filter(key => old[key] != null).map(key => [key, old[key]]))
    return { occurrenceId, exerciseId: id, rule: fresh, ...kept }
  }
  // "Assisted" describes the movement, not the prescription: the new exercise follows its own.
  const { assisted: _movement, ...carried } = old
  return { ...carried, occurrenceId, exerciseId: id, rule: { ...old.rule, id: occurrenceId, exerciseId: id, revision: 1 } }
}
