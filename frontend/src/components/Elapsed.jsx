import { useEffect, useState } from 'react'

// A session's running time, "12:34" since `start`. Its own little component so the only thing
// that re-renders every second is this text: the workout header and the tab bar's Resume button
// both show it.
export default function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.max(0, Math.floor((Date.now() - start) / 1000)); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    // A hidden page changes nothing on screen (store/useUI.js runRest has the story): the page
    // keeps running behind a locked phone while a rest holds the audio session, and a clock
    // re-rendered every second there is a layout iOS is not showing. Catch up on the way back.
    const live = () => { if (!document.hidden) tick() }
    live(); const iv = setInterval(live, 1000); document.addEventListener('visibilitychange', live)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', live) }
  }, [start])
  return <span>{t}</span>
}
