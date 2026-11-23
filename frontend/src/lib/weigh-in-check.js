// A likely typo caught at the weigh-in, as lib/typo-check.js catches one at the tick: 805 typed
// for 80.5 lands in the chart, the trend and the goal gap. Pure: the weigh-in sheet asks, this decides.

const ODD = 0.15

/**
 * The share `n` is off `last` (0.18 for 18%) when it is more than 15%, else null. Both are in the
 * profile's unit, as weigh-ins are stored, so the share needs no conversion. No last weigh-in, no check.
 */
export function weighInOff(n, last) {
  const a = Number(n), b = Number(last)
  if (!(a > 0) || !(b > 0)) return null
  const off = Math.abs(a - b) / b
  return off > ODD ? off : null
}
