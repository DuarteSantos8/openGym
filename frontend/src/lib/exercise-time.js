// How long each exercise of a workout took, from the times its sets were ticked (`at`, stamped
// for the session's end, lib/finish-workout.js). The time up to each tick goes to that set's
// exercise: from the workout's start to the first tick, then from tick to tick, whatever exercise
// came before. So the rest before a set and the setup count, a superset's exercises share its
// time as they were done, and the exercises add up to the workout up to its last set.
// A timed row (a hold, cardio) counts at least its own length, as it may have been ticked when it
// began. A pause longer than the forgotten-session gap is a break, not the next exercise's; a tick
// before the start or long past the end (the log caught up later, a workout logged into the past)
// is left out. A workout with no tick times (imported, or logged before they were kept) has none.
import { FORGOTTEN_GAP_MS } from './finish-workout.js'
import { hasCompletedWork, isSideSet } from './workout-model.js'

// A ticked row's own length, as sessionEnd reads it.
function rowLengthMs(set) {
  const n = v => (Number(v) > 0 ? Number(v) : 0)
  if (isSideSet(set)) return (n(set.sides.L?.sec) + n(set.sides.R?.sec)) * 1000
  return n(set.min) * 60000 + n(set.sec) * 1000
}

/** Each entry's time in ms, by its index (`undefined` for an entry with none); [] when none has. */
export function entryTimes(w, gap = FORGOTTEN_GAP_MS) {
  const start = Number(w?.start)
  if (!Number.isFinite(start) || !Array.isArray(w?.entries)) return []
  const end = Number(w.end)
  const last = Number.isFinite(end) ? end + gap : Infinity
  const ticks = []
  w.entries.forEach((e, idx) => (e?.sets || []).forEach(s => {
    if (hasCompletedWork(s) && Number.isFinite(s.at) && s.at >= start && s.at <= last) ticks.push({ idx, at: s.at, len: rowLengthMs(s) })
  }))
  ticks.sort((a, b) => a.at - b.at)
  const out = []
  let prev = start
  for (const { idx, at, len } of ticks) {
    let step
    if (at - len - prev > gap) { step = len; prev = Math.max(at, prev + len) } else {
      const reach = Math.max(at, prev + len)
      step = reach - prev
      prev = reach
    }
    out[idx] = (out[idx] || 0) + step
  }
  return out
}

/**
 * Each exercise's time over the workouts started at or after `since` (ms, 0 for all), one
 * session per workout (an exercise done twice in one workout counts once, its times added):
 * `[{ id, sessions, total, avg }]`, the longest average first.
 */
export function exerciseTimeRows(workouts, since = 0) {
  const by = new Map()
  for (const w of workouts || []) {
    if (since && !(Number(w?.start) >= since)) continue
    const times = entryTimes(w)
    const seen = new Set()
    times.forEach((ms, i) => {
      if (!(ms > 0)) return
      const id = w.entries[i].id
      const row = by.get(id) || by.set(id, { id, sessions: 0, total: 0 }).get(id)
      if (!seen.has(id)) { seen.add(id); row.sessions++ }
      row.total += ms
    })
  }
  return [...by.values()].map(r => ({ ...r, avg: r.total / r.sessions }))
    .sort((a, b) => b.avg - a.avg || String(a.id).localeCompare(String(b.id)))
}
