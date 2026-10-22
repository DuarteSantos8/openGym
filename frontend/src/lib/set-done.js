// Ticking an open set done, shared by the workout screen (views/Workout.jsx toggle) and the Apple
// Watch's Completed (store/useStore.js logWatchSet): what the tick writes, and the rest, superset
// and `cur` flow after it. Beeps, keyboards, sheets and scrolling stay with the screen.
import { bestWeightForEntry, modeOf, supersetUnits, unitOf } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { pyramidRestFor } from './pyramid.js'
import { nextUnfinishedUnit, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, warmupRestSecFor } from './supersetFlow.js'

// The pause between the left and the right side of one timed per-side set (owner's call): long
// enough to turn over, far shorter than the rest the set earns once both sides are held.
export const SWITCH_SIDES_SEC = 10

/**
 * Marks set `i` of entry `idx` done on the draft state `s` (a store update). `w`/`r` replace the
 * row's load and reps when they are numbers (0 is a bodyweight load). Returns what the tick
 * finished: { checked, exJustDone, unitDone, workoutDone }.
 */
export function applySetDone(s, idx, i, { at, w, r } = {}) {
  const entries = s.active.entries
  const e = entries[idx]
  const set = e.sets[i]
  if (Number.isFinite(w)) set.w = w
  if (Number.isFinite(r)) set.r = r
  set.done = true
  // When the work happened, for the session's end (lib/finish-workout.js sessionEnd).
  if (at != null) set.at = at
  // A finished row has no use for a plan set aside by a hold that did not finish.
  if (set.planSec != null) delete set.planSec
  // The unit that owns the ticked set, not the marked one: in list mode any exercise can be
  // worked on, and judging the marker's unit declared the workout complete after one set elsewhere.
  const units = supersetUnits(entries)
  const unitDone = unitOf(units, idx).every(ui => entries[ui].sets.every(x => x.done))
  const workoutDone = unitDone && !nextUnfinishedUnit(entries, units, idx)
  let exJustDone = false
  if (e.sets.every(x => x.done)) {
    exJustDone = true
    // topW is captured now; exWeights only at the finish (doFinishWorkout), so a typo you
    // correct before finishing, or a discarded workout, never becomes the remembered best.
    e.topW = bestWeightForEntry(e) || null
  }
  return { checked: true, exJustDone, unitDone, workoutDone }
}

/**
 * The rest and the marker after a tick: `get`/`update` are the store's, `useUI` the UI store.
 * `isNew` is false for a re-check of finished work (setProgressHighWater), which owes at most a
 * rest. `collapse`: finished exercises fold away in the list, so the marker moves on to what is
 * left (onCollapse is told first). `startRest`/`stopRest` default to useUI's.
 */
export function afterSetDone({ get, update, useUI, S, idx, i, result, isNew = true, collapse = false, onCollapse, startRest, stopRest, onFocusProgress }) {
  const fresh = get().S.active
  if (!fresh || !result?.checked || !fresh.entries[idx]) return
  const ui = useUI.getState()
  const rest = startRest || ui.startRest
  const stop = stopRest || ui.stopRest
  const entry = fresh.entries[idx]

  const freshUnits = supersetUnits(fresh.entries)
  const freshUnit = freshUnits.find(u => u.includes(idx))
  const freshUnitDone = freshUnit?.every(ui => fresh.entries[ui].sets.every(x => x.done))
  const nextUnit = freshUnitDone ? nextUnfinishedUnit(fresh.entries, freshUnits, idx) : null
  const freshWorkoutDone = freshUnitDone && !nextUnit
  const restBeforeWarmup = nextUnit?.some(ui =>
    fresh.entries[ui].sets.some(set => isWarmupRow(set) && !set.done),
  )
  // The rest this set has earned: the exercise's own restSec when it set one, the global timer
  // when it did not, and the longest of the group's across a superset (issue #10). A pyramid set
  // may carry its own rest, standing in for the exercise's (pyramidRestFor).
  const setRest = { idx, sec: pyramidRestFor(entry.target, entry.sets, i) }
  const restSec = restSecFor(fresh.entries, freshUnit || [idx], (S || get().S).restSec, setRest)
  // A warm-up ramp set may rest shorter than a work set (the exercise's warmupRestSec); the
  // last ramp set, into the first work set, still gets the working rest.
  const restAfter = warmupRestSecFor(entry, i, restSec)

  // A re-check of finished work must not navigate or reopen a sheet, but it may still owe you a
  // rest (restOnRecheck, issue #3). A rest that only shows Ready is not running; a paused one is
  // still the rest you are in, and a re-check leaves it as it is.
  if (!isNew) {
    const timer = ui.timer
    if (!restBeforeWarmup && restOnRecheck({ timerRunning: !!(timer && !timer.ready), unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) rest(restAfter, idx, { forSet: i })
    return
  }

  if (collapse && freshUnitDone && nextUnit && freshUnit?.includes(fresh.cur)) {
    onCollapse?.()
    update(s => { if (s.active) s.active.cur = nextUnit[0] })
  }

  // Between the two sides of one timed per-side set: a short "Switch sides" pause instead of the
  // set's whole rest, which comes once both sides are held. A rest switched Off stays off.
  const rows = entry.sets
  const sideOf = r => r && !isWarmupRow(r) ? r.side : null
  const partner = sideOf(rows[i]) === 'L' && sideOf(rows[i + 1]) === 'R' ? rows[i + 1]
    : sideOf(rows[i]) === 'R' && sideOf(rows[i - 1]) === 'L' ? rows[i - 1] : null
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  if (mode === 'time' && partner && !partner.done && restAfter > 0) {
    rest(Math.min(SWITCH_SIDES_SEC, restAfter), idx, { kind: 'switch', forSet: i })
    return
  }

  // Singleton units rest between sets and after the closing one unless the next unit has an
  // unfinished warm-up, and never enter superset navigation. stop first so a rest that belongs
  // after this set replaces the one that was running.
  if (freshUnitDone) stop()
  if (!freshUnit || freshUnit.length <= 1) {
    if (!restBeforeWarmup && restAfterSet({ unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) rest(restAfter, idx, { forSet: i })
    onFocusProgress?.({ unitDone: freshUnitDone })
    return
  }

  const step = supersetFlowStep(fresh.entries, freshUnit, idx)
  if (!step) { onFocusProgress?.({ unitDone: freshUnitDone }); return }
  if (step.unitDone) {
    if (nextUnit?.length && !restBeforeWarmup) rest(restAfter, idx, { forSet: i })
  } else {
    if (step.nextIdx != null) update(s => { if (s.active) s.active.cur = step.nextIdx })
    if (step.roundDone) rest(restAfter, idx, { forSet: i })
  }
  onFocusProgress?.({ unitDone: freshUnitDone })
}
