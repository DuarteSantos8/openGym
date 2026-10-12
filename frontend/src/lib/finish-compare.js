// The finish summary's "last time / next time" (#324): one line per lift, today against the
// previous session of the same exercise, and what the next session will open at. "Next" has no
// rule of its own: it is buildPlannedEntry, the same call Start makes, run on the state right
// after this workout was saved, so the summary cannot promise a number the next session won't.
import { isWarmupRow, isFailureSet } from './workout-model.js'
import { buildPlannedEntry } from './session-start.js'
import { workoutAt, modeOf } from './history.js'

const workSets = entry => (Array.isArray(entry?.sets) ? entry.sets : [])
  .filter(s => s && s.done && !isWarmupRow(s) && Number(s.r) > 0)
  // `f`: taken to failure, so the summary can mark it; written only when true.
  .map(s => ({ w: Number(s.w) || 0, r: Math.round(Number(s.r)), ...(isFailureSet(s) ? { f: true } : {}) }))

const top = sets => sets.reduce((m, s) => Math.max(m, s.w), 0)
const reps = sets => sets.reduce((n, s) => n + s.r, 0)

/** -1, 0 or 1: today against last time, by the heaviest set first, then by total reps. */
export function trendOf(today, last) {
  if (!last?.length) return null
  const dw = top(today) - top(last)
  if (Math.abs(dw) > 1e-9) return dw > 0 ? 1 : -1
  const dr = reps(today) - reps(last)
  return dr ? Math.sign(dr) : 0
}

/** Rows for the summary of `w`, read from `st` (which already holds `w`). Cardio and timed sets are left out. */
export function finishCompare(st, w) {
  const workouts = (st?.workouts || []).filter(x => x && x !== w && x.id !== w?.id && workoutAt(x) < workoutAt(w))
  const rows = []
  const seen = new Set()
  for (const entry of w?.entries || []) {
    if (!entry?.id || seen.has(entry.id)) continue
    const mode = modeOf(entry.target || entry)
    if (mode !== 'reps') continue
    const today = workSets(entry)
    if (!today.length) continue
    seen.add(entry.id)
    let last = null
    for (let i = workouts.length - 1; i >= 0 && !last; i--) {
      const prev = (workouts[i].entries || []).find(e => e?.id === entry.id)
      const sets = prev ? workSets(prev) : []
      if (sets.length) last = sets
    }
    let next = null
    const routine = entry.rid ? (st.routines || []).find(r => r.id === entry.rid) : null
    const cfg = routine && !routine.excludeFromProgression && !entry.noProg && !w.noProg
      ? (routine.ex || []).find(c => c?.id === entry.id) : null
    if (cfg) {
      try {
        const built = buildPlannedEntry(st, cfg, routine)
        const nw = built.target?.weight, nr = built.target?.reps
        if (nw != null || nr != null) {
          const kind = built.plan?.kind === 'deload' ? 'deload'
            : nw != null && nw > top(today) + 1e-9 ? 'up'
              : nw != null && nw < top(today) - 1e-9 ? 'down' : 'hold'
          next = { w: nw ?? null, r: nr ?? null, sets: built.target?.sets ?? null, kind }
        }
      } catch { /* a routine the builder cannot read keeps its row without a "next" */ }
    }
    rows.push({ id: entry.id, today, last, trend: trendOf(today, last), next })
  }
  return rows
}

/**
 * The cardio of `w` for the finish summary, which the rows above leave out: one row per cardio
 * exercise with the sets that were done, warm-ups included (a walk to warm up is still a walk).
 * The summary prints them with setLabel, so a treadmill's speed and incline read as logged.
 */
export function finishCardio(w) {
  const rows = []
  for (const entry of w?.entries || []) {
    if (!entry?.id || modeOf({ ...(entry.target || {}), id: entry.id }) !== 'cardio') continue
    const sets = (Array.isArray(entry.sets) ? entry.sets : []).filter(s => s && s.done && (Number(s.min) > 0 || Number(s.speed) > 0))
    if (sets.length) rows.push({ id: entry.id, target: entry.target, sets })
  }
  return rows
}
