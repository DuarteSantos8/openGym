// Keeping the Tab key inside an open sheet (components/Modals.jsx). Before 1.4.5 a sheet opened
// with the focus still on the page behind it: eleven Tab presses walked through Home's cards and
// the tab bar before the first field of the sheet came up, and a screen reader was never told a
// dialog had opened. Pure, so it can be tested without a layout engine: `visible` decides what
// counts as on screen (the browser asks offsetParent, a test passes its own).

export const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const onScreen = el => el.offsetParent !== null

/**
 * Where a Tab press should land while `box` is the open dialog: an element to focus, or null to
 * let the browser move on by itself (the press stays inside the box anyway).
 *   - focus outside the box, or on the box itself: its first stop (its last with Shift)
 *   - on the last stop: round to the first; with Shift on the first: round to the last
 *   - a box with nothing to tab to keeps the focus on itself
 */
export function trapTab(box, active, shift, visible = onScreen) {
  if (!box) return null
  const stops = [...box.querySelectorAll(TABBABLE)].filter(visible)
  if (!stops.length) return box
  const first = stops[0], last = stops[stops.length - 1]
  if (!active || active === box || !box.contains(active)) return shift ? last : first
  if (!shift && active === last) return first
  if (shift && active === first) return last
  return null
}

/** A sheet gives the focus back to what opened it, unless that is a text field (its keyboard would come back up). */
export function canTakeFocusBack(el) {
  if (!el || !el.isConnected || el === el.ownerDocument?.body) return false
  return !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable
}
