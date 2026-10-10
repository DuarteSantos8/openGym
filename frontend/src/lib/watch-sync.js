// The iPhone app's side of the Apple Watch app (WatchPlugin.swift, ios/App/OpenGymWatch). The
// watch holds no log of its own: whenever the running workout or the rest changes, the phone
// hands it one small snapshot (lib/watch-model.js), and the watch answers with an action — a set
// done with its reps and weight, or the rest skipped, lengthened, held or carried on.
//
// A set done from the watch goes through the workout screen's own tick (views/Workout.jsx binds
// it here), so the rest it starts, the superset step and the end-of-workout sheet are exactly
// those of a tap on the phone. With that screen not open, the latest one waits here until it is,
// and is checked again then: a set the phone has moved past meanwhile is not ticked.
//
// Only in the iOS app; MOBILE is a build-time flag and the web bundle never gets here.
import { MOBILE, nativePlatform } from './mobile.js'
import { exerciseNameFor, t } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { readWatchAction, watchSnapshot } from './watch-model.js'

// A set done on the watch that waited longer than this for the workout screen is dropped.
export const PENDING_MS = 10 * 60 * 1000

// Wrapped in an object, as in health-sync.js: a Capacitor plugin proxy answers `then`.
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if ((await nativePlatform()) !== 'ios') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { W: registerPlugin('Watch') }
})().catch(() => null))

const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))

// Every word the watch prints, in the app's language.
export const watchLabels = unit => ({
  done: t('Done'),
  rest: t('Rest'),
  skip: t('Skip'),
  pause: t('Pause'),
  resume: t('Resume'),
  paused: t('Paused'),
  reps: t('Reps'),
  weight: t('Weight ({0})', unit),
  warmup: t('Warm-up'),
  ready: t('Rest’s over. Next set!'),
  switching: t('Switch sides'),
  complete: t('Workout complete!'),
  onPhone: t('Log this set on your iPhone'),
  noWorkout: t('Start a workout on your iPhone'),
  waiting: t('Waiting for iPhone'),
})

/** The snapshot as it goes to the watch: the model's, with the set's own "Set n" label. */
export function snapshotFor(S, timer) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const snap = watchSnapshot(S, timer, { nameOf, labels: watchLabels(unit) })
  if (snap.set) snap.set.label = t('Set {0}', snap.set.setNo) + ' / ' + snap.set.setCount
  return snap
}

let doneHandler = null
let pending = null
const deliver = () => {
  if (!pending || !doneHandler) return
  const { action, at } = pending
  pending = null
  if (Date.now() - at < PENDING_MS) doneHandler(action)
}

/**
 * The workout screen's tick, for a set done on the watch: called with the action as it came
 * (readWatchAction checks it again against the workout then). Returns the unbind.
 */
export function bindWatchDone(fn) {
  doneHandler = fn
  deliver()
  return () => { if (doneHandler === fn) doneHandler = null }
}

/** What an action from the watch does, given the two stores. Exported for its test. */
export function handleWatchAction(ev, store, ui) {
  const a = readWatchAction(store.getState().S?.active, ev)
  if (!a) return false
  const U = ui.getState()
  if (a.type === 'skipRest') U.stopRest()
  else if (a.type === 'addRest') U.addRest(a.sec)
  else if (a.type === 'pauseRest') U.pauseRest()
  else if (a.type === 'resumeRest') U.resumeRest()
  else if (a.type === 'done') { pending = { action: ev, at: Date.now() }; deliver() }
  return true
}

/**
 * Started once, from the UI store (store/useUI.js), with both stores handed in: this file must
 * not import them, since the store imports what it starts. Sends the snapshot whenever it
 * changes — a running rest is sent by its end, so the countdown's ticks send nothing.
 */
let started = false
export function initWatchSync({ store, ui }) {
  if (!MOBILE || started) return
  started = true
  plugin().then(p => {
    if (!p) return
    let last = ''
    let tm = null
    const send = () => {
      tm = null
      const json = JSON.stringify(snapshotFor(store.getState().S, ui.getState().timer))
      if (json === last) return
      last = json
      p.W.update({ snapshot: json }).catch(() => { last = '' })
    }
    const soon = () => { if (!tm) tm = setTimeout(send, 150) }
    store.subscribe(soon)
    ui.subscribe(soon)
    send()
    p.W.addListener('action', ev => { handleWatchAction(ev, store, ui) })
    // The watch app opened, or came back in reach: it asks, and gets the snapshot again.
    p.W.addListener('hello', () => { last = ''; soon() })
  }).catch(() => {})
}

// Test seam: a fresh launch.
export function _resetWatchSync() { started = false; pluginP = null; doneHandler = null; pending = null }
