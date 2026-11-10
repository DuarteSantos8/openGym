// A likely typo caught at the tick: 300 typed for 30, or 8 for 80. The weight or reps you tick
// becomes last time's numbers, the progression's next target and possibly a PR, so a slip of one
// digit is worth one question before it is logged. Pure: the workout screen asks, these decide.
import { isWarmupRow, isSideSet } from './workout-model.js'

// A per-side set is two rows of numbers, one per side; a timed row has no weight or reps to slip.
const rowsOf = s => (isSideSet(s) ? [s.sides?.L, s.sides?.R].filter(Boolean) : [s])

/** The heaviest weight and the most reps ever logged for `exId`, over every set of every workout. */
export function bestsFor(workouts, exId) {
  let w = 0, r = 0
  for (const wk of workouts || []) for (const e of wk.entries || []) {
    if (e.id !== exId) continue
    for (const s of e.sets || []) for (const x of rowsOf(s)) {
      w = Math.max(w, Number(x?.w) || 0)
      r = Math.max(r, Number(x?.r) || 0)
    }
  }
  return { w, r }
}

/**
 * The row last time that set `i` of `sets` stands for: the same work set (the third work set
 * against last time's third), or the same warm-up. One side of a per-side set reads that side;
 * a per-side set against a plain one (or the other way round) has nothing to compare with.
 */
export function lastRowFor(lastSets, sets, i, side) {
  const s = sets?.[i]
  if (!s || !lastSets?.length) return null
  const warm = isWarmupRow(s)
  const n = sets.slice(0, i).filter(x => isWarmupRow(x) === warm).length
  const prev = lastSets.filter(x => isWarmupRow(x) === warm)[n]
  if (!prev || !!side !== isSideSet(prev)) return null
  return side ? prev.sides?.[side] || null : prev
}

/**
 * What looks mistyped in `row` ({ w, r }): a list of { f: 'w' | 'r', typed, ref, low }.
 * Too high: over twice the exercise's best (`best`, from bestsFor), and by at least 10 kg (20 lb)
 * or 10 reps, so a beginner's 10 kg after a best of 4 kg is not questioned. Too low: under a
 * third of the same set last time (`last`), and by at least 10 kg (20 lb) or 5 reps. An assisted
 * exercise's weight is help, where less is more and either way is normal, so it is not checked.
 * A first time (no best, no last time) checks nothing.
 */
export function oddValues(row, best, { unit = 'kg', assisted = false, last = null } = {}) {
  const out = []
  const w = Number(row?.w) || 0, r = Number(row?.r) || 0
  const lw = Number(last?.w) || 0, lr = Number(last?.r) || 0
  const gap = unit === 'lb' ? 20 : 10
  if (!assisted && best.w > 0 && w > 2 * best.w && w - best.w >= gap) out.push({ f: 'w', typed: w, ref: best.w })
  else if (!assisted && lw > 0 && w < lw / 3 && lw - w >= gap) out.push({ f: 'w', typed: w, ref: lw, low: true })
  if (best.r > 0 && r > 2 * best.r && r - best.r >= 10) out.push({ f: 'r', typed: r, ref: best.r })
  else if (lr > 0 && r < lr / 3 && lr - r >= 5) out.push({ f: 'r', typed: r, ref: lr, low: true })
  return out
}
