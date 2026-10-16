import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../reduced-motion.js'

const easeOut = p => 1 - Math.pow(1 - p, 3)

/**
 * A number that counts to `target` over `ms` (an ease-out), from wherever it shows now, so a new
 * target mid-count carries on from there. Reduced motion and a non-number jump straight there.
 */
export function useCount(target, ms = 320) {
  const [shown, setShown] = useState(target)
  const now = useRef(target)
  useEffect(() => {
    const start = now.current
    const jump = !Number.isFinite(target) || !Number.isFinite(start) || start === target
      || reducedMotion() || typeof requestAnimationFrame !== 'function'
    if (jump) {
      now.current = target
      setShown(target)
      return undefined
    }
    let id = 0, t0 = null
    const step = time => {
      if (t0 === null) t0 = time
      const p = Math.min(1, (time - t0) / ms)
      now.current = start + (target - start) * easeOut(p)
      setShown(now.current)
      if (p < 1) id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [target, ms])
  return shown
}
