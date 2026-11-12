import { useEffect, useReducer } from 'react'
import { useStore } from '../store/useStore.js'
import { checkLinks, linkSnapshot, onLinkChange } from '../lib/device-link-live.js'
import { WATCH_GRACE_MS } from '../lib/phone-workout.js'
import { useConnection } from './SyncBanner.jsx'

const POLL_MS = 15e3

// The links' rows and overall state, for the workout's link sign. While `live` (a workout is
// running) and the page is in front, it looks at the links when the workout starts, once more
// after the watch's grace, then every 15 s (status only: the ping wakes the watch, so it runs
// at the start, at the grace look and while the Devices sheet is open). Never on the render path: the looks are timers.
export function useDeviceLink({ live }) {
  const { view, waited } = useConnection()
  const pending = useStore(s => !!s.sync?.pending)
  const [, redraw] = useReducer(n => n + 1, 0)
  useEffect(() => onLinkChange(redraw), [])
  useEffect(() => {
    if (!live) return
    const look = ping => { if (document.visibilityState === 'visible') checkLinks({ ping }) }
    // back in front after a sleep: the snapshot is stale until this lands
    const back = () => look(false)
    look(true)
    const grace = setTimeout(() => look(true), WATCH_GRACE_MS)
    const poll = setInterval(back, POLL_MS)
    document.addEventListener('visibilitychange', back)
    return () => { clearTimeout(grace); clearInterval(poll); document.removeEventListener('visibilitychange', back) }
  }, [live])
  return linkSnapshot(Date.now(), view && { ...view, waited, pending })
}
