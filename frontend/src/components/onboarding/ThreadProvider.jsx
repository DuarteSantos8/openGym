import { useEffect, useMemo, useRef } from 'react'
import { ThreadContext } from '../../lib/onboarding/contexts.js'
import { createThreadEngine } from '../../lib/onboarding/thread-engine.js'
import { reducedMotion } from '../../lib/reduced-motion.js'
import { useUI } from '../../store/useUI.js'

// The thread's owner for the whole flow: it outlives every screen, so the line one screen rests on
// is where the next screen's thread starts. `navRef` is the nav row: the layer is clipped below it
// and above the screen's footer, so the thread never paints over the bar or a call to action.
export default function ThreadProvider({ navRef, children }) {
  const svg = useRef(null)
  const path = useRef(null)
  const engine = useMemo(() => createThreadEngine({
    layer: () => ({ svg: svg.current, path: path.current }),
    // A stale rect is the failure mode: with the keyboard up or a sheet open, no morph.
    blocked: () => reducedMotion() || document.body.classList.contains('kb-open') || useUI.getState().sheets.length > 0,
    clip: el => ({
      top: navRef.current ? navRef.current.getBoundingClientRect().bottom : 0,
      bottom: el.closest('.ob-screen')?.querySelector('.ob-foot')?.getBoundingClientRect().top ?? window.innerHeight,
    }),
    onCount: n => svg.current?.setAttribute('data-anchors', String(n)),
  }), [navRef])

  // A resize, a return to the tab or reduced motion switched on mid-run: finish and snap.
  useEffect(() => {
    const finish = () => engine.finish()
    const onVisible = () => { if (document.visibilityState === 'visible') finish() }
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    window.addEventListener('resize', finish)
    document.addEventListener('visibilitychange', onVisible)
    mq?.addEventListener?.('change', finish)
    return () => {
      window.removeEventListener('resize', finish)
      document.removeEventListener('visibilitychange', onVisible)
      mq?.removeEventListener?.('change', finish)
      engine.abort()
    }
  }, [engine])

  const value = useMemo(() => ({ register: engine.register, svg, path }), [engine])
  return <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
}
