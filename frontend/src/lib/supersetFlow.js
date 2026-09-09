// Pure decisions for the active-workout superset flow. Keeping these independent of React and
// the stores makes the uneven-round and re-check rules explicit and directly testable.
const hasWork = (entries, idx) => !!entries[idx]?.sets?.some(set => !set.done)

// Return the first unfinished navigation unit after the current one, wrapping once so a user
// who completed units out of order is never offered workout completion while earlier work remains.
export function nextUnfinishedUnit(entries, units, fromIdx) {
  if (!Array.isArray(entries) || !Array.isArray(units) || units.length === 0) return null
  const current = units.findIndex(unit => unit.includes(fromIdx))
  const ordered = current < 0
    ? units
    : [...units.slice(current + 1), ...units.slice(0, current)]
  return ordered.find(unit => unit.some(idx => hasWork(entries, idx))) || null
}

// The current exercise may be one member of a contiguous superset. Insert after that complete
// navigation unit; invalid/empty state safely falls back to the end of the entry list.
export function insertionIndexAfterCurrentUnit(units, currentIndex, entryCount) {
  const length = Math.max(0, Number(entryCount) || 0)
  if (!Array.isArray(units) || units.length === 0) return length
  const unit = units.find(candidate => candidate.includes(currentIndex))
  if (!unit?.length) return length
  return Math.min(length, Math.max(...unit) + 1)
}

// A completion is new progress only when it takes this exercise beyond the largest number of
// simultaneously completed sets seen in this mounted session. Uncheck/re-check therefore does
// not repeat navigation or rest side effects, while completing an added set still can.
export function setProgressHighWater(entry, previous = 0) {
  const done = entry?.sets?.reduce((count, set) => count + (set.done ? 1 : 0), 0) || 0
  return { isNew: done > previous, highWater: Math.max(previous, done) }
}

/**
 * Whether completing a set should start a rest timer.
 *
 * A rest belongs after every completed set — the last set of an exercise included, because
 * another exercise follows it and you rest before that one too. The only set with nothing
 * left to time is the last set of the last exercise, where the session is over.
 *
 * Ordinary exercises used to "finish quietly" instead: an exercise started no rest on its
 * closing set, so a two-set exercise timed one rest instead of two (issue #3) and a rest
 * never carried across the gap into the next exercise. Supersets already did it this way.
 */
export function restAfterSet({ unitDone, lastUnit }) {
  return !unitDone || !lastUnit
}

/**
 * Whether re-checking an already-completed set should start a rest.
 *
 * The high-water rule deliberately swallows a re-check so that unchecking and re-checking
 * finished work does not replay navigation or reopen sheets. But a re-check is still you
 * telling the app a set is done, and that is the other half of issue #3 — "after the first
 * set, sometimes a break doesn't appear". That is what it looks like when you uncheck a set
 * to correct the reps after its rest has already run out: nothing times the rest you are
 * actually about to take.
 *
 * So: fill a gap, never disturb a rest that is already counting down. A timer that is running
 * belongs to the set you finished most recently, which is a better answer than restarting it.
 */
export function restOnRecheck({ timerRunning, unitDone, lastUnit }) {
  return !timerRunning && restAfterSet({ unitDone, lastUnit })
}

/**
 * How long the rest after a completed set should run, in seconds.
 *
 * An exercise may carry its own `restSec` in its target (issue #10) — a heavy triple and a set
 * of curls do not want the same break. One that carries none inherits `defaultRestSec`, the
 * global rest timer, which is what every routine did before the field existed.
 *
 * `unit` is the superset group the set belongs to, as entry indices — a plain exercise is a
 * group of one. A group rests once, after the round, so it takes the LONGEST rest any of its
 * members asked for: the shortest would send you back to the bar before the member that needs
 * the most recovery is ready.
 *
 * `defaultRestSec` of 0 is the rest timer turned off (v1.2.11). That silences the members that
 * have no rest of their own, but an exercise that explicitly asks for one still gets it — the
 * setting is a default, and this field overrides the default.
 */
export function restSecFor(entries, unit, defaultRestSec) {
  const fallback = defaultRestSec > 0 ? defaultRestSec : 0
  const idxs = Array.isArray(unit) && unit.length ? unit : []
  if (!idxs.length) return fallback
  return idxs.reduce((longest, idx) => {
    const own = entries?.[idx]?.target?.restSec
    return Math.max(longest, own > 0 ? own : fallback)
  }, 0)
}

// Decide where a newly completed superset set goes next. Spent members are skipped, including
// across the wrap. A round ends when no later member in display order has work left; this makes
// the last *active* member the boundary rather than blindly using the group's last array index.
export function supersetFlowStep(entries, unit, fromIdx) {
  if (!Array.isArray(entries) || !Array.isArray(unit) || unit.length <= 1) return null
  const pos = unit.indexOf(fromIdx)
  if (pos < 0) return null

  const unitDone = !unit.some(idx => hasWork(entries, idx))
  if (unitDone) return { unitDone: true, roundDone: false, nextIdx: null }

  const wrapped = [...unit.slice(pos + 1), ...unit.slice(0, pos + 1)]
  const nextIdx = wrapped.find(idx => hasWork(entries, idx)) ?? null
  const roundDone = !unit.slice(pos + 1).some(idx => hasWork(entries, idx))
  return { unitDone: false, roundDone, nextIdx }
}
