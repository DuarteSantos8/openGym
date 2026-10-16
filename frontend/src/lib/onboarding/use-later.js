import { useCallback, useEffect, useRef } from 'react'

/**
 * A screen's one pending move-on (the pause after a tap before the next screen, so the choice is
 * seen). A new one replaces the old; leaving the screen cancels it.
 */
export function useLater() {
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  return useCallback((fn, ms) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }, [])
}
