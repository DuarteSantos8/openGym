// The phone's own screen lock (Face ID, Touch ID, a fingerprint, the passcode), asked before the
// phone app deletes an account its pairing proves (components/DeleteAccount.jsx): the server takes
// a paired phone's word for a profile with no password, so the phone makes sure its owner is the
// one holding it. The local `DeviceAuth` plugin does the asking: ios/App/App/DeviceAuthPlugin.swift
// (LocalAuthentication, .deviceOwnerAuthentication) and android/.../DeviceAuthPlugin.java
// (BiometricPrompt, or the lock screen's own confirm before Android 10). The web build never
// gets here: every call answers as if there were no plugin and registers nothing.
import { MOBILE } from './mobile.js'

// Registered once, and handed out inside an object: a Capacitor plugin proxy answers `then` with
// a native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP = null
const devicePlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { DeviceAuth: registerPlugin('DeviceAuth') }
})().catch(() => null))

// Whether the phone has a screen lock: 'set', 'none', or 'unknown' when it could not be asked.
// Only 'none' lets the delete go ahead without the lock (the typed name is then the only check).
export async function deviceLock() {
  const p = await devicePlugin()
  if (!p) return 'unknown'
  try { return (await p.DeviceAuth.check())?.secure ? 'set' : 'none' }
  catch { return 'unknown' }
}

// Asks the phone's owner to unlock. 'ok', 'none' (no screen lock to ask), 'cancelled' (they
// backed out) or 'failed' (anything else, a missing plugin included: nothing is sent then).
export async function confirmDeviceOwner(reason) {
  const p = await devicePlugin()
  if (!p) return 'failed'
  try {
    await p.DeviceAuth.verify({ reason })
    return 'ok'
  } catch (e) {
    if (e?.code === 'not-secure') return 'none'
    return e?.code === 'cancelled' ? 'cancelled' : 'failed'
  }
}
