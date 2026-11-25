// Personal records of a workout, by the rules of Wear OS and the Apple Watch (SessionCore.record / beatsBest,
// MedalTest.kt): one line per exercise that beat its `best` (the best set before this workout, which the phone
// sends with each exercise: {w, r}, or {sec, w} for a hold). Pure, ES5 subset, no Huawei API.
//
//   recordOf(entry, unit) -> [name, kind, old, new, unit] | null
//       kind 'w' (a heavier weight than the best, a lighter one when the exercise is assisted: the heaviest/lightest
//       such), else 'r' (more reps at the best's weight), 'h' (a longer hold). Only done work sets count (warm-ups
//       never); a per-side row counts by its aggregate (the heavier side's weight, the reps of both sides), which is how
//       the phone builds `best` too (lib/exercise-history.js bestSetFor reads the stored row). No `best`, a best of 0, or
//       cardio: null. `unit` is the exercise's own unit when it has one, else the workout's.
//   foldRecords(rc, w)  rc[String(entry.i)] = the line, for every exercise of workout `w` that has a `best`;
//       an exercise without one keeps what was folded before (the phone may have cut `best` for size), an exercise
//       that has one and no longer beats it loses its line (the set was unticked while it was in view).
//   recordList(rc) -> the lines in workout order
// Why a collector at all: the watch may hold only part of the workout, and records need every exercise. The core
// folds the window it has before each snapshot replaces it (core.js `s.rc`, saved), so the summary is whole.

const isNum = v => typeof v === 'number' && isFinite(v)
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arrOf = v => (Array.isArray(v) ? v : [])
const nz = v => (isNum(v) ? v : 0)

export function recordOf (e, unit) {
  const best = dictOf(e.best)
  if (!best || e.mode === 'cardio') return null
  const rows = arrOf(e.sets).filter(r => dictOf(r) && !(r.warmup === true || r.warmup === 1) && (r.done === true || r.done === 1))
  const u = typeof e.unit === 'string' ? e.unit : unit
  const name = typeof e.name === 'string' ? e.name : ''
  if (e.mode === 'time') {
    const b = nz(best.sec)
    let top = 0
    rows.forEach(r => { if (nz(r.sec) > top) top = nz(r.sec) })
    return b > 0 && top > b ? [name, 'h', b, top, u] : null
  }
  const bw = isNum(best.w) ? best.w : null
  const br = isNum(best.r) ? best.r : null
  if (bw == null || br == null || (bw <= 0 && br <= 0)) return null
  const assisted = e.assisted === true || e.assisted === 1
  let past = null // the heaviest weight past the best (the lightest when assisted)
  let reps = null // else the most reps at the best weight
  rows.forEach(r => {
    const w = nz(r.w)
    const x = nz(r.r)
    if (w !== bw) {
      if (w > 0 && (assisted ? w < bw : w > bw) && (past == null || (assisted ? w < past : w > past))) past = w
    } else if (x > br && (reps == null || x > reps)) reps = x
  })
  if (past != null) return [name, 'w', bw, past, u]
  return reps != null ? [name, 'r', br, reps, u] : null
}

export function foldRecords (rc, w) {
  const unit = typeof w.unit === 'string' ? w.unit : 'kg'
  arrOf(w.entries).forEach((e, idx) => {
    if (!dictOf(e) || !dictOf(e.best)) return
    const k = String(isNum(e.i) ? Math.floor(e.i) : idx)
    const r = recordOf(e, unit)
    if (r) rc[k] = r
    else delete rc[k]
  })
}

export function recordList (rc) {
  return Object.keys(rc).sort((a, b) => a - b).map(k => rc[k])
}
