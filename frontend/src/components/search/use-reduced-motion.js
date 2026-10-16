import { useSyncExternalStore } from 'react'
import { reducedMotion } from '../../lib/reduced-motion.js'

// Both signals (ui-search.md §10.0): the system's prefers-reduced-motion and Profile › Appearance ›
// Reduce motion (html[data-motion=reduce]), which `motion`'s own hook does not read.
const subscribe = fn => {
  const mql = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null
  mql?.addEventListener?.('change', fn)
  const mo = typeof MutationObserver === 'function' && typeof document !== 'undefined' ? new MutationObserver(fn) : null
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
  return () => { mql?.removeEventListener?.('change', fn); mo?.disconnect() }
}

export const useReducedMotionPref = () => useSyncExternalStore(subscribe, reducedMotion, () => false)
