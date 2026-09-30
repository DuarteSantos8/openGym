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
  const preset = isCardio(id) ? 'manual' : isBodyweightEq(id) ? 'bodyweight_ladder' : 'linear'
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
