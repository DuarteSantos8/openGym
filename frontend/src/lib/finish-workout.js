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

// A session left open and finished hours later (the phone went back in the bag, Finish was
// tapped the next morning) used to be stored with that tap as its end: a 50-minute workout
// read as 30 hours in History and Stats. Sets are stamped with `at` when ticked, so the end is
// the last tick of the unbroken run of work — a gap longer than FORGOTTEN_GAP_MS means the
// session was over, and ticks after it (catching up the log later) stay logged but do not
// stretch the clock. Finishing within the gap keeps the tap, cool-down included. Sessions from
// builds that did not stamp sets keep the old behaviour.
export const FORGOTTEN_GAP_MS = 20 * 60 * 1000

// How long a ticked row itself took: a cardio row its minutes, a hold its seconds (both sides of
// a per-side hold). A 30-minute treadmill finisher ticked at its end follows the last lift by
// more than the gap without the session being over, so that time is not counted as a break.
function rowLengthMs(set) {
  const n = v => (Number(v) > 0 ? Number(v) : 0)
  if (isSideSet(set)) return (n(set.sides.L?.sec) + n(set.sides.R?.sec)) * 1000
  return n(set.min) * 60000 + n(set.sec) * 1000
}

export function sessionEnd(active, now = Date.now(), gap = FORGOTTEN_GAP_MS) {
  const ticks = (active?.entries || [])
    .flatMap(e => e.sets || [])
    .filter(s => hasCompletedWork(s) && Number.isFinite(s.at))
    .map(s => ({ at: s.at, len: rowLengthMs(s) }))
    .sort((a, b) => a.at - b.at)
  if (!ticks.length) return now
  // A row may have been ticked when it was done or when it was started (a treadmill row ticked,
  // then run for 30 minutes before Finish, QA 10-06), so the session reaches to the later of the
  // two: its tick plus its own length. That reach, not the bare tick, is what the next tick and
  // the Finish tap are measured against, and where a forgotten session ends.
  let reach = ticks[0].at + ticks[0].len
  for (const { at, len } of ticks.slice(1)) {
    if (at - len - reach > gap) break
    reach = Math.max(reach, at + len)
  }
  return now - reach > gap ? reach : now
}

export function buildCompletedWorkout(active, { end = Date.now(), prs = [], snapshotFor } = {}) {
  const entries = (active?.entries || []).map(entry => {
    const completed = {
      id: entry.id,
      ...(entry.occurrenceId ? { occurrenceId: entry.occurrenceId } : {}),
      ...(entry.unit ? { unit: entry.unit } : {}),
      // Only what was logged — the live-session bookkeeping on a row stays behind (finishedRow).
      sets: (entry.sets || []).map(finishedRow),
      topW: bestWeightForEntry(entry) || null,
      target: entry.target || null,
      // Which routine this entry came from, and whether it counts for progression. Written
      // only when set/true, so a single-routine non-excluded session is byte-for-byte the
      // shape it always was. Without this the whitelist drops both at finish.
      ...(entry.rid ? { rid: entry.rid } : {}),
      ...(entry.noProg === true ? { noProg: true } : {}),
      // What the routine asked for when the session was built (session-start.js), next to the
      // target the prescription moved — how the next session tells an edited plan (#275).
      ...(entry.planned ? { planned: entry.planned } : {}),
      // The superset the exercise was done in, so the history can show the pairing. Without it
      // the workout forgot at finish what it had been all session.
      ...(entry.sg ? { sg: entry.sg } : {}),
    }
    const snapshot = typeof snapshotFor === 'function' ? snapshotFor(entry) : null
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && Object.keys(snapshot).length) {
      completed.muscleSnapshot = { ...snapshot }
    }
    // What you typed about this exercise today, and whether you asked to see it again next
    // time. Written only when there is something to keep, so an untouched entry is byte-for-byte
    // the shape it always was.
    const note = (entry.note || '').trim()
    if (note) {
      completed.note = note
      if (entry.notePin) completed.notePin = true
    }
    return completed
  }).filter(entry => entry.sets.some(hasCompletedWork))
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
    ...(active.unit ? { unit: active.unit } : {}),
    d: active.d,
    start: active.start,
    end,
    routineIds,
    routineId: routineIds[0] ?? null,
    name: active.name,
    bw: active.bw,
    entries,
    prs,
    ...(active.programmeInstance || active.programmeInstanceId || active.cycleId ? { complete: !!active.entries?.length && active.entries.every(entry => entry.sets.length > 0 && entry.sets.every(hasCompletedWork)) } : {}),
    ...(active.programmeId ? { programmeId: active.programmeId } : {}),
    ...(active.cycleId ? { cycleId: active.cycleId } : {}),
    ...(active.programmeInstanceId ? { programmeInstanceId: active.programmeInstanceId } : {}),
    ...(active.programmeInstance ? { programmeInstance: { ...active.programmeInstance } } : {}),
    ...(allNoProg ? { excludeFromProgression: true } : {}),
    ...(sessionNote ? { note: sessionNote } : {}),
  }
}
