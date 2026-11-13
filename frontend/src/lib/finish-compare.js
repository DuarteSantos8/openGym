// The finish summary's "last time / next time" (#324): one line per lift, today against the
// previous session of the same exercise, and what the next session will open at. "Next" has no
// rule of its own: it is buildPlannedEntry, the same call Start makes, run on the state right
// after this workout was saved, so the summary cannot promise a number the next session won't.
import { isWarmupRow, isFailureSet } from './workout-model.js'
import { buildPlannedEntry } from './session-start.js'
import { workoutAt, modeOf } from './history.js'
import { setBandsOf } from './bands.js'

const workSets = entry => (Array.isArray(entry?.sets) ? entry.sets : [])
  .filter(s => s && s.done && !isWarmupRow(s) && Number(s.r) > 0)
  // `f`: taken to failure, so the summary can mark it; written only when true.
  // `bands`: the colours of a band set, so "Today" says "12 × Red" as History does (QA 1.4.5).
  .map(s => ({ w: Number(s.w) || 0, r: Math.round(Number(s.r)), ...(isFailureSet(s) ? { f: true } : {}), ...(setBandsOf(s).length ? { bands: setBandsOf(s) } : {}) }))

// The timed holds of an entry (a plank, a dead hang): done, not a warm-up, a time and no reps.
// `side`: a per-side hold is one row per side (buildWorkSets), so the summary can say which.
const holdSets = entry => (Array.isArray(entry?.sets) ? entry.sets : [])
  .filter(s => s && s.done && !isWarmupRow(s) && Number(s.sec) > 0 && !(Number(s.r) > 0))
  .map(s => ({ sec: Math.round(Number(s.sec)), w: Number(s.w) || 0, ...(s.side === 'L' || s.side === 'R' ? { side: s.side } : {}), ...(isFailureSet(s) ? { f: true } : {}) }))

const secs = sets => sets.reduce((n, s) => n + s.sec, 0)
/** -1, 0 or 1 for holds: by the heaviest added weight first, then by the time held in total. */
export function holdTrendOf(today, last) {
  if (!last?.length) return null
  const dw = top(today) - top(last)
  if (Math.abs(dw) > 1e-9) return dw > 0 ? 1 : -1
  const ds = secs(today) - secs(last)
  return ds ? Math.sign(ds) : 0
}

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

/**
 * Rows for the summary of `w`, read from `st` (which already holds `w`). Cardio is left out (it
 * has its own block, finishCardio).
 * A timed hold is a row like a lift: `holds` today, `lastHolds`, and `nextHold` { sec, w, kind,
 * side } where the routine's progression has one. An exercise that was done both ways in one
 * session (reps, then switched to time) carries both `today` and `holds` in its one row.
 */
export function finishCompare(st, w) {
  const workouts = (st?.workouts || []).filter(x => x && x !== w && x.id !== w?.id && workoutAt(x) < workoutAt(w))
  const rows = []
  const seen = new Set()
  for (const entry of w?.entries || []) {
    if (!entry?.id || seen.has(entry.id)) continue
    const mode = modeOf(entry.target || entry)
    if (mode !== 'reps' && mode !== 'time') continue
    const today = workSets(entry)
    const holds = holdSets(entry)
    if (!today.length && !holds.length) continue
    seen.add(entry.id)
    let last = null, lastHolds = null
    for (let i = workouts.length - 1; i >= 0 && ((today.length && !last) || (holds.length && !lastHolds)); i--) {
      const prev = (workouts[i].entries || []).find(e => e?.id === entry.id)
      if (!prev) continue
      if (today.length && !last) { const sets = workSets(prev); if (sets.length) last = sets }
      if (holds.length && !lastHolds) { const sets = holdSets(prev); if (sets.length) lastHolds = sets }
    }
    let next = null, nextHold = null
    const routine = entry.rid ? (st.routines || []).find(r => r.id === entry.rid) : null
    const cfg = routine && !routine.excludeFromProgression && !entry.noProg && !w.noProg
      ? (routine.ex || []).find(c => c?.id === entry.id) : null
    if (cfg && modeOf(cfg) === 'time') {
      // What Start will put in the first hold's row, and whether the plan moved it.
      try {
        const built = buildPlannedEntry(st, cfg, routine)
        const first = (Array.isArray(built.sets) ? built.sets : []).find(s => s && !isWarmupRow(s))
        const sec = Math.round(Number(first?.sec ?? built.target?.sec)) || 0
        if (sec > 0 && holds.length) {
          const was = Math.round(Number(entry.target?.sec)) || holds.reduce((m, s) => Math.max(m, s.sec), 0)
          const nw = Number(first?.w ?? built.target?.weight) || 0
          const kind = built.plan?.kind === 'deload' ? 'deload'
            : nw > top(holds) + 1e-9 ? 'up' : nw < top(holds) - 1e-9 ? 'down'
              : sec > was ? 'up' : sec < was ? 'shorter' : 'hold'
          nextHold = { sec, w: nw > 0 ? nw : null, kind, ...(first?.side ? { side: true } : {}) }
        }
      } catch { /* a routine the builder cannot read keeps its row without a "next" */ }
    } else if (cfg && today.length) {
      try {
        const built = buildPlannedEntry(st, cfg, routine)
        let nw = built.target?.weight, nr = built.target?.reps
        // No progression (switched off, or pyramid sets, which never progress): the target's
        // weight says nothing (a pyramid keeps it at 0, its weights are per set), so the next
        // session is read off the rows Start will build, by their heaviest set, the same
        // reference set the trend uses. Nothing to open at (no weight anywhere) says nothing,
        // rather than "0 kg, lighter" for every lift (TestFlight 11-04).
        if (built.plan?.kind === 'off') {
          const rows = (Array.isArray(built.sets) ? built.sets : []).filter(s => s && !isWarmupRow(s))
          const ref = rows.reduce((m, s) => (!m || (Number(s.w) || 0) > (Number(m.w) || 0) ? s : m), null)
          const rw = Number(ref?.w) || 0, rr = Math.round(Number(ref?.r)) || 0
          nw = rw > 0 ? rw : null
          nr = rr > 0 ? rr : null
          if (nw == null && top(today) > 0) nr = null
        }
        // Nothing on the bar today and nothing next time (a dip, a band curl): no "0 kg" either,
        // the way the Today line leaves it out (night QA 146).
        if (nw === 0 && top(today) === 0) nw = null
        // A band lift says which bands it opens with; going to a heavier one is the step up.
        const firstWork = (Array.isArray(built.sets) ? built.sets : []).find(s => s && !isWarmupRow(s))
        const nb = firstWork ? setBandsOf(firstWork) : []
        const todayBands = (entry.sets || []).filter(s => s && s.done && !isWarmupRow(s)).map(setBandsOf).filter(b => b.length).at(-1) || []
        const bandUp = nb.length > 0 && todayBands.length > 0 && nb.join('+') !== todayBands.join('+')
        if (nw != null || nr != null) {
          const topR = today.reduce((m, s) => Math.max(m, s.r), 0)
          const kind = built.plan?.kind === 'deload' ? 'deload'
            : bandUp ? 'up'
              : nw != null && nw > top(today) + 1e-9 ? 'up'
                : nw != null && nw < top(today) - 1e-9 ? 'down'
                  : nw == null && nr != null && nr > topR ? 'up'
                    : nw == null && nr != null && nr < topR ? 'down' : 'hold'
          next = { w: nw ?? null, r: nr ?? null, sets: built.target?.sets ?? null, kind, ...(nb.length ? { bands: nb } : {}) }
        }
      } catch { /* a routine the builder cannot read keeps its row without a "next" */ }
    }
    // Lifted and held in one session: the lift decides the arrow where it has a last time.
    const trend = today.length && (last || !holds.length) ? trendOf(today, last) : holdTrendOf(holds, lastHolds)
    rows.push({ id: entry.id, today, last, trend, next, ...(holds.length ? { holds, lastHolds, nextHold } : {}) })
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
