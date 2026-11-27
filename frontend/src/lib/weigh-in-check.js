// A weigh-in far off the last one is most likely a slip of a finger: 7.8 for 78, 87 for 78 a
// row over. Saved, it bends the curve, the weekly mean and everything that reads the body weight
// (calories, body-weight exercises), so it asks once first (thanks @lodepav, whose #1514 had the
// idea). Pure: BwSheet asks, this decides.

/** How far off counts as "far": 15 % of the last weigh-in, either way. */
export const WEIGH_IN_OFF = 0.15

/** Whether `typed` is more than 15 % away from `last`. No last weigh-in, nothing to compare. */
export function weighInOff(typed, last, limit = WEIGH_IN_OFF) {
  const n = Number(typed), l = Number(last)
  if (!(n > 0) || !(l > 0)) return false
  return Math.abs(n - l) / l > limit
}
