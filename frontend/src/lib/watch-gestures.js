// Settings → Apple Watch → Gestures: the pure parts of the picker (views/WatchGestures.jsx).
// The action list and the choices themselves live in lib/watch-settings.js.
import { t } from './i18n.js'
import { GESTURE_ACTIONS, gestureChoice } from './watch-settings.js'

/** How long the test waits for the watch before the page says so calmly. */
export const TEST_WAIT_MS = 30000

/** The actions that may be chosen for an input, Smart first (the order of GESTURE_ACTIONS). */
export const actionsFor = input => GESTURE_ACTIONS.filter(a => a.inputs.includes(input))

const clampIndex = (i, n) => Math.max(0, Math.min(n - 1, i))

/** The page a snap carousel rests on, from its scroll position (negative in a right-to-left layout). */
export const pageAt = (left, width, n) => (width > 0 ? clampIndex(Math.round(Math.abs(left) / width), n) : 0)

/** The Action Button's setup: 'working' once a press has reached openGym, 'done' on the lifter's word, else 'todo'. */
export const setupState = ({ setup, seenAt }) => (seenAt ? 'working' : setup ? 'done' : 'todo')

/** The test ping: 'idle' (none sent), 'waiting', 'ok' (the watch answered this stamp or a later one) or 'timeout'. */
export const testState = (stamp, testOk, now, wait = TEST_WAIT_MS) =>
  !stamp ? 'idle' : testOk >= stamp ? 'ok' : now - stamp > wait ? 'timeout' : 'waiting'

// Literal t() calls, so check-source-strings sees every line.
export const ICONS = { smart: 'sparkles', logSet: 'checkCircle', skipRest: 'skipForward', addRest: 'plusCircle', hold: 'stopwatch', nextExercise: 'chevronsRight', showMetrics: 'chart', none: 'ban' }
export const NAME = {
  smart: () => t('Smart'), logSet: () => t('Complete set'), skipRest: () => t('Skip rest'), addRest: () => t('Add 15 seconds'),
  hold: () => t('Start or stop hold'), nextExercise: () => t('Next exercise'), showMetrics: () => t('Show metrics'), none: () => t('Do nothing'),
}
const EFFECT = {
  smart: () => t('Taps what is lit on the watch: Done on a set, Skip on a rest.'),
  logSet: () => t('Logs the set you are on. Only when a set is up.'),
  skipRest: () => t('Ends the rest and brings up your next set.'),
  addRest: () => t('Gives you a little longer to rest. Only during a rest.'),
  hold: () => t('Starts the timer on a timed set. Press again to stop and log it.'),
  nextExercise: () => t('Jumps ahead to the next exercise in your plan.'),
  showMetrics: () => t('Opens the Metrics page: heart rate and time so far.'),
}
export const effect = (id, input) => id === 'none'
  ? (input === 'doubleTap' ? t('openGym ignores Double Tap. The watch does what it normally does.') : t('The button does nothing in an openGym workout.'))
  : EFFECT[id]()
export const inputName = input => input === 'doubleTap' ? t('Double Tap') : t('Action Button')
/** The name of the action chosen for an input, for the row on Settings → Apple Watch. */
export const gestureName = (id, input) => NAME[gestureChoice(id, input)]()

