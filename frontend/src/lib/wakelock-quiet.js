// A workout nobody is touching must not hold the screen on for ever. The wake lock is let go after
// QUIET_MS without a set, a tap or a running rest / hold; the screen then locks by itself, as the
// phone's own setting says. Nothing ends: the next tap, or opening the app, takes the lock again.
// (The forgotten-workout rule asks at 45 min, but never runs on the web or with "Never".)
import { useEffect, useState } from 'react'
import { idleSince } from './forgotten-workout.js'

export const QUIET_MS = 15 * 60 * 1000

/** When the lock should go, as a time in ms; 0 while a rest or hold is counting down. */
export const quietAt = (A, { touchAt = 0, resting = false } = {}) =>
  resting ? 0 : idleSince(A, { activeAt: Math.max(Number(A?.reopenedAt) || 0, touchAt) }) + QUIET_MS

/** True once the running workout has been quiet for QUIET_MS; a tap or any change turns it off. */
export function useQuiet(A, resting) {
  const [quiet, setQuiet] = useState(false)
  // a set, a start, a reopen: anything that moves the clock re-arms it
  const since = A ? idleSince(A, { activeAt: A.reopenedAt }) : 0
  useEffect(() => {
    if (!A) { setQuiet(false); return }
    let touchAt = Date.now()   // a rest ending or a resume lands here too, and counts as a touch
    let timer
    const arm = () => {
      clearTimeout(timer)
      const at = quietAt(A, { touchAt, resting })
      const wait = at - Date.now()
      setQuiet(!!at && wait <= 0)
      if (at && wait > 0) timer = setTimeout(arm, wait)
    }
    const touch = () => { touchAt = Date.now(); arm() }
    arm()
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('visibilitychange', touch)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('visibilitychange', touch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A is read for its clock: `since` stands for it
  }, [!A, A?.id, since, A?.pausedAt, resting])
  return quiet
}
