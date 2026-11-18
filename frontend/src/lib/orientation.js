// Screen orientation on Android (#821): follow the phone (the default), or stay upright or
// sideways whatever the phone does, for openGym alone and not the system's auto-rotate.
//
// The choice is this device's, not the profile's (a tablet and a phone want different things), so
// it lives in localStorage and never in S. OrientationPlugin.java keeps a copy in the app's own
// preferences and applies it in MainActivity.onCreate, so the app opens the right way up before the
// page has even loaded.
import { platformNow } from './platform-now.js'

export const ORIENTATIONS = ['auto', 'portrait', 'landscape']
const KEY = 'gym_orientation'

export function readOrientation(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(KEY)
    return ORIENTATIONS.includes(v) ? v : 'auto'
  } catch { return 'auto' }
}

export const orientationSupported = () => platformNow() === 'android'

// Registered once, kept inside an object: a Capacitor plugin proxy answers `then` with a native call
// that never settles, so a promise resolved with the bare proxy would hang (#42).
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  const { registerPlugin } = await import('@capacitor/core')
  return { p: registerPlugin('Orientation') }
})().catch(() => null))

export async function applyOrientation(mode = readOrientation()) {
  if (!orientationSupported()) return
  try {
    const h = await plugin()
    if (h) await h.p.lock({ mode: ORIENTATIONS.includes(mode) ? mode : 'auto' })
  } catch {
    // An older APK without the plugin: the phone decides, as before.
  }
}

export function setOrientation(mode, storage = globalThis.localStorage) {
  if (!ORIENTATIONS.includes(mode)) mode = 'auto'
  try {
    if (mode === 'auto') storage?.removeItem(KEY)
    else storage?.setItem(KEY, mode)
  } catch { /* private mode: still applied for this run */ }
  return applyOrientation(mode)
}
