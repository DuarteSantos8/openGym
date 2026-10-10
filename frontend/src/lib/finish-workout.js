// The persisted boundary for a finished session. Keep this pure so compatibility tests can
// exercise the exact shape the UI writes without mounting React or mutating store state.
import { bestWeightForEntry, cleanupSg } from './history.js'
import { hasCompletedWork, isSideSet } from './workout-model.js'

// planSec is live-session bookkeeping: a hold displaced before it finished puts its plan aside so
// the row still knows what it is asking for (Workout.startTimed). A finished session keeps only
// what was logged, so the key never reaches S.workouts — an unfinished row goes back to recording
// its plan, exactly as it did before any of this.
//
// weightOrigin is the same kind of bookkeeping (#209): it marks a load typed by hand so a later
// edit of an earlier set does not cascade over it. Once the session is over there is nothing left
// to cascade, and every load in history is simply the one logged. Kept, it would ride into the
// saved workout, the server copy and every backup as a field nothing reads — on the row and on
// each side of a per-side row, where the side keeps its own.
//
// Rows that carry neither are passed through by reference, so an ordinary session is the shape
// it always was.
function finishedRow(set) {
  if (!set) return set
  const sideMarked = isSideSet(set) && (set.sides.L.weightOrigin != null || set.sides.R.weightOrigin != null)
  if (set.planSec == null && set.weightOrigin == null && !sideMarked) return set
  const { planSec, weightOrigin, ...rest } = set
  if (sideMarked) {
    const side = ({ weightOrigin: _, ...kept }) => kept
    rest.sides = { ...rest.sides, L: side(rest.sides.L), R: side(rest.sides.R) }
  }
  return planSec == null || rest.done ? rest : { ...rest, sec: planSec }
}

export function buildCompletedWorkout(active, { end = Date.now(), prs = [], snapshotFor } = {}) {

  const isInterval = active?.interval != null

  const entries = (active?.entries || []).map(entry => {
    const completed = {
      id: entry.id,
      sets: (entry.sets || []).map(finishedRow),
      topW: bestWeightForEntry(entry) || null,
      target: entry.target || null,
      ...(entry.rid ? { rid: entry.rid } : {}),
      ...(entry.noProg === true ? { noProg: true } : {}),
      ...(entry.planned ? { planned: entry.planned } : {}),
      ...(entry.sg ? { sg: entry.sg } : {}),
    }
    const snapshot = typeof snapshotFor === 'function' ? snapshotFor(entry) : null
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && Object.keys(snapshot).length) {
      completed.muscleSnapshot = { ...snapshot }
    }
    const note = (entry.note || '').trim()
    if (note) {
      completed.note = note
      if (entry.notePin) completed.notePin = true
    }
    return completed
  }).filter(entry => isInterval || entry.sets.some(hasCompletedWork))

  // An exercise left without a single set drops out above, and its partner is then a superset
  // of one. cleanupSg clears the tag it no longer shares with a neighbour; the entries are this
  // function's own copies, so the running session is left alone.
  cleanupSg(entries)

  const sessionNote = (active?.note || '').trim()
  const routineIds = [].concat(active?.routineIds ?? (active?.routineId ? [active.routineId] : []))
  // Legacy `w.excludeFromProgression` mirror: kept for older builds and external readers, but
  // it only makes sense when the *whole* session is excluded. Derived from the completed
  // entries, not read from `active` (which no longer carries the flag). A mixed session omits
  // it — that case is new territory only the per-entry `noProg` readers handle.
  const allNoProg = entries.length > 0 && entries.every(e => e.noProg === true)

  return {
    id: active.id,
    d: active.d,
    start: active.start,
    end,
    routineIds,
    routineId: routineIds[0] ?? null,
    name: active.name,
    bw: active.bw,
    ...(isInterval ? {
      type: 'interval',
      interval: {
        rounds: active.interval.rounds,
        workSec: active.interval.workSec,
        restSec: active.interval.restSec,
      },
    } : {}),
    entries,
prs,
    ...(allNoProg ? { excludeFromProgression: true } : {}),
    ...(sessionNote ? { note: sessionNote } : {}),
  }
}
