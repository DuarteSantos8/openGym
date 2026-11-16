import { hasCompletedWork, isSideSet, isWarmupRow } from './workout-model.js'
import { pauseSpans, pausedBetween } from './workout-pause.js'
import { bestWeightFor } from './history.js'
import { beatsWeight, betterWeight } from './exercises.js'
import { is1RMRecord } from './onerm.js'
import { entryDbLoad } from './dumbbells.js'

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
    // The estimate reads an exposure's rows: the entry's done work sets, each side its own.
    const rows = (e.sets || []).filter(x => x.done && !isWarmupRow(x)).flatMap(x => (isSideSet(x) ? [x.sides.L, x.sides.R] : [x]))
    const view = { exerciseId: e.id, ...(typeof e.target?.assisted === 'boolean' ? { assisted: e.target.assisted } : {}), ...(e.target?.dbLoad ? { dbLoad: e.target.dbLoad } : {}),
      performance: { sets: rows.map(x => ({ status: 'completed', role: 'work', observations: [{ metric: 'repetitions', value: x.r }], resistance: { kind: 'external-load', value: x.w }, rir: x.rir ?? null })) } }
    const rec = formula ? is1RMRecord(H, e.id, view, formula) : is1RMRecord(H, e.id, view)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  return { prs, e1prs }
}
