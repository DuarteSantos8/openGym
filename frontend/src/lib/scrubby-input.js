export const SCRUB_HOLD_MS = 300
export const SCRUB_SLOP = 8
export const SCRUB_STEP_PX = 18
export const SCRUB_DEAD_PX = 4

// Consume movement relative to the last step, rather than the initial value: reversing at
// a limit (or an irregular equipment weight) must immediately walk back the other way.
export function scrubMove(previous, y, value, next) {
  const distance = previous - y
  const count = Math.trunc(distance / SCRUB_STEP_PX)
  let result = value
  for (let i = 0; i < Math.abs(count); i++) {
    const stepped = next(result, Math.sign(count))
    if (Object.is(stepped, result)) break
    result = stepped
  }
  return { value: result, y: count ? previous - count * SCRUB_STEP_PX : previous }
}
