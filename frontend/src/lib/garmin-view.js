// What Settings → Garmin says (views/GarminSettings.jsx), from the phone's Garmin link
// (WatchBridge.garminStatus, docs/GARMIN.md): pure, so every state has a test.
//
//   status: { supported, state, installed, reachable, store, picker?, devices: [{ id, name, connected, installed? }] }
//   state:  starting | ready | idle (iPhone, nothing picked yet) | no-gcm | gcm-upgrade | error
//           | build (this build has no Garmin link: F-Droid, or an iPhone build without the SDK)

// The guide (building and sideloading the watch app).
export const GARMIN_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/GARMIN.md'
// The watch app's page in the Connect IQ Store (the same id as GarminLink.STORE_ID / storeId):
// where "Get openGym for Garmin" goes when Garmin Connect cannot open it itself.
export const GARMIN_STORE_ID = '62e66310-66de-4bdd-8e40-5d2c0d853a08'
export const GARMIN_STORE = 'https://apps.garmin.com/apps/' + GARMIN_STORE_ID

/**
 * The page's one line about the link, as an English key for t(), and what it offers:
 * `pick` (choose or look for watches), `getApp` (put openGym on the watch).
 */
export function garminView (status) {
  if (!status) return { key: 'checking', pick: false, getApp: false, devices: [] }
  const devices = Array.isArray(status.devices) ? status.devices.filter(d => d && d.id) : []
  const base = { devices, pick: false, getApp: false }
  if (status.state === 'build' || status.supported === false) return { ...base, key: 'build' }
  // The iPhone asks Garmin Connect again with Choose watches once it is installed; Android looks by itself.
  if (status.state === 'no-gcm') return { ...base, key: 'no-gcm', pick: !!status.picker }
  // Nobody tells the link when Garmin Connect was updated: Look again starts it over (Android).
  if (status.state === 'gcm-upgrade') return { ...base, key: 'gcm-upgrade', pick: true }
  if (status.state === 'error') return { ...base, key: 'error', pick: true }
  if (status.state === 'starting') return { ...base, key: 'checking' }
  if (!devices.length) return { ...base, key: status.picker ? 'pick' : 'no-watch', pick: true }
  if (status.installed) return { ...base, key: status.reachable ? 'on-watch' : 'on-watch-away', pick: true }
  // No watch is known to have the app. Only a watch in reach can say whether it has it: with none
  // there (out of range, Bluetooth off) and none that ever said no, "it isn't on it yet" would be a
  // guess, and "get the app" the wrong thing to do for someone who has it.
  if (!devices.some(d => d.connected) && !devices.some(d => d.installed === false)) return { ...base, key: 'away', pick: true }
  return { ...base, key: 'get-app', pick: true, getApp: true }
}

/** A watch's line: connected or not, and whether openGym is on it (when that is known). */
export function garminDeviceLine (d) {
  if (d?.installed === false) return 'not-installed'
  return d?.connected ? 'connected' : 'away'
}
