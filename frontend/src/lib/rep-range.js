// Normalize the two bounds used by double progression.
// `reps` is the upper bound and `repsMin` is the lower bound in persisted configs.
import { repStep } from './history.js'

export function normalizeRepRange(reps, repsMin, stride = 1) {
  const step = Number.isInteger(stride) && stride > 0 ? stride : 1
  const upper = align(positiveInt(reps, 10), step)
  const lower = align(positiveInt(repsMin, Math.max(1, upper - 2)), step)
  return lower >= upper
    ? { reps: lower + step, repsMin: lower }
    : { reps: upper, repsMin: lower }
}

// The set-count twin of normalizeRepRange. Unlike a rep range, a fixed set count is a
// legitimate plan (climbing sets is optional overload, not the point of the exercise), so
// setsMin is allowed to equal setsMax instead of being pushed one stride below it.
export function normalizeSetRange(setsMax, setsMin, stride = 1) {
  const step = Number.isInteger(stride) && stride > 0 ? stride : 1
  const upper = align(positiveInt(setsMax, 3), step)
  const lower = align(positiveInt(setsMin, Math.max(1, upper - 2)), step)
  return lower > upper ? { setsMax: lower, setsMin: lower } : { setsMax: upper, setsMin: lower }
}

// Normalizes both triple-progression ranges together, aligning reps to the exercise's own
// stride (per-side work steps by 2) and sets to a plain integer stride. `valid` says whether
// every limit was actually configured — an exercise that only has some of the four is not
// ready for `triple` and must not be handed an ambiguous target by the caller.
export function normalizeTriple(cfg) {
  const valid = [cfg?.setsMin, cfg?.setsMax, cfg?.repsMin, cfg?.reps].every(v => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0
  })
  const setRange = normalizeSetRange(cfg?.setsMax, cfg?.setsMin, 1)
  const repRange = normalizeRepRange(cfg?.reps, cfg?.repsMin, repStep(cfg))
  return { setsMin: setRange.setsMin, setsMax: setRange.setsMax, repsMin: repRange.repsMin, reps: repRange.reps, valid }
}

function align(value, stride) {
  return Math.max(stride, Math.ceil(value / stride) * stride)
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback
}
