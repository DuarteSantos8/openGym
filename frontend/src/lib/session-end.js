import { hasCompletedWork, isSideSet } from './workout-model.js'

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
