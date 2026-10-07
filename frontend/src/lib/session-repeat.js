// "Repeat today" (#58): a saved workout's exercises, in its order and with its supersets, as the
// entries of a new freestyle session — each row seeded from what was logged in THAT workout, not
// from the latest time the exercise was done. The source record is never touched; it stays what
// was logged that day.
//
// The exercise setup is the one "Save as routine" copies (routineFromSession: per-side, time,
// cardio, warm-up count, the superset groups renumbered, session-only fields gone). The rows are
// built the way a freestyle exercise added mid-workout builds them (Workout.jsx), with history
// narrowed to this one entry of this one workout, so "last time" is that day.
import { EXIDX } from './exercises.js'
import { routineFromSession } from './session-routines.js'
import { buildSets, applyIntensifierPlan, modeOf, setsFromRows } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { dropGrid } from './plates.js'
import { weightIncrement, defaultIncrement } from './progression.js'

const sourceEntries = w => (Array.isArray(w?.entries) ? w.entries : []).filter(entry => entry?.sets?.length)

/**
 * @returns {{ entries: object[], skipped: number }} the new session's entries (every row
 *   unchecked), and how many exercises were left out because they no longer exist (a deleted
 *   custom exercise).
 */
export function repeatSessionEntries(st, w, { exists = id => !!EXIDX[id] } = {}) {
  const src = sourceEntries(w)
  let ex
  try { ex = routineFromSession(w, w?.name, st?.routines).ex }
  catch { return { entries: [], skipped: 0 } }
  const entries = []
  let skipped = 0
  ex.forEach((copied, i) => {
    const source = src[i]
    if (!exists(copied.id)) { skipped++; return }
    const { sg, ...setup } = copied
    // As many work sets as were logged that day, done ones — the copy for a routine takes the
    // plan's count, but repeating a day means the day: the bonus set, or the set skipped.
    // A per-side timed hold logs a left and a right row per set (setsFromRows).
    const done = setsFromRows(setup, (source?.sets || []).filter(row => row?.done && !isWarmupRow(row)).length)
    const cfg = { ...setup, ...(done ? { sets: done } : {}) }
    const step = modeOf(cfg) === 'reps' ? weightIncrement(cfg, st?.unit) : defaultIncrement(cfg.id, st?.unit)
    // Only this entry of this workout is history here, so a later session of the same exercise,
    // or the same exercise twice in one workout, does not seed the rows.
    const only = { ...st, workouts: [{ ...w, entries: [source] }] }
    const sets = applyIntensifierPlan(buildSets(only, cfg, { step, preferLast: true }), cfg, dropGrid(st, cfg))
      .map(row => ({ ...row, done: false }))
    entries.push({ id: cfg.id, ...(sg ? { sg } : {}), target: { ...cfg }, plan: null, sets })
  })
  return { entries: regroup(entries), skipped }
}

// A superset whose other half was skipped is one exercise on its own, not a group of one.
function regroup(entries) {
  return entries.map((entry, i) => {
    if (!entry.sg) return entry
    const paired = entries[i - 1]?.sg === entry.sg || entries[i + 1]?.sg === entry.sg
    if (paired) return entry
    const { sg, ...rest } = entry
    return rest
  })
}
