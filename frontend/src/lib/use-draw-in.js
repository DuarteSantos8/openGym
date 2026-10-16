import { useEffect, useState } from 'react'
import { reducedMotion } from './reduced-motion.js'

// A line-art scene draws itself in the first time it shows in a session and is simply there after
// that (fitness-eval ui-onboarding-round2 §1). Under reduced motion it fades in instead.
const drawn = new Set()

/** The class the scene's svg takes this time: 'il-draw', 'rm-fade', or null once it has shown. */
const modeOf = key => (drawn.has(key) ? null : reducedMotion() ? 'rm-fade' : 'il-draw')
export function useDrawIn(key) {
  const [shown, setShown] = useState(() => ({ key, mode: modeOf(key) }))
  // the same element showing another scene: that scene's own first time
  if (shown.key !== key) setShown({ key, mode: modeOf(key) })
  useEffect(() => { drawn.add(key) }, [key])
  return shown.key === key ? shown.mode : modeOf(key)
}

/** Forget what has been drawn (tests). */
export const resetDrawIn = () => drawn.clear()
