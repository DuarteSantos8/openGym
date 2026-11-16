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
import { legacyEntriesOf } from './prescription/index.js'
import { isSideSet, isWarmupRow } from './workout-model.js'

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
  // Repeating a day means the day: every exercise opens at the rows it logged then — their weights
  // and reps, the bonus set or the one skipped — with that workout as its only history, so a later
  // session of the same exercise does not seed them. A day kept out of progression opens at its plan.
  const days = legacyEntriesOf({ exposures: known }, draft.prescriptions)
  let from = 0
  const rows = new Map()
  for (const occ of routine.ex) {
    const at = known.findIndex((x, i) => i >= from && x.exerciseId === occ.exerciseId)
    if (at < 0) continue
    from = at + 1
    if (known[at].excludedFromProgression) continue
    const done = (days[at]?.sets || []).filter(row => row.done && !isWarmupRow(row))
    // A per-side set is a left and a right row (or one row holding both): one set of both sides' reps.
    const sets = done.flatMap((row, i) => (isSideSet(row) ? [{ ...row, w: row.w ?? row.sides?.L?.w, r: (row.sides?.L?.r || 0) + (row.sides?.R?.r || 0) }]
      : row.side === 'R' && done[i - 1]?.side === 'L' ? [] : row.side === 'L' && done[i + 1]?.side === 'R' ? [{ ...row, r: (row.r || 0) + (done[i + 1].r || 0) }] : [row]))
    if (sets.length) rows.set(occ.occurrenceId, sets)
    // Its warm-ups are that day's too: none when it logged none, a ramp of as many when the plan has none of its own now.
    const warmups = (days[at]?.sets || []).filter(isWarmupRow).length
    const planned = occ.warmup != null || occ.warmupRows != null || occ.legacyWarmupSets > 0 || occ.warmupSets > 0
    if (!warmups && occ.warmup !== 'none') for (const k of ['warmup', 'warmupRows', 'legacyWarmupSets', 'warmupSets']) delete occ[k]
    else if (!planned) occ.legacyWarmupSets = Math.min(5, warmups)
  }
  const exposures = buildSessionExposures({ ...draft, workouts: [w] }, routine, { now, newId: uid, unit: draft.unit, rows })
  for (const exposure of exposures) { delete exposure.routineId; delete exposure.plan }   // a freestyle session has no routine behind it
  return { exposures, skipped }
}
