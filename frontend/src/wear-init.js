// Starts the Wear OS link on the Android app: registers WearBridgePlugin's listeners and hands the
// decisions to lib/wear-link.js. Everything here is wiring; what is decided is in lib/ and tested
// there. The web build and iOS never get past the first line (MOBILE is a build-time flag).
import { MOBILE, isAndroid, onAppActive } from './lib/mobile.js'
import { createWearLink } from './lib/wear-link.js'
import { t, exerciseNameFor } from './lib/i18n.js'
import { EXIDX } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWatchWorkout, menuSheet } from './sheets.jsx'

let started = false
// Quiet time after a change before the routines are put in the Data Layer again.
const PUBLISH_DEBOUNCE_MS = 4000

// The store loads its state asynchronously (the file mirror on the phone); a watch event that
// arrives while the app is still waking up has to wait for it, or it would be judged against an
// empty log.
function whenReady() {
  if (useStore.getState().ready) return Promise.resolve()
  return new Promise(resolve => {
    const stop = useStore.subscribe(s => { if (s.ready) { stop(); resolve() } })
  })
}

// Resolves when the sheet is gone, whichever way it went (a choice, the backdrop, Android back).
function askConflict({ name, save, discard }) {
  const { id } = menuSheet({
    title: t('Your watch has a workout'),
    subtitle: t('You have a workout going on this phone. The one from your watch ({0}) has not been added yet.', name),
    sections: [
      { items: [{ icon: 'check', accent: true, label: t('Save it as a separate workout'), onClick: save }] },
      { items: [
        { icon: 'clock', label: t('Decide later') },
        { icon: 'trash', danger: true, label: t('Discard the watch workout'), onClick: discard },
      ] },
    ],
  })
  return new Promise(resolve => {
    const stop = useUI.subscribe(s => { if (!s.sheets.some(x => x.id === id)) { stop(); resolve() } })
  })
}

export async function initWearLink() {
  if (!MOBILE || started) return
  started = true
  try {
    if (!(await isAndroid())) return
    const { registerPlugin } = await import('@capacitor/core')
    // Wrapped in an object: a Capacitor plugin proxy answers `then`, so a promise resolved with
    // the bare proxy never settles (see lib/rest-alert.js).
    const { WearBridge } = { WearBridge: registerPlugin('WearBridge') }
    const link = createWearLink({
      plugin: WearBridge,
      getState: () => useStore.getState().S,
      finish: finishWatchWorkout,
      askConflict,
      nameOf: e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.target?.n || e.id)),
      toast: m => useUI.getState().toast(m),
      t,
    })
    const after = fn => async e => { await whenReady(); return fn(e) }
    await WearBridge.addListener('routineRequested', after(link.onRoutineRequested))
    await WearBridge.addListener('sessionFinished', after(link.onSession))
    // Native hands over what queued up while the page was not listening, and again whenever the
    // app comes forward: a session waits in the Data Layer until it is acked.
    await WearBridge.ready()
    // The watch starts a workout from the copy it holds, so the copies are kept current here: on
    // start, when the app comes forward, and a moment after anything that could change a routine
    // (one saved, one edited). Not while a workout is going on this phone: nothing a routine says
    // changes until it is saved, and every tick of a set writes the store.
    const publish = after(() => link.publishAll())
    publish()
    onAppActive(() => { WearBridge.refresh().catch(() => {}); publish() })
    let timer = null
    useStore.subscribe(({ S, ready }) => {
      if (!ready || S?.active) return
      clearTimeout(timer)
      timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS)
    })
  } catch {
    // No plugin behind the bridge (a native project that predates it), or no Play services: the
    // phone app simply has no watch.
  }
}
