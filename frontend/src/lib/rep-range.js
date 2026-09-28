// Normalize the two bounds used by double progression.
// `reps` is the upper bound and `repsMin` is the lower bound in persisted configs.
export function normalizeRepRange(reps, repsMin, stride = 1) {
  const step = Number.isInteger(stride) && stride > 0 ? stride : 1
  const upper = align(positiveInt(reps, 10), step)
  const lower = align(positiveInt(repsMin, Math.max(1, upper - 2)), step)
  return lower >= upper
    ? { reps: lower + step, repsMin: lower }
    : { reps: upper, repsMin: lower }
}

function align(value, stride) {
  return Math.max(stride, Math.ceil(value / stride) * stride)
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback
}
