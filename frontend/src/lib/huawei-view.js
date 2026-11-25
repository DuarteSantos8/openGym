// What Settings → Huawei watch says (views/HuaweiSettings.jsx), from the phone's Huawei link
// (WatchBridge.huaweiStatus, docs/HUAWEI_WATCH.md): pure, so every state has a test.
//
//   status: { supported, state, installed, reachable, devices: [{ id, name, connected, installed? }] }
//   state:  off | starting | ready | no-health (Huawei Health is not on the phone)
//           | no-permission (openGym is not allowed in Huawei Health yet) | error
//           | build (this version has no Huawei link: F-Droid, Offline, or not switched on yet)

// The guide (getting the watch app onto the watch: there is no store link yet).
export const HUAWEI_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/HUAWEI_WATCH.md'

/**
 * The page's one line about the link, as a key for the page's words, and what it offers:
 * `button` ('allow' asks in Huawei Health, 'again' looks for watches again), `getApp` (the guide).
 */
export function huaweiView (status) {
  if (!status) return { key: 'checking', button: null, getApp: false, devices: [] }
  const devices = Array.isArray(status.devices) ? status.devices.filter(d => d && d.id) : []
  const base = { devices, button: null, getApp: false }
  if (status.state === 'build' || status.supported === false) return { ...base, key: 'build' }
  if (status.state === 'no-health') return { ...base, key: 'no-health' }
  if (status.state === 'no-permission') return { ...base, key: 'no-permission', button: 'allow' }
  if (status.state === 'error') return { ...base, key: 'error', button: 'again' }
  if (status.state !== 'ready') return { ...base, key: 'starting' }
  if (!devices.length) return { ...base, key: 'no-watch', button: 'again' }
  // Only a watch that said it has the app can be left out of the guide.
  return { ...base, key: 'ready', button: 'again', getApp: devices.some(d => d.installed !== true) }
}

/** A watch's line: connected or not, and whether openGym is on it (when that is known). */
export function huaweiDeviceLine (d) {
  if (d?.installed === false) return 'not-installed'
  return d?.connected ? 'connected' : 'away'
}
