import { supersetMeta } from './superset-meta.js'
// Pure decisions for the active-workout superset flow. Keeping these independent of React and
// the stores makes the uneven-round and re-check rules explicit and directly testable.
import { isWarmupRow } from './workout-model.js'

const hasWork = (entries, idx) => !!entries[idx]?.sets?.some(set => !set.done)

/**
 * The unit Prev (`dir` -1) or Next (+1) lands on from unit `from` in Cards and Focus, or -1 at
 * either end. With "Skip completed exercises" (#523, `skipDone`) it jumps over units whose every
 * set is done; when everything that way is done it takes the next one after all, so the buttons
 * and the swipe still step through a finished session.
 */
export function stepUnitIndex(entries, units, from, dir, skipDone = false) {
  const n = from + dir
  if (!Array.isArray(units) || n < 0 || n >= units.length) return -1
  if (!skipDone) return n
  for (let i = n; i >= 0 && i < units.length; i += dir) if ((units[i] || []).some(idx => hasWork(entries, idx))) return i
  return n
}

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
export function restSecFor(entries, unit, defaultRestSec, setRest = null) {
  const fallback = defaultRestSec > 0 ? defaultRestSec : 0
  const idxs = Array.isArray(unit) && unit.length ? unit : []
  if (!idxs.length) return fallback
  // A superset with a rest of its own (#292) rests exactly that after each round.
  if (idxs.length > 1) {
    const { rest } = supersetMeta(entries, idxs, { onTarget: true })
    if (rest > 0) return rest
  }
  return idxs.reduce((longest, idx) => {
    // `setRest` is the ticked set's own rest ({ idx, sec }, a pyramid set): it stands in for
    // that member's exercise rest, and a superset still takes the longest of the group.
    const own = setRest && setRest.idx === idx && setRest.sec > 0 ? setRest.sec : entries?.[idx]?.target?.restSec
    return Math.max(longest, own > 0 ? own : fallback)
  }, 0)
}

/**
 * The rest a completed set earns when it was a warm-up ramp set.
 *
 * Ramp sets are light and short, so an exercise may carry its own `warmupRestSec` in its target
 * next to `restSec`. It applies between ramp sets only: the break after the LAST ramp set, into
 * the first work set, is `workRestSec` (the value restSecFor resolved), because that is the rest
 * the first heavy set actually needs. An exercise without the field falls back to `profileSec`,
 * the profile's warm-up rest (0 = no timer), and without that, like a work set, rests
 * `workRestSec` — exactly what every routine did before either existed.
 */
export function warmupRestSecFor(entry, setIdx, workRestSec, profileSec) {
  const sets = Array.isArray(entry?.sets) ? entry.sets : []
  const set = sets[setIdx]
  if (!set || !isWarmupRow(set)) return workRestSec
  const next = sets.slice(setIdx + 1).find(s => !s.done)
  if (!next || !isWarmupRow(next)) return workRestSec
  // "No timer" between ramp sets: an optional `warmupRestOff` (set in the exercise's settings).
  if (entry?.target?.warmupRestOff === true) return 0
  const own = Number(entry?.target?.warmupRestSec)
  if (own > 0) return own
  // Then the profile's (Settings > Workout, S.warmupRestSec): 0 is "no timer", absent is like
  // the work sets.
  const all = typeof profileSec === 'number' && Number.isFinite(profileSec) ? Math.round(profileSec) : null
  if (all === 0) return 0
  return all > 0 ? all : workRestSec
}

/**
 * The break between the two sides of one per-side set, or null for none. An exercise may set its
 * own `sideRestSec` (optional, Discord "set-specific rest timers"). Without it nothing changes:
 * a timed hold pauses `switchSec` (capped at the set's rest, and none with the rest switched off),
 * and a reps set has no break between its sides, as before the field existed.
 */
export function sideRestFor(target, { timed, restAfter, switchSec }) {
  const own = Math.round(Number(target?.sideRestSec)) || 0
  if (own > 0) return own
  if (timed && restAfter > 0) return Math.min(switchSec, restAfter)
  return null
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

/**
 * Where Cards and Focus move on their own once the rest after a timed exercise's last set has run
 * out (#532): a plank or an L-sit has nothing to adjust before the next exercise, so the screen
 * goes there without a tap. Only when every exercise of the unit the rest was for is timed
 * (`isTimed(idx)`) and finished, and that unit is still the one on screen; then the next unit with
 * work left (nextUnfinishedUnit), its first exercise. null for anything else: weighted work still
 * waits for Next, as before.
 */
export function advanceAfterTimedRest(entries, units, forIdx, cur, isTimed) {
  if (!Array.isArray(entries) || !Array.isArray(units) || !Number.isInteger(forIdx)) return null
  const unit = units.find(u => u.includes(forIdx))
  if (!unit || !unit.includes(cur)) return null
  if (!unit.every(idx => isTimed(idx) && (entries[idx]?.sets || []).length > 0 && !hasWork(entries, idx))) return null
  const next = nextUnfinishedUnit(entries, units, forIdx)
  return next ? next[0] : null
}

