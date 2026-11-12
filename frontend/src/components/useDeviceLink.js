import { useEffect, useReducer } from 'react'
import { useStore } from '../store/useStore.js'
import { checkLinks, linkSnapshot, onLinkChange } from '../lib/device-link-live.js'
import { WATCH_GRACE_MS } from '../lib/phone-workout.js'
import { connectionView } from './ServerSync.jsx'

const POLL_MS = 15e3

// The links' rows and overall state, for the workout's link sign. While `live` (a workout is
// running) and the page is in front, it looks at the links when the workout starts, once more
// after the watch's grace, then every 15 s. Never on the render path: the looks are timers.
export function useDeviceLink({ live }) {
  const sync = useStore(s => s.S.sync)
  const [, redraw] = useReducer(n => n + 1, 0)
  useEffect(() => onLinkChange(redraw), [])
  useEffect(() => {
    if (!live) return
    const look = () => { if (document.visibilityState === 'visible') checkLinks({ ping: true }) }
    look()
    const grace = setTimeout(look, WATCH_GRACE_MS)
    const poll = setInterval(look, POLL_MS)
    return () => { clearTimeout(grace); clearInterval(poll) }
  }, [live])
  return linkSnapshot(Date.now(), connectionView(sync))
}
