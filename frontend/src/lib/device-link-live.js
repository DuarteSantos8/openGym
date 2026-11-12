// The live signals behind the link sign and the Devices sheet (docs/dev/DEVICE_LINK_STATUS.md):
// asks the links, remembers when each last answered, and hands the lot to the rules in
// device-link-status.js. Module state, not the store: none of it belongs in a profile.
import { deviceRows } from './device-link-status.js'
import { watchStatus, pingWatch, relayStatus, watchState } from './watch-sync.js'
import { readWatchPrefs, readWatchSeen, markWatchSeen } from './watch-settings.js'
import { liveHeartRate } from './phone-workout.js'
import { nativePlatform } from './mobile.js'
import { isOn } from './modules.js'

let watch = null, ping = null, relay = null, relaySeen = null, heard = null, platform = null
let flight = null
const listeners = new Set()
const emit = () => { for (const fn of listeners) { try { fn() } catch { /* a listener's problem */ } } }

export const onLinkChange = fn => { listeners.add(fn); return () => listeners.delete(fn) }

/** The watch of workout `wid` was heard from just now: an event arrived, or a ping came back. */
export function noteHeard (wid, at = Date.now()) {
  if (wid == null) return
  heard = { wid, at }
  emit()
}

/** One look at the links, and with `ping` a round trip to a watch that is there. One at a time. */
export function checkLinks ({ ping: withPing = false } = {}) {
  if (flight) return flight
  flight = (async () => {
    try {
      platform = await nativePlatform()
      watch = await watchStatus()
      if (watch.installed) markWatchSeen()
      relay = await relayStatus()
      if (relay?.reachable) relaySeen = Date.now()
      if (withPing && watch.reachable) {
        const r = await pingWatch()
        ping = { ...r, at: Date.now() }
        if (r.ok) noteHeard(watchState()?.S?.active?.id, ping.at)
      }
    } finally { flight = null; emit() }
  })()
  return flight
}

/** The rows and the overall state as of `now`. `server` is the sync server's connectionView. */
export function linkSnapshot (now = Date.now(), server = null) {
  const S = watchState()?.S
  const a = S?.active
  return deviceRows({
    platform, watch, ping, heard, server,
    watchOn: isOn(S, 'watch') && readWatchPrefs().enabled,
    seen: readWatchSeen(),
    activeId: a?.id ?? null,
    startedAt: a ? Number(a.start) || null : null,
    relay: relay && { ...relay, seen: relaySeen },
    hr: liveHeartRate(now),
  }, now)
}

export function _resetDeviceLink () { watch = ping = relay = relaySeen = heard = platform = flight = null; listeners.clear() }
