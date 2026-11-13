import { useEffect, useState } from 'react'

// A session's running time, "12:34" since `start`. Its own little component so the only thing
// that re-renders every second is this text: the workout header and the tab bar's Resume button
// both show it.
// `pausedAt` (#976, lib/workout-pause.js): a paused workout's clock stands at its pause.
export function useElapsed(start, pausedAt = 0) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.max(0, Math.floor(((pausedAt > 0 ? pausedAt : Date.now()) - start) / 1000)); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    if (pausedAt > 0) { tick(); return undefined }
    // Hidden (another app, the screen locked), nobody reads it: no re-render a second, and the
    // count is right again the moment the page shows.
    const onTick = () => { if (!document.hidden) tick() }
    tick(); const iv = setInterval(onTick, 1000)
    document.addEventListener('visibilitychange', onTick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onTick) }
  }, [start, pausedAt])
  return t
}

export default function Elapsed({ start, pausedAt = 0 }) {
  return <span>{useElapsed(start, pausedAt)}</span>
}
