// What Settings → Wear OS watch says (views/WearSettings.jsx), from the phone's Wear OS link
// (WatchBridge.status().wear, docs/WEAR_OS.md): pure, so every state has a test, and every state
// tells the lifter what to do next.
//
//   wear:    { supported, paired, installed, reachable, watches: [{ id, name, connected, installed, reachable }] }
//   channel: where this copy of the app came from (lib/channel.js): 'sideload' | 'play' | 'fdroid' | 'offline'
//
// The Data Layer only links a watch app to a phone app with the same package name and the same
// signing key. So the watch app has to come from where the phone app came from: Google Play for
// the Play app, the Wear OS APK of the same release for the APK from opengym.ch. A watch with the
// other one looks exactly like a watch without the app, which is why the two "get it" lines differ.

// How to put the watch app on a watch next to the sideloaded phone APK.
export const WEAR_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/WEAR_OS.md#installing'

/**
 * The page's one line about the link, as a key (the page has the words), what it offers
 * (`getApp`: the guide for the watch app) and the watches to list.
 */
export function wearView (wear, channel) {
  if (!wear) return { key: 'checking', getApp: false, watches: [] }
  const watches = Array.isArray(wear.watches) ? wear.watches.filter(w => w && typeof w === 'object') : []
  const base = { watches, getApp: false }
  // F-Droid's builds carry nothing from Google Play services, which is the only way to a Wear OS watch.
  if (channel === 'fdroid' || channel === 'offline') return { ...base, watches: [], key: 'build' }
  if (!wear.paired && !wear.installed) return { ...base, key: 'no-watch' }
  if (!wear.installed) return { ...base, key: channel === 'play' ? 'get-app-play' : 'get-app-apk', getApp: channel !== 'play' }
  return { ...base, key: wear.reachable ? 'on-watch' : 'on-watch-away' }
}

/** A watch's own line: whether openGym is on it, and whether it is in reach. */
export function wearWatchLine (w) {
  if (!w?.installed) return 'not-installed'
  return w.reachable || w.connected ? 'connected' : 'away'
}
