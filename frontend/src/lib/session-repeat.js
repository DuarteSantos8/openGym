// "Repeat today" (#58): a saved workout's exercises, in its order and with its supersets, as the
// exposures of a new freestyle session — each seeded from what THAT workout logged, not from the
// latest time the exercise was done. The source record is never touched.
//
// The setup is the one "Save as routine" copies (routineFromSession): the rule is shaped by what
// was done, under fresh occurrence ids, so the repeat is its own progression line.
import { EXIDX } from './exercises.js'
import { uid } from './format.js'
import { routineFromSession } from './session-routines.js'
import { buildSessionExposures } from './session-start.js'

/**
 * Runs on a store draft: the prescriptions it builds are stored on it.
 * @returns {{ exposures: object[], skipped: number }} the new session's exposures, and how many
 *   exercises were left out because they no longer exist (a deleted custom exercise).
 */
export function repeatSessionExposures(draft, w, { exists = id => !!EXIDX[id], now = Date.now() } = {}) {
  const logged = (w?.exposures || []).filter(x => x?.performance?.sets?.length)
  const known = logged.filter(x => exists(x.exerciseId))
  const skipped = logged.length - known.length
  let routine
  try { routine = routineFromSession({ ...w, exposures: known }, w?.name, draft.routines, draft.unit === 'lb' ? 'lb' : 'kg') }
  catch { return { exposures: [], skipped } }
  const exposures = buildSessionExposures(draft, routine, { now, newId: uid, unit: draft.unit })
  for (const exposure of exposures) delete exposure.routineId   // a freestyle session has no routine behind it
  return { exposures, skipped }
}
