import { useCallback, useEffect, useState } from 'react'

// The top safe-area inset (index.css --sat) in px: a sticky bar sits below it.
function safeTopPx() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 0
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat'))
  return Number.isFinite(v) ? v : 0
}

/**
 * [ref, past]: `past` is true once the element given to `ref` has scrolled up under a sticky bar
 * `barPx` tall (below the safe-area inset). `ref` is a callback ref, so an element that mounts
 * later (a card that waits for its data) is observed when it appears, and a replaced one is
 * swapped. False where IntersectionObserver is missing: the element then counts as visible.
 */
export function useScrolledPast(barPx = 0) {
  const [node, setNode] = useState(null)
  const [past, setPast] = useState(false)
  const ref = useCallback(el => setNode(el), [])
  useEffect(() => {
    if (!node || typeof IntersectionObserver !== 'function') { setPast(false); return undefined }
    const top = barPx + safeTopPx()
    const io = new IntersectionObserver(([entry]) => {
      setPast(!entry.isIntersecting && entry.boundingClientRect.top < top)
    }, { rootMargin: `-${top}px 0px 0px 0px` })
    io.observe(node)
    return () => io.disconnect()
  }, [node, barPx])
  return [ref, past]
}
