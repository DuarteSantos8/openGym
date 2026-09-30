// v1's automatic deload (progression.js, issues #17 and #233) as pure arithmetic: where a stalled
// track backs off to. Counting the stall is advance.js's job and deciding to use it generate.js's;
// this file only answers "how far back". Loads snap to the rule's own rounding, so a deload lands
// on a number the athlete can load — the same grid every other automated load uses.
import { roundLoad } from './load.js'

export const DELOAD_FACTOR = 0.9
export const DELOAD_FACTOR_MIN = 0.5
export const DELOAD_FACTOR_MAX = 0.95
/** v1's stalls in a row before a deload, per policy (DELOAD_AFTER). */
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, hold_seconds: 3 }
/** A timed hold backs off on v1's 5-second grid. */
const HOLD_GRID = 5

export const isValidDeloadFactor = v => Number.isFinite(v) && v >= DELOAD_FACTOR_MIN && v <= DELOAD_FACTOR_MAX

/** The deload a preset starts with (v1 applied one to every progressing policy), or undefined. */
export const defaultDeload = preset => (DELOAD_AFTER[preset] ? { after: DELOAD_AFTER[preset], factor: DELOAD_FACTOR } : undefined)

const round1 = v => Math.round(v * 10) / 10
const snap = (v, step) => roundLoad(v, { mode: 'nearest', step })

/**
 * v1 deloadTo: back off by `factor` onto the rounding grid, always at least one step lower and
 * never below one step. A load that cannot go lower comes back unchanged.
 */
export function deloadLoad(current, factor, rounding) {
  const grid = rounding.mode === 'allowed_values'
  const lowest = grid ? rounding.allowedValues[0] : rounding.step
  let next = roundLoad(current * factor, rounding)
  if (next >= current) next = grid ? rounding.allowedValues.filter(v => v < current).at(-1) ?? current : roundLoad(current - rounding.step, rounding)
  next = Math.max(lowest, next)
  return next < current ? next : current
}

// Epley uses the reps performed by one side for unilateral work; callers pass the total reps and
// the split is made explicit here rather than letting a total inflate the estimate.
export function epley1RM(weight, reps) {
  const w = Number(weight)
  const r = Number(reps)
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return null
  const result = w * (1 + r / 30)
  return Number.isFinite(result) && result > 0 ? round1(result) : null
}
const target1RM = (weight, reps, factor, perSide) => {
  const base = epley1RM(weight, perSide ? Number(reps) / 2 : reps)
  return base == null ? null : round1(base * factor)
}

// v1 rep-range.js normalizeRepRange: the window a double-progression plan climbs, on a stride of
// two for unilateral work.
function repWindow(reps, repsMin, stride) {
  const step = Number.isInteger(stride) && stride > 0 ? stride : 1
  const positive = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback }
  const align = v => Math.max(step, Math.ceil(v / step) * step)
  const upper = align(positive(reps, 10))
  const lower = align(positive(repsMin, Math.max(1, upper - 2)))
  return lower >= upper ? { reps: lower + step, repsMin: lower } : { reps: upper, repsMin: lower }
}

const gridAround = (ideal, step, maxWeight, strictLower) => {
  if (!(ideal > 0) || !(step > 0) || !(maxWeight > 0)) return []
  const values = [...new Set([Math.floor(ideal / step) * step, Math.ceil(ideal / step) * step].map(v => snap(v, step)))]
  return values.filter(v => v > 0 && v <= maxWeight + 1e-9 && (!strictLower || v < maxWeight - 1e-9)).sort((a, b) => a - b)
}

/**
 * v1 selectDeloadCandidate: a bounded load/reps pair whose Epley estimate sits `factor` below the
 * stalled set's. Lexicographic on purpose — closest estimate, then fewer rep changes, then the
 * heavier load — so a tie on the grid is predictable. A double-progression window may keep the
 * current load and give up reps instead. Null when nothing fits.
 */
export function selectDeloadCandidate({ currentWeight, targetWeight, targetReps, step, factor, reps, repsMin, perSide = false }) {
  const current = Number(currentWeight)
  const baseReps = Number(targetReps)
  const stride = perSide ? 2 : 1
  const upper = Math.max(stride, Math.ceil(baseReps / stride) * stride)
  const window = repsMin == null ? null : repWindow(reps, repsMin, stride)
  const top = window ? Math.min(window.reps, Math.max(window.repsMin, upper)) : upper
  const bottom = window ? window.repsMin : top
  const repValues = []
  for (let r = top; r >= bottom; r -= stride) repValues.push(r)
  const goal = target1RM(Number(targetWeight), upper, factor, perSide)
  if (!(current > 0) || goal == null || !repValues.length || !(step > 0)) return null

  const candidates = []
  for (const reps of repValues) {
    const ideal = goal / (1 + (perSide ? reps / 2 : reps) / 30)
    const allowCurrent = window != null && reps < upper
    const grid = gridAround(ideal, step, current, !allowCurrent)
    if (allowCurrent && !grid.includes(current)) grid.push(current)
    for (const weight of grid) {
      const estimate = epley1RM(weight, perSide ? reps / 2 : reps)
      candidates.push({ weight, reps, error: Math.abs(estimate - goal), repChange: Math.abs(reps - upper) })
    }
  }
  // A tiny or below-step lift may have no lower grid point: holding the attempted load is safer
  // than rounding up to one step.
  if (!candidates.length) {
    for (const reps of repValues) {
      const estimate = epley1RM(current, perSide ? reps / 2 : reps)
      candidates.push({ weight: current, reps, error: Math.abs(estimate - goal), repChange: Math.abs(reps - upper) })
    }
  }
  candidates.sort((a, b) => a.error - b.error || a.repChange - b.repChange || b.weight - a.weight || b.reps - a.reps)
  return { weight: candidates[0].weight, reps: candidates[0].reps }
}

/**
 * Where a stalled loaded track backs off to. Linear and double progression on plain external load
 * use the Epley selection (v1 epleyDeload); everything else — Greyskull, rest-pause rows, a rounding
 * with no step — takes `factor` of the load. `lifted` is the lightest load actually done, and
 * bounds the result when it was below the prescription.
 *
 * An assistance machine backs off the other way (v1 `easier`): one step more help than the set
 * that stalled — the most help it needed, whichever of the plan and the log that was. Epley reads
 * load as the work done; there it is the work taken away, so the factor has no meaning.
 * @returns {{ value: number, reps: number|null, method: 'epley'|'factor'|'assist' }}
 */
export function deloadedLoad({ preset, rounding, factor, prescribed, lifted = null, reps = null, repsMin = null, perSide = false, restPause = false, assisted = false, step = null }) {
  if (assisted) {
    const needed = Math.max(prescribed, lifted ?? 0)
    const more = rounding.mode === 'allowed_values'
      ? rounding.allowedValues.find(v => v > needed) ?? needed
      : roundLoad(needed + (step > 0 ? step : rounding.step), rounding)
    return { value: more, reps: null, method: 'assist' }
  }
  const current = lifted > 0 && lifted < prescribed ? lifted : prescribed
  if ((preset === 'linear' || preset === 'double') && rounding.mode !== 'allowed_values' && !restPause && reps >= 1) {
    const found = selectDeloadCandidate({ currentWeight: current, targetWeight: prescribed, targetReps: reps, step: rounding.step, factor, reps, repsMin: preset === 'double' ? repsMin : undefined, perSide })
    if (found) return { value: found.weight, reps: found.reps, method: 'epley' }
  }
  return { value: deloadLoad(current, factor, rounding), reps: null, method: 'factor' }
}

/** A percent-of-1RM load backs off by the same factor, in tenths of a point, always at least a point lower. */
export function deloadPercent(percent, factor) {
  const next = round1(percent * factor)
  return Math.max(1, next < percent ? next : percent - 1)
}

/**
 * A timed hold's back-off (v1 `deloadTo(goal, 5)`): the position its sliding window goes back to.
 * Steps back at least one increment, never below one grid step of work, never forward.
 */
export function deloadedPosition({ startSeconds, step, position, factor }) {
  if (!(step > 0)) return position
  const current = startSeconds + step * position
  const target = Math.max(HOLD_GRID, deloadLoad(current, factor, { mode: 'nearest', step: HOLD_GRID }))
  if (target >= current) return position
  const back = Math.max(1, Math.round((current - target) / step))
  const floor = Math.ceil((HOLD_GRID - startSeconds) / step)
  return Math.min(position, Math.max(floor, position - back))
}
