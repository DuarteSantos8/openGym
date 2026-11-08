// Settings → Apple Watch → Gestures: the pure parts of the picker (views/WatchGestures.jsx).
// The action list and the choices themselves live in lib/watch-settings.js.
import { GESTURE_ACTIONS } from './watch-settings.js'

/** How long the test waits for the watch before the page says so calmly. */
export const TEST_WAIT_MS = 30000

/** The actions that may be chosen for an input, Smart first (the order of GESTURE_ACTIONS). */
export const actionsFor = input => GESTURE_ACTIONS.filter(a => a.inputs.includes(input))

export const clampIndex = (i, n) => Math.max(0, Math.min(n - 1, i))
export const stepIndex = (i, d, n) => clampIndex(i + d, n)

/** The page a snap carousel rests on, from its scroll position (negative in a right-to-left layout). */
export const pageAt = (left, width, n) => (width > 0 ? clampIndex(Math.round(Math.abs(left) / width), n) : 0)

/** The Action Button's setup: 'working' once a press has reached openGym, 'done' on the lifter's word, else 'todo'. */
export const setupState = ({ setup, seenAt }) => (seenAt ? 'working' : setup ? 'done' : 'todo')

/** The test ping: 'idle' (none sent), 'waiting', 'ok' (the watch answered this stamp or a later one) or 'timeout'. */
export const testState = (stamp, testOk, now, wait = TEST_WAIT_MS) =>
  !stamp ? 'idle' : testOk >= stamp ? 'ok' : now - stamp > wait ? 'timeout' : 'waiting'
