// Hardware keys on the workout screen (issue #133). A keyboard, or a big USB button that types
// a key, drives the session on a screen nobody wants to touch mid-set: a Raspberry Pi on the
// gym wall, a laptop on the bench. Space or Enter ticks the next set; ← and → go to the previous
// or next exercise. Only the decisions live here; views/Workout.jsx listens and acts on them.
import { supersetUnits, unitOf } from './history.js'
import { nextUnfinishedUnit } from './supersetFlow.js'
import { isSideSet } from './workout-model.js'

// Where a key belongs to the element rather than to the workout: every text field (the arrows
// move the caret there), and the controls that use the arrows themselves.
const OWNS_KEYS = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="slider"],[role="spinbutton"]'
// What Space and Enter press when focus is on it.
const CONTROL = 'button,a[href],summary,[role="button"],[role="checkbox"],[role="switch"],[role="menuitem"],[role="tab"],[role="option"]'

/**
 * What a key press means on the workout screen: 'tick', 'prev', 'next', or null when it is not
 * one of these keys, or not the workout's to take.
 *
 * `tabbed` says whether focus reached its element with Tab. Someone who tabbed to a button and
 * presses Space or Enter means that button. A click, though, also leaves focus on the button it
 * pressed (Chrome, Firefox), and a USB button that sends Space must not press "Next" again just
 * because the mouse was the last thing to use it — so without Tab, Space and Enter tick.
 * Modifier combinations are left alone: they are the browser's and the system's shortcuts.
 *
 * `rtl` mirrors the arrows: in a right-to-left language the exercises run from right to left like
 * the text, and the next card comes in from the left (components/SwipeCards.jsx), so ← is next.
 */
export function workoutKeyAction(event, { tabbed = false, rtl = false } = {}) {
  if (!event || event.defaultPrevented || event.repeat || event.isComposing) return null
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  const target = event.target
  const within = selector => !!(target && typeof target.closest === 'function' && target.closest(selector))
  if (target?.isContentEditable || within(OWNS_KEYS)) return null
  switch (event.key) {
    case ' ':
    case 'Spacebar':
    case 'Enter':
      return tabbed && within(CONTROL) ? null : 'tick'
    case 'ArrowLeft': return rtl ? 'next' : 'prev'
    case 'ArrowRight': return rtl ? 'prev' : 'next'
    default: return null
  }
}

/**
 * The set a 'tick' is for: `{ idx, i, side?, current }` (entry index, set index, 'L' or 'R' for
 * a unilateral row, and whether it belongs to the exercise marked current), or null when
 * nothing is left to tick.
 *
 * The exercise marked current comes first. In a superset that is the member whose turn it is,
 * followed by the rest of its group. After that comes the next exercise with work left, the
 * same one the superset and finish flow would reach (nextUnfinishedUnit, which wraps round to
 * one skipped earlier). A unilateral set is ticked a side at a time, left first.
 */
export function nextOpenSet(entries, cur) {
  if (!Array.isArray(entries) || !entries.length) return null
  const at = Number.isInteger(cur) ? Math.min(Math.max(cur, 0), entries.length - 1) : 0
  const units = supersetUnits(entries)
  const unit = unitOf(units, at)
  const pos = Math.max(0, unit.indexOf(at))
  const order = [...unit.slice(pos), ...unit.slice(0, pos), ...(nextUnfinishedUnit(entries, units, at) || [])]
  for (const idx of order) {
    const sets = Array.isArray(entries[idx]?.sets) ? entries[idx].sets : []
    const i = sets.findIndex(s => !s?.done)
    if (i < 0) continue
    const set = sets[i]
    const current = unit.includes(idx)
    return isSideSet(set) ? { idx, i, side: set.sides.L.done ? 'R' : 'L', current } : { idx, i, current }
  }
  return null
}
