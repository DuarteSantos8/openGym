// Pyramid sets (CONTEXT.md): one rep target per set, in order — a number, or PYRAMID_MAX for
// "as many reps as you can". No load is prescribed and the exercise is never progressed.
// Imports nothing from history.js, which imports this module.
import { t } from './i18n-core.js'
import { isWarmupRow } from './workout-model.js'

export const PYRAMID_MAX = 'max'
export const MAX_PYRAMID_SETS = 10

// One tap in the editor replaces the list with one of these.
export const PYRAMID_PRESETS = [
  [12, 10, 8, 6],
  [6, 8, 10, 12],
  [12, 10, 8, 10, 12],
  [12, 8, 6, PYRAMID_MAX, 12],
]

export function isPyramid(cfg) {
  return !!cfg && Array.isArray(cfg.pyramid) && cfg.pyramid.length > 0 && (cfg.mode || 'reps') === 'reps'
}

// What the editor and a hand-edited plan file can hold, kept to what the session can train:
// whole targets of at least one rep, "max", and no more than MAX_PYRAMID_SETS sets. `stride` 2
// is a per-side exercise: each target is rounded up to even, so it splits evenly between L and R.
export function normalizePyramid(list, stride = 1) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const v of list) {
    if (v === PYRAMID_MAX) out.push(PYRAMID_MAX)
    else if (v != null && v !== '' && Number.isFinite(Number(v))) {
      const n = Math.max(1, Math.round(Number(v)))
      out.push(Math.ceil(n / stride) * stride)
    }
  }
  return out.slice(0, MAX_PYRAMID_SETS)
}

// Turning the toggle on starts from the flat "sets × reps" already there.
export function pyramidFromFlat(cfg) {
  const n = Math.max(1, Math.min(MAX_PYRAMID_SETS, Math.round(cfg.sets) || 1))
  return Array(n).fill(cfg.reps || 10)
}

// Turning it off goes back to "sets × reps": the set count and the first numeric target.
export function flatFromPyramid(list) {
  const first = list.find(v => typeof v === 'number')
  return { sets: list.length, reps: first || 10 }
}

/** "12 · 8 · 6 · Max · 12" */
export function pyramidLabel(list) {
  return list.map(v => (v === PYRAMID_MAX ? t('Max') : String(v))).join(' · ')
}

// An extra set added mid-session copies the last target.
export function pyramidTargetAt(list, i) {
  return i < list.length ? list[i] : list[list.length - 1]
}

// Each set's own rest in seconds, beside the targets (`pyramidRest[i]` for `pyramid[i]`). 0 is
// "the exercise's rest". Sized to the list; all zeros is no field at all, so a pyramid that
// never set a rest stays the shape it was.
export function normalizePyramidRest(rest, length) {
  const src = Array.isArray(rest) ? rest : []
  const out = Array.from({ length }, (_, i) => Math.max(0, Math.round(Number(src[i])) || 0))
  return out.some(v => v > 0) ? out : []
}

/** The rest a ticked work row of a pyramid earns, or 0 to fall back to the exercise's rest.
 *  `i` indexes `rows`, warm-ups included; the pyramid counts work sets only. */
export function pyramidRestFor(target, rows, i) {
  if (!isPyramid(target) || !Array.isArray(target.pyramidRest) || !target.pyramidRest.length) return 0
  const row = rows?.[i]
  if (!row || isWarmupRow(row)) return 0
  const k = rows.slice(0, i).filter(r => !isWarmupRow(r)).length
  return Math.max(0, Number(pyramidTargetAt(target.pyramidRest, k)) || 0)
}

// ---- Max sets read back from history ----

// Every completed Max set of an exercise, oldest first: { w, r, d, t }.
function maxSetsOf(workouts, exId) {
  const out = []
  for (const w of workouts || []) {
    for (const en of w.entries || []) {
      if (en.id !== exId) continue
      for (const s of en.sets || []) {
        if (s.max && s.done && s.r > 0 && !isWarmupRow(s)) out.push({ w: Number(s.w) || 0, r: s.r, d: w.d, t: w.start })
      }
    }
  }
  return out
}

/** The record a Max set at weight `w` is up against: the most reps any Max set of this exercise
 *  did at `w` or heavier (more reps on less weight is not a record). Ties: heavier, then first. */
export function maxRecordAt(workouts, exId, w) {
  let best = null
  for (const s of maxSetsOf(workouts, exId)) {
    if (s.w < (Number(w) || 0)) continue
    if (!best || s.r > best.r || (s.r === best.r && s.w > best.w)) best = s
  }
  return best
}

/** Most reps in a Max set, per workout, for the Stats chart: [{ t, y, d, w }]. */
export function maxRepsSeries(workouts, exId) {
  const byWorkout = new Map()
  for (const s of maxSetsOf(workouts, exId)) {
    const key = s.t + '|' + s.d
    const cur = byWorkout.get(key)
    if (!cur || s.r > cur.y) byWorkout.set(key, { t: s.t, y: s.r, d: s.d, w: s.w })
  }
  return [...byWorkout.values()]
}
