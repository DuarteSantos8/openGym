// What the watch's set menu does to a set, on the phone's own rules (the set's ⋯ menu in
// views/Workout.jsx): the closures there and the watch's events share these, so a mark means the
// same wherever it comes from.
import { isWarmupRow, isFailureSet, toggleFailure, isDropSet, isRestPauseSet, isSideSet, dropsOf, addDrop, addSideDrop, removeDropAt, removeSideDropAt, nextDropWeight } from './workout-model.js'
import { setSpanAt, modeOf, canBeWarmup, makeWarmupAt, makeWorkAt } from './history.js'
import { dropGrid } from './plates.js'
import { inEntryUnit } from './ex-unit.js'

/** Failure on or off across the whole span of set `i` (a timed per-side pair is one set). */
export function toggleFailureSpan (sets, i) {
  const [start, count] = setSpanAt(sets, i)
  const on = !isFailureSet(sets[i])
  for (let j = start; j < start + count; j++) if (isFailureSet(sets[j]) !== on) sets[j] = toggleFailure(sets[j])
}

/** `row` with one more drop: a per-side set drops per side (issue #60), a plain one from its last drop. */
export function withDrop (S, entry, row) {
  const pct = entry.target?.intensifier?.type === 'dropset' ? entry.target.intensifier.pct : undefined
  const grid = dropGrid(S, { ...entry.target, id: entry.id })
  if (isSideSet(row)) return addSideDrop(row, pct, grid)
  const drops = dropsOf(row)
  const base = drops.length ? drops[drops.length - 1].w : (row.w || 0)
  return addDrop(row, { w: nextDropWeight(base, pct, grid), r: row.r })
}

/**
 * Applies `{ warmup?, failure?, drop? }` to set `i` of active entry `idx` in the draft `s`. Each part
 * acts only when it differs from the set as it is, and only where the phone's menu offers it. A
 * warm-up change moves the row, so it goes alone. Returns whether anything changed.
 */
export function applyWatchMark (s, idx, i, { warmup, failure, drop } = {}) {
  const e = s?.active?.entries?.[idx]
  const row = e?.sets?.[i]
  if (!row) return false
  // The set's own menu (Workout.jsx), done sets included: a warm-up you logged and re-marked later.
  if (warmup != null && warmup !== isWarmupRow(row)) {
    if (modeOf({ ...(e.target || {}), id: e.id }) !== 'reps') return false
    if (isWarmupRow(row)) { e.sets = makeWorkAt(e.sets, i); return true }
    if (!canBeWarmup(row) || !e.sets.some((x, j) => j !== i && !isWarmupRow(x))) return false
    e.sets = makeWarmupAt(e.sets, i)
    return true
  }
  if (isWarmupRow(row)) return false
  let changed = false
  if (failure != null && failure !== isFailureSet(row) && modeOf({ ...(e.target || {}), id: e.id }) !== 'cardio') {
    toggleFailureSpan(e.sets, i)
    changed = true
  }
  if (drop != null && modeOf({ ...(e.target || {}), id: e.id }) === 'reps') {
    const drops = isSideSet(row) ? dropsOf(row.sides.L).length : dropsOf(row).length
    if (drop && !isDropSet(row) && !isRestPauseSet(row) && !drops) {
      inEntryUnit(s, idx, en => { en.sets[i] = withDrop(s, en, en.sets[i]) })
      changed = true
    } else if (!drop && drops === 1) {
      inEntryUnit(s, idx, en => { en.sets[i] = isSideSet(en.sets[i]) ? removeSideDropAt(en.sets[i], 0) : removeDropAt(en.sets[i], 0) })
      changed = true
    }
  }
  return changed
}
