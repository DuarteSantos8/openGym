import { useContext, useLayoutEffect } from 'react'
import { ThreadContext } from './contexts.js'

/**
 * Registers a scene's line as the thread's anchor for this screen (motion-onboarding-thread.md §4,
 * "Per-route contract"): `ref` is the svg path, `form` 'line' | 'blade' | 'check'. In a layout
 * effect, so the line is claimed before the first paint and the thread can carry it in. Every
 * onboarding screen registers exactly one (onboarding-guards.test.jsx). Under reduced motion the
 * thread never runs and the scene shows its own line.
 */
export function useThreadAnchor(ref, form, { birth = false } = {}) {
  const thread = useContext(ThreadContext)
  if (!thread) throw new Error('useThreadAnchor: a thread anchor belongs inside the onboarding layout')
  const { register } = thread
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    el.setAttribute('data-thread', form)
    return register(el, { birth })
  }, [register, ref, form, birth])
}
