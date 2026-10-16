import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { systemReducesMotion } from '../lib/reduced-motion.js'
import { loadGlyphs, createSplash } from '../lib/brand-splash.js'
import { holdPage } from '../lib/use-dialog-focus.js'
import { MIN_SHOW_MS, mayPlay, splashAction } from '../lib/splash-rules.js'
import { BootMark } from './BrandMark.jsx'

// How long the splash takes to leave once it may: the fade (.boot-splash in ui-kit.css) and a margin.
// A timer, not transitionend: where transitions are switched off the event never comes.
export const LEAVE_MS = 320

// Once per page load: a launch, a reload, the installed app opened from the home screen. Not when
// the app comes back from the background or a route changes, because the page is still the same page.
let started = false
export const resetBootSplash = () => { started = false }   // for tests

function canDraw() {
  try { return !!document.createElement('canvas').getContext?.('2d') } catch { return false }
}

// The splash the app opens with: over the page, hiding it while it loads, drawn by lib/brand-splash.js
// from the G the first frame already shows (index.html, the native launch image), so the G stays
// where it is and "gains" arrives under it. It never makes the app wait (lib/splash-rules.js): it
// leaves when the app has read its state AND it has been up MIN_SHOW_MS, then fades; a tap, Enter,
// Space or Escape ends the minimum early (it still waits for the state). If the letters have not
// loaded by the time the app is ready it is dropped without ever drawing. It does not play on a
// launch that opens a route (a link, a notification), for reduced motion (the device's setting or
// the app's switch), where there is no canvas, or after the first time in a page load. The page
// behind it is inert while it plays.
export default function BootSplash() {
  const ready = useStore(s => s.ready)
  const [phase, setPhase] = useState(() => mayPlay({
    started, canDraw: canDraw(), ready: useStore.getState().ready, location: window.location,
    reducedMotion: systemReducesMotion() || useStore.getState().S?.reduceMotion === true,
  }) ? 'play' : 'off')
  const [held, setHeld] = useState(false)       // it has been up long enough, or was ended early
  const [drawing, setDrawing] = useState(false) // the letters loaded and the canvas drew its first frame
  const box = useRef(null), canvas = useRef(null)

  useEffect(() => { started = true }, [])

  useEffect(() => {
    if (phase !== 'play') return
    let cancelled = false, splash = null
    loadGlyphs().then(glyphs => {
      if (cancelled) return
      splash = createSplash(canvas.current, glyphs, { fromG: true })
      // The canvas has drawn its first frame by now: only then does the still G under it go.
      if (splash.ok) { box.current.dataset.drawing = ''; setDrawing(true) }
      else setPhase('off')
    }).catch(() => { if (!cancelled) setPhase('off') })
    return () => { cancelled = true; splash?.destroy() }
  }, [phase === 'play'])

  useEffect(() => {
    if (phase !== 'play') return
    const timer = setTimeout(() => setHeld(true), MIN_SHOW_MS)
    return () => clearTimeout(timer)
  }, [phase === 'play'])

  // Under the splash the page is out of reach (inert: no taps, no Tab, nothing read out) until it
  // starts to leave. The keys below still work: they are on the window, not in the page.
  useEffect(() => {
    if (phase !== 'play') return
    return holdPage()
  }, [phase === 'play'])

  useEffect(() => {
    if (phase !== 'play') return
    const key = e => { if (['Escape', 'Enter', ' '].includes(e.key)) setHeld(true) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [phase === 'play'])

  useEffect(() => {
    if (phase !== 'play') return
    const action = splashAction({ ready, held, drawing })
    if (action === 'leave') setPhase('leaving')
    else if (action === 'skip') setPhase('off')
  }, [phase, ready, held, drawing])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = setTimeout(() => setPhase('off'), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === 'off') return null
  return (
    <div ref={box} className={'boot-splash' + (phase === 'leaving' ? ' leaving' : '')} aria-hidden="true" onClick={() => setHeld(true)}>
      <BootMark />
      <canvas ref={canvas} className="boot-splash-canvas" />
    </div>
  )
}
