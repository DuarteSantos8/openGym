import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'

// Flips the app's real light/dark theme on and off twice (~2.4s) instead of laying an
// opaque black/white rectangle over the screen — the alert reads as the app itself
// blinking, and it always settles back on whatever theme the user actually had.
export default function TimerFlash() {
  const id = useUI(s => s.timerFlashId)
  useEffect(() => {
    if (!id) return
    const de = document.documentElement
    const original = de.dataset.theme
    const opposite = original === 'light' ? 'dark' : 'light'
    const steps = [opposite, original, opposite, original]
    const timers = steps.map((theme, i) => setTimeout(() => { de.dataset.theme = theme }, i * 600))
    return () => {
      timers.forEach(clearTimeout)
      de.dataset.theme = original
    }
  }, [id])
  return null
}
