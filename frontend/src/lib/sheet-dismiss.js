// When a pulled-down bottom sheet closes (components/Modals.jsx), as a pure rule with its tests.
//
// The exercise sheets hold long how-tos, and a pull that was meant to scroll them back up closed
// the sheet instead (#897): 90 px, or a 30 px flick, was enough. Now the release is judged the
// way iOS judges its own sheets: by where the gesture is going, not where the finger let go.
// The release velocity is projected forward (Apple's deceleration projection, the same one a
// scroll view uses), and the sheet closes only when that landing point is past a good part of
// its own height, after a pull that really travelled, moving down at the moment of release.
// Anything else springs back.

// Apple's projection from the Designing Fluid Interfaces sample: px/ms in, px out.
export const projectPx = (vyPxPerMs, rate = 0.998) => vyPxPerMs * rate / (1 - rate)

// The least the finger has to travel before a release can close the sheet at all.
export const MIN_PULL = 48
// How far the projection has to land: a share of the sheet, with a floor for small sheets.
export const landingFor = height => Math.max(160, 0.4 * (Number(height) > 0 ? height : 0))

/**
 * Whether a pull released `delta` px below where it started, moving `vy` px/ms (positive is down),
 * closes a sheet `height` px tall.
 */
export function dismissesOnRelease({ delta, vy, height }) {
  if (!(delta >= MIN_PULL)) return false
  // Moving back up at release is a change of mind, however far it went.
  if (vy < 0) return false
  // A slow, long pull lands where it was let go; a flick lands further on.
  return delta + projectPx(Math.min(vy, 4)) >= landingFor(height)
}

/**
 * Whether anything between the touched element and the sheet is scrolled away from its top:
 * then the pull belongs to that scroll, and the sheet stays where it is.
 */
export function scrolledAboveTop(target, sheet) {
  for (let el = target; el && el !== sheet?.parentNode; el = el.parentNode) {
    if (el.nodeType === 1 && el.scrollTop > 0) return true
    if (el === sheet) break
  }
  return false
}
