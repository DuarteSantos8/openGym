// The persisted boundary for a finished session. Keep this pure so compatibility tests can
// exercise the exact shape the UI writes without mounting React or mutating store state.
import { stopAt, pauseSpans, pausedBetween } from './workout-pause.js'
import { bestWeightForEntry, bestWeightFor, cleanupSg } from './history.js'
import { hasCompletedWork, isSideSet, isWarmupRow } from './workout-model.js'
import { beatsWeight, betterWeight } from './exercises.js'
import { is1RMRecord } from './onerm.js'
import { entryDbLoad } from './dumbbells.js'
import { cleanBrand } from './gym-split.js'

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
  // A set's own rest (#609) was for this session only, so it isn't kept with the workout.
  if (set.planSec == null && set.weightOrigin == null && set.restSec === undefined && !sideMarked) return set
  const { planSec, weightOrigin, restSec: _ownRest, ...rest } = set
  if (sideMarked) {
    const side = ({ weightOrigin: _, ...kept }) => kept
    rest.sides = { ...rest.sides, L: side(rest.sides.L), R: side(rest.sides.R) }
  }
  return planSec == null || rest.done ? rest : { ...rest, sec: planSec }
}

// A session left open and finished hours later (the phone went back in the bag, Finish was
// tapped the next morning) used to be stored with that tap as its end: a 50-minute workout
// read as 30 hours in History and Stats. Sets are stamped with `at` when ticked, so the end is
// the last tick of the session's work, and Finish tapped more than FORGOTTEN_GAP_MS after it
// means the session was over. Finishing within the gap keeps the tap, cool-down included.
// Sessions from builds that did not stamp sets keep the old behaviour.
//
// A break longer than the gap in the middle is not the end, though (#1021): 25 minutes on an
// unlogged bike, a long chat, a queue for the rack, and then more sets. That used to cut the
// session at the first break, so a 107-minute workout was saved as 7 minutes. Work after a break
// still counts, unless it is the log being caught up later: a break longer than LONG_BREAK_MS
// (the leftover set ticked at home the next morning), or ticks that came in one burst, seconds
// apart (catching up a few sets in a row after the workout, not sets with rests between them).
// Those stay logged but do not stretch the clock. Time paused on purpose (#976,
// lib/workout-pause.js) is never a break.
export const FORGOTTEN_GAP_MS = 20 * 60 * 1000
export const LONG_BREAK_MS = 2 * 60 * 60 * 1000
const BURST_MS = 20 * 1000

// How long a ticked row itself took: a cardio row its minutes, a hold its seconds (both sides of
// a per-side hold). A 30-minute treadmill finisher ticked at its end follows the last lift by
// more than the gap without the session being over, so that time is not counted as a break.
function rowLengthMs(set) {
  const n = v => (Number(v) > 0 ? Number(v) : 0)
  if (isSideSet(set)) return (n(set.sides.L?.sec) + n(set.sides.R?.sec)) * 1000
  return n(set.min) * 60000 + n(set.sec) * 1000
}

// A run after a break that is only the log catching up: two or more ticks, each within seconds
// of the one before.
const isBurst = run => run.ticks.length > 1 && run.ticks.every((t, i) => i === 0 || t.at - run.ticks[i - 1].at < BURST_MS)

export function sessionEnd(active, now = Date.now(), gap = FORGOTTEN_GAP_MS) {
  const ticks = (active?.entries || [])
    .flatMap(e => e.sets || [])
    .filter(s => hasCompletedWork(s) && Number.isFinite(s.at))
    .map(s => ({ at: s.at, len: rowLengthMs(s) }))
    .sort((a, b) => a.at - b.at)
  if (!ticks.length) return now
  const spans = pauseSpans(active, now)
  const breakMs = (from, to) => to - from - pausedBetween(spans, from, to)
  // A row may have been ticked when it was done or when it was started (a treadmill row ticked,
  // then run for 30 minutes before Finish, QA 10-06), so the session reaches to the later of the
  // two: its tick plus its own length. That reach, not the bare tick, is what the next tick and
  // the Finish tap are measured against, and where a forgotten session ends.
  const runs = []
  for (const t of ticks) {
    const last = runs[runs.length - 1]
    const pause = last ? breakMs(last.reach, t.at - t.len) : 0
    if (!last || pause > gap) runs.push({ ticks: [t], reach: t.at + t.len, breakBefore: pause })
    else { last.ticks.push(t); last.reach = Math.max(last.reach, t.at + t.len) }
  }
  let reach = runs[0].reach
  for (const run of runs.slice(1)) {
    if (run.breakBefore > LONG_BREAK_MS || isBurst(run)) break
    reach = run.reach
  }
  return breakMs(reach, now) > gap ? reach : now
}

// The records a finished session set, one decision for the finish summary, the saved workout's
// `prs` and the live trophy on a set (lib/set-records.js): a load PR is a load that beats every
// load in the history before it (on an assistance machine, less help), read the way this session
// logs a dumbbell weight (lib/dumbbells.js). Kept here so the live mark and the summary can never
// disagree about what counts.
export const isWeightPr = (H, exId, w, as = 'as') => beatsWeight(exId, Number(w) || 0, bestWeightFor(H, exId, as))

// `prs`: the exercises whose top load is a PR. `e1prs`: a heavier estimate without a heavier top
// set (same weight, more reps), reported apart so it can't be read as a load PR.
export function sessionPrs(H, entries, { formula } = {}) {
  const prs = []
  const e1prs = []
  ;(entries || []).forEach(e => {
    const loads = (e.sets || []).filter(s => s.done && !isWarmupRow(s)).map(s => s.w).filter(w => w > 0)
    const mx = loads.length ? loads.reduce((a, b) => betterWeight(e.id, a, b)) : 0
    if (isWeightPr(H, e.id, mx, entryDbLoad(e))) prs.push(e.id)
    const rec = formula ? is1RMRecord(H, e.id, e, formula) : is1RMRecord(H, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  return { prs, e1prs }
}

// `brandFor(exId)`: the machine brand an exercise kept per gym was done on (#988, lib/gym-split.js),
// for an entry that does not carry one yet.
export function buildCompletedWorkout(active, { end = Date.now(), prs = [], snapshotFor, brandFor } = {}) {
  const entries = (active?.entries || []).map(entry => {
    const completed = {
      id: entry.id,
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
    // Which machine brand it was done on, for an exercise kept per gym (#988): what tells the
    // next session at another gym with the same brand that these numbers are its numbers too.
    const brand = cleanBrand(entry.brand) || (typeof brandFor === 'function' ? cleanBrand(brandFor(entry.id)) : '')
    if (brand) completed.brand = brand
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
    d: active.d,
    start: active.start,
    // Finished while paused (#976): it ended at the pause, not while it sat waiting.
    end: stopAt(active, end),
    routineIds,
    routineId: routineIds[0] ?? null,
    name: active.name,
    bw: active.bw,
    entries,
    prs,
    ...(allNoProg ? { excludeFromProgression: true } : {}),
    ...(sessionNote ? { note: sessionNote } : {}),
    // Circuits, AMRAPs, EMOMs and intervals run on the clock (lib/circuit.js runResult): rounds,
    // the AMRAP score, the round times, so the history can show them and the next run compare.
    ...(Array.isArray(active.circuits) && active.circuits.length ? { circuits: active.circuits.map(c => ({ ...c })) } : {}),
    // The gym it was done at (#808, lib/gym-inventory.js): { id, name }, so editing it later loads
    // that gym's plates and the history can say where. Only when there are gyms.
    ...(active.gym && typeof active.gym === 'object' && active.gym.id != null ? { gym: { id: active.gym.id, name: String(active.gym.name || '') } } : {}),
  }
}
