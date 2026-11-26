// How a set just finished went, for the spoken cues (#1393): short of the plan, hard, a beat of
// the plan or of last time, or simply on target. Worked out from the log, nothing is stored.
// Last time is what the workout screen calls last time (history.js lastEntryFor); the workout in
// progress is not in the log yet, so it never counts against itself.
import { isWarmupRow, isFailureSet, hasCompletedWork, modeForSet } from './workout-model.js'
import { lastEntryFor } from './history.js'
import { rirOf } from './effort.js'
import { isAssisted } from './exercises.js'

const num = v => Number(v) || 0

/**
 * `{ outcome: 'beat' | 'hit' | 'short' | 'hard', moreReps, last: { w, r } | null }` for row `i`
 * of `entry`, or null for a warm-up, a set not done, or cardio (nothing to compare).
 * First match wins: short, hard, beat, hit. `moreReps` is the reps above last time's same set.
 * A planned rep range (target.repsMin to target.reps) is short below its low end and a beat
 * above its high end.
 */
export function setOutcome (S, entry, i) {
  const row = entry?.sets?.[i]
  if (!row || isWarmupRow(row) || !hasCompletedWork(row)) return null
  const target = entry.target || {}
  const mode = modeForSet(row, target)
  if (mode === 'cardio' || mode === 'distance') return null

  const n = entry.sets.slice(0, i).filter(s => !isWarmupRow(s)).length
  const prev = lastEntryFor(S, entry.id, entry.rid)?.sets?.[n]
  const last = prev ? { w: num(prev.w), r: num(prev.r) } : null
  const moreReps = last && mode === 'reps' ? Math.max(0, num(row.r) - last.r) : 0

  // A per-side row's reps are both sides added up, so its plan is too.
  const sides = row.sides ? 2 : 1
  let low = 0, high = 0
  if (mode === 'time') low = high = num(target.sec) * sides
  else {
    const goal = num(Array.isArray(target.rowReps) ? target.rowReps[n] : 0) || num(target.reps)
    high = goal * sides
    low = (num(target.repsMin) > 0 && num(target.repsMin) < goal ? num(target.repsMin) : goal) * sides
  }
  const done = mode === 'time' ? num(row.sec) : num(row.r)

  let outcome = 'hit'
  if (low > 0 && done < low) outcome = 'short'
  else if (rirOf(row) === 0 && !isFailureSet(row)) outcome = 'hard'
  else if (high > 0 && done > high) outcome = 'beat'
  else if (prev) {
    const better = mode === 'time' ? done > num(prev.sec)
      : moreReps > 0 || (isAssisted(entry) ? num(row.w) < last.w : num(row.w) > last.w)
    if (better) outcome = 'beat'
  }
  return { outcome, moreReps, last }
}
