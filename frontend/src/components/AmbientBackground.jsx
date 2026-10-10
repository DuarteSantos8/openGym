import { useEffect, useRef } from 'react'

export default function AmbientBackground() {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    let raf = 0
    const t0 = performance.now()
    const tick = (now) => {
      const t = (now - t0) / 1000
      const x1 = Math.sin(t * 0.08) * 8
      const y1 = Math.cos(t * 0.06) * 6
      const x2 = Math.cos(t * 0.05 + 2) * 10
      const y2 = Math.sin(t * 0.07 + 1) * 8
      el.style.setProperty('--orb1-x', `${x1}vw`)
      el.style.setProperty('--orb1-y', `${y1}vh`)
      el.style.setProperty('--orb2-x', `${x2}vw`)
      el.style.setProperty('--orb2-y', `${y2}vh`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <div ref={ref} className="ambient-bg" aria-hidden="true" />
}
