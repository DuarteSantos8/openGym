import { useEffect, useState } from 'react'
import { MOBILE } from './mobile.js'
import { subscribeWatchHeartRate, watchHeartRate } from './watch-link.js'

// A reading counts for 15 s (watchHeartRate): looked at again this often, so one that stopped
// coming in leaves the header even when no new event arrives to say so.
const STALE_CHECK_MS = 5000

/** { bpm, running } from the Apple Watch app, for the workout header. */
export function useWatchHeartRate() {
  const [hr, setHr] = useState(() => watchHeartRate())
  useEffect(() => {
    if (!MOBILE) return undefined
    const refresh = () => setHr(prev => {
      const next = watchHeartRate()
      return prev.bpm === next.bpm && prev.running === next.running ? prev : next
    })
    const off = subscribeWatchHeartRate(refresh)
    const iv = setInterval(refresh, STALE_CHECK_MS)
    refresh()
    return () => { off(); clearInterval(iv) }
  }, [])
  return hr
}
