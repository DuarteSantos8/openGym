// How a set just finished went, for the spoken cues (#1393): short of the plan, hard, a beat of
// last time or of the plan, or simply on target. Worked out from the log, nothing is stored.
// "Better than last time" is the arrow on the set's row (set-trend.js), so the voice never says
// the opposite of the screen. Last time is what the workout screen calls last time: the history
// the session was built from (sessionHistory), so a workout logged into the past is held against
// the days before it; the live workout is not in the log yet and never counts against itself.
import { isWarmupRow, isSideSet, isFailureSet, hasCompletedWork, modeForSet } from './workout-model.js'
import { lastEntryFor } from './history.js'
import { sessionHistory } from './backfill.js'
import { setTrendsFor } from './set-trend.js'
import { formulaOf } from './onerm.js'
import { shownWeight } from './ex-unit.js'
import { rirOf } from './effort.js'
import { isAssisted } from './exercises.js'

const num = v => Number(v) || 0

// Reps of one side for a per-side row (the weaker side, so "each side did at least this"),
// else the row's reps. A per-side row's own `r` is both sides added up.
const repsEach = row => (isSideSet(row) ? Math.min(num(row.sides.L.r), num(row.sides.R.r)) : num(row.r))

/**
 * `{ outcome: 'beat' | 'hit' | 'short' | 'hard', beat }` for row `i` of `entry`, or null for a
 * warm-up, a set not done, or cardio (nothing to compare). First match wins: short, hard, beat,
 * hit. `beat` says what beat, or is null:
 *   { kind: 'reps', n, side }  n more reps than the same set last time (per side when `side`)
 *   { kind: 'weight', n }      the same reps, n more weight (in the unit the exercise is shown in)
 *   { kind: 'sec', n }         a hold n seconds longer than last time
 *   { kind: 'plan' }           more than the plan's top (reps or seconds), nothing to compare with
 * Better than last time is set-trend.js's call; less help on an assisted machine is not said.
 * A planned rep range (target.repsMin to target.reps) is short below its low end.
 */
export function setOutcome (S, entry, i) {
  const row = entry?.sets?.[i]
  if (!row || isWarmupRow(row) || !hasCompletedWork(row)) return null
  const target = entry.target || {}
  const mode = modeForSet(row, target)
  if (mode === 'cardio' || mode === 'distance') return null

  const n = entry.sets.slice(0, i).filter(s => !isWarmupRow(s)).length
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

  if (low > 0 && done < low) return { outcome: 'short', beat: null }
  if (rirOf(row) === 0 && !isFailureSet(row)) return { outcome: 'hard', beat: null }

  let beat = null
  const last = lastEntryFor(sessionHistory(S), entry.id, entry.rid)
  const assisted = isAssisted(entry)
  const prev = last?.sets?.filter(s => !isWarmupRow(s))[n]
  if (prev && setTrendsFor(entry, last, { formula: formulaOf(S), mode, assisted })[i]?.dir > 0) {
    if (mode === 'time') beat = { kind: 'sec', n: num(row.sec) - num(prev.sec) }
    else if (isSideSet(row) === isSideSet(prev)) {
      const more = repsEach(row) - repsEach(prev)
      const heavier = Math.round((shownWeight(S, entry.id, num(row.w)) - shownWeight(S, entry.id, num(prev.w))) * 100) / 100
      if (more > 0) beat = { kind: 'reps', n: more, side: isSideSet(row) }
      else if (!assisted && heavier > 0) beat = { kind: 'weight', n: heavier }
    }
  }
  // Above the plan on every side: the weaker side counts, as for last time.
  const every = mode === 'time' ? done : repsEach(row) * sides
  if (!beat && high > 0 && every > high) beat = { kind: 'plan' }
  return { outcome: beat ? 'beat' : 'hit', beat }
}
