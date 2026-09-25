import { uid } from './format.js'

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
