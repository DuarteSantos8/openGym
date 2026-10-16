import { useLayoutEffect, useRef, useState } from 'react'
import { useThreadAnchor } from '../../lib/onboarding/use-thread-anchor.js'

// 5a: the line the seven day tiles stand on (UI decision 2), 8 below them, spanning the row
// exactly: its viewBox is the measured width, so the round caps end flush. The screen's anchor.
export default function StarterBaseline() {
  const svg = useRef(null)
  const line = useRef(null)
  const [w, setW] = useState(320)
  useLayoutEffect(() => {
    const el = svg.current
    if (!el) return undefined
    const fit = () => { const width = Math.round(el.getBoundingClientRect().width * 100) / 100; if (width > 2) setW(width) }
    fit()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [])
  useThreadAnchor(line, 'line')
  return (
    <svg ref={svg} className="ob-pl-base" viewBox={`0 0 ${w} 2`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path ref={line} d={`M0.75 1 H${w - 0.75}`} />
    </svg>
  )
}
