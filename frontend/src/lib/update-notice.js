// A newer version of the sideloaded APK offers itself when the app is opened
// (components/UpdateNotice.jsx). Until now only Settings → About asked GitHub, so an update
// waited for someone to look there. The offer comes once per version: Not now, or a tap outside,
// is that version's answer, kept on this device, and About still offers it.

export const SEEN_KEY = 'update_offered'

/** Whether to offer `info` (lib/update.js checkForUpdate's answer) now: a newer version with an
 *  APK to install, not offered before (`seen`, the version last offered), and no workout open
 *  (`busy`): a sheet over a set being logged would be in the way. */
export function shouldOffer(info, seen, busy) {
  if (!info?.hasUpdate || !info.apkUrl || !info.latestVersion) return false
  if (busy) return false
  return info.latestVersion !== seen
}

/** The same question with the wait told apart: 'offer' now, 'wait' for an offer that is due but
 *  `busy` (a workout open, or a sheet up: an update started from About is one) holds back, to be
 *  asked again once that is over, else 'no'. */
export function offerNow(info, seen, busy) {
  if (!shouldOffer(info, seen, false)) return 'no'
  return busy ? 'wait' : 'offer'
}

export const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' } }
export const writeSeen = v => { try { localStorage.setItem(SEEN_KEY, v) } catch { /* private mode: asked again next time */ } }
