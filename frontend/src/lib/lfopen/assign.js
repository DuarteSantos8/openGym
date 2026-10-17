// Where a Life Fitness result goes in the running workout (docs/LIFE_FITNESS_CARDIO_CONNECT.md,
// B3 step 2): straight onto the exercise you are on when it is the machine's; otherwise the
// workout view asks first — to use that exercise further down the session, or to add it.

/**
 * { kind: 'current', idx } — the exercise the session is on is this one: no question
 * { kind: 'inWorkout', idx } — the session has it elsewhere
 * { kind: 'notInWorkout' }   — the session does not have it
 * { kind: 'none' }           — no session or no exercise
 */
export function placeResult(active, exId) {
  if (!active || !Array.isArray(active.entries) || exId == null) return { kind: 'none' }
  const cur = active.entries[active.cur]
  if (cur && cur.id === exId) return { kind: 'current', idx: active.cur }
  const idx = active.entries.findIndex(e => e && e.id === exId)
  return idx >= 0 ? { kind: 'inWorkout', idx } : { kind: 'notInWorkout' }
}

/**
 * Puts the result's set on an entry: into its first set not yet done (the planned one, waiting
 * to be filled — a warm-up aside), else after the others. Mutates the entry; returns the index.
 */
export function applyResultSet(entry, set) {
  if (!entry) return -1
  if (!Array.isArray(entry.sets)) entry.sets = []
  const i = entry.sets.findIndex(s => s && !s.done && s.phase !== 'warmup')
  if (i >= 0) { entry.sets[i] = { ...set }; return i }
  entry.sets.push({ ...set })
  return entry.sets.length - 1
}
