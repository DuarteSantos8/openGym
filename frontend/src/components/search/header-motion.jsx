// The header's motion (fitness-eval ui-search.md §2, §10.3, §10.4), copied from bearmenu: the
// search pill's magnifier (MotionSearch), the avatar's swap to the close ×  (the city pill's
// mode="close"), and the context button stepping aside. They load with the search chunk, so the
// `motion` engine never weighs on the first paint: until then the header shows the same things
// standing still (SearchPill, AvatarButton, RootHeader).
import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m, useAnimationControls } from 'motion/react'
import { CONTENT_SPRING, EXIT_EASE, GESTURE_MS, HOLD_GRACE_MS, ICON_SWAP_SPRING, SURFACE_SPRING, beats, ease, returnTransition } from '../../lib/motion.js'
import { useReducedMotionPref } from './use-reduced-motion.js'

// The parts' pivots (the lens at its handle's end, 21,21; the dot at its centre, 11,11) are
// search.css's .mm-lens and .mm-dot, in the 24-unit viewBox (`transform-box: view-box`).
const ROOT = {
  rest: { strokeWidth: 1.75, transition: { duration: 0.18 } },
  active: { strokeWidth: 2.25, transition: { duration: 0.18 } },
  play: { strokeWidth: 2.25, transition: { duration: 0.12 } },
}
const TIMES = [0, 0.16, 0.48, 0.78, 1]
const LENS = {
  rest: { rotate: 0, transition: returnTransition },
  active: { rotate: 0, transition: returnTransition },
  play: { rotate: [0, 9, -16, 4, 0], transition: beats(TIMES, 0.6) },
}
const FOUND = {
  rest: { scale: 0, opacity: 0, transition: { duration: 0.15 } },
  active: { scale: 1, opacity: 1, transition: { duration: 0.15 } },
  play: { scale: [0, 0, 0, 1.3, 1], opacity: [0, 0, 0, 1, 1], transition: beats(TIMES, 0.6) },
}

// bearmenu's useIconGesture: mount posed without playing; pointer down plays; arriving at the
// active pose plays unless the pointer already did; leaving returns. Reduced motion skips the
// gesture and sets the pose, so the dot and the stroke still change.
function useIconGesture(active, replayToken, reduced) {
  const controls = useAnimationControls()
  const lastPlayAt = useRef(0)
  const seenToken = useRef(replayToken)
  const seenActive = useRef(null)
  const plays = useRef(0)
  const mounted = useRef(false)
  const restTimer = useRef(null)
  const clearRest = useCallback(() => { clearTimeout(restTimer.current); restTimer.current = null }, [])

  useEffect(() => {
    mounted.current = true
    controls.set(active ? 'active' : 'rest')
    seenActive.current = active
    return () => { mounted.current = false; clearRest() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const perform = useCallback(async () => {
    const id = ++plays.current
    lastPlayAt.current = Date.now()
    clearRest()
    if (reduced) { if (seenActive.current) controls.set('active'); return }
    await controls.start('play')
    if (!mounted.current || plays.current !== id) return
    if (seenActive.current) { controls.set('active'); return }
    restTimer.current = setTimeout(() => { restTimer.current = null; if (mounted.current && !seenActive.current) controls.set('rest') }, HOLD_GRACE_MS)
  }, [controls, clearRest, reduced])

  useEffect(() => {
    if (replayToken === seenToken.current) return
    seenToken.current = replayToken
    perform()
  }, [replayToken, perform])

  useEffect(() => {
    if (seenActive.current === null || seenActive.current === active) return
    seenActive.current = active
    if (reduced) { clearRest(); controls.set(active ? 'active' : 'rest'); return }
    const since = Date.now() - lastPlayAt.current
    if (!active) {
      if (since < GESTURE_MS) return
      clearRest()
      controls.start('rest')
      return
    }
    if (since < GESTURE_MS + HOLD_GRACE_MS) { clearRest(); if (since >= GESTURE_MS) controls.set('active'); return }
    perform()
  }, [active, controls, perform, clearRest, reduced])

  return controls
}

/** The pill's magnifier: sweeps on the press that opens search, holds a found dot while it is open. */
export function MotionMagnifier({ active = false, replayToken = 0, className }) {
  const reduced = useReducedMotionPref()
  const controls = useIconGesture(active, replayToken, reduced)
  return <LazyMotion features={domAnimation}>
    <m.svg viewBox="0 0 24 24" overflow="visible" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      variants={ROOT} initial={false} animate={controls} className={'icn ' + (className || '')} data-icon="magnifier" aria-hidden="true" focusable="false">
      <m.g variants={LENS} className="mm-lens">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.34-4.34" />
        <m.circle variants={FOUND} opacity={0} className="mm-dot" fill="currentColor" cx="11" cy="11" r="2.5" />
      </m.g>
    </m.svg>
  </LazyMotion>
}

// The context button's slot (ui-search.md §2). Its width carries the row's gap ahead of it
// (search.css .hdr-slot), so at 0 the pill has every pixel the button held.
const FADE_S = 0.12
const SLOT = {
  out: { width: 0, overflow: 'hidden', transition: { width: { ...CONTENT_SPRING, delay: FADE_S } } },
  in: { width: 'auto', transition: { width: SURFACE_SPRING }, transitionEnd: { overflow: 'visible' } },
}
const BUTTON = {
  out: { opacity: 0, scale: 0.8, transition: { duration: FADE_S, ease: EXIT_EASE } },
  in: { opacity: 1, scale: 1, transition: { duration: FADE_S, ease: ease.enter, delay: FADE_S / 2 } },
}
const NOW = { duration: 0 }
const SLOT_REDUCED = { out: { width: 0, overflow: 'hidden', transition: NOW }, in: { width: 'auto', transition: NOW, transitionEnd: { overflow: 'visible' } } }
const BUTTON_REDUCED = { out: { opacity: 0, transition: NOW }, in: { opacity: 1, transition: NOW } }

/** The tab's context button stepping aside while search is open: it fades and shrinks in 120 ms,
 *  then its slot closes on CONTENT_SPRING, so the pill's width follows the spring into the room
 *  instead of jumping. It comes back in reverse on SURFACE_SPRING. Reduced motion: it just goes
 *  and comes. Nothing animates on the first mount. */
export function ContextSlot({ show, children }) {
  const reduced = useReducedMotionPref()
  return <LazyMotion features={domAnimation}>
    <AnimatePresence initial={false}>
      {show && <m.div key="slot" className="hdr-slot" variants={reduced ? SLOT_REDUCED : SLOT} initial="out" animate="in" exit="out">
        <m.div className="hdr-slot-in" variants={reduced ? BUTTON_REDUCED : BUTTON}>{children}</m.div>
      </m.div>}
    </AnimatePresence>
  </LazyMotion>
}

/** The avatar's content trading places with the close ×: the outgoing one leaves before the
 *  incoming one turns in (rotate -90→0 in, 0→90 out, 280/18: a 13.5% overshoot, kept on purpose).
 *  Nothing animates on the first mount. */
export function IconSwap({ swapKey, children }) {
  const reduced = useReducedMotionPref()
  return <LazyMotion features={domAnimation}>
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={swapKey} className="avatar-c" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }} transition={reduced ? { duration: 0 } : ICON_SWAP_SPRING}>
          {children}
        </m.span>
      </AnimatePresence>
    </MotionConfig>
  </LazyMotion>
}
