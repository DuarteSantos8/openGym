// The count-up clock on a cardio set (issue #131): ▶ on the row starts it, ■ stops it and writes
// the minutes into the row's `min`. What it decides lives here; store/useCardioClock.js runs it.
// The run is { wid, idx, i, id, startedAt }: the workout, the entry (by place and exercise id)
// and the set it times, and when it started. Rows have no id, so the place is what points at one.
import { fmtClock } from './circuit-copy.js'
import { pauseSpans, pausedBetween } from './workout-pause.js'

/** Whole seconds since `startedAt`, never below 0 (a clock set back while it ran). */
export function elapsedSec(startedAt, now = Date.now()) {
  const ms = Number(now) - Number(startedAt)
  return ms > 0 ? Math.floor(ms / 1000) : 0
}

/** The minutes a run of `sec` seconds writes: the nearest whole minute, 30 s and up making 1.
 *  Under 30 s it writes nothing (null): a ▶ tapped by mistake keeps the minutes the row had. */
export function minutesFor(sec) {
  const n = Math.max(0, Number(sec) || 0)
  return n < 30 ? null : Math.max(1, Math.round(n / 60))
}

/** The seconds `run` has timed at `now`, leaving out the time its workout stood paused (#976).
 *  The workout keeps its pauses itself (lib/workout-pause.js), so a pause from the watch, the
 *  Lock Screen or before a reload counts the same as one from this phone. */
export function runSec(run, active, now = Date.now()) {
  const from = Number(run?.startedAt)
  const paused = pausedBetween(pauseSpans(active, now), from, now)
  return elapsedSec(from + paused, now)
}

/** What the min cell shows while the clock runs: 0:42, 12:05, 1:02:09. */
export const clockLabel = sec => fmtClock(sec)

/** A stored run as it was saved, or null for anything that is not one. */
export function parseRun(raw) {
  let v = raw
  if (typeof raw === 'string') { try { v = JSON.parse(raw) } catch { return null } }
  if (!v || typeof v !== 'object') return null
  const { wid, idx, i, id, startedAt } = v
  if (wid == null || id == null || !Number.isInteger(idx) || idx < 0 || !Number.isInteger(i) || i < 0) return null
  if (!(Number(startedAt) > 0)) return null
  return { wid, idx, i, id, startedAt: Number(startedAt) }
}

/** Where `run`'s set is in the running workout now, as { idx, i }, or null when it is not there:
 *  another workout (a slot left from an earlier one), its exercise or set gone, or the set ticked.
 *  An exercise moved in the list is found by its id while that id is on one entry only. */
export function runAt(active, run) {
  if (!active || !run || active.id !== run.wid || !Array.isArray(active.entries)) return null
  let idx = active.entries[run.idx]?.id === run.id ? run.idx : -1
  if (idx < 0) {
    const same = active.entries.flatMap((e, k) => (e?.id === run.id ? [k] : []))
    if (same.length === 1) idx = same[0]
  }
  const set = idx >= 0 ? active.entries[idx].sets?.[run.i] : null
  return set && !set.done ? { idx, i: run.i } : null
}
