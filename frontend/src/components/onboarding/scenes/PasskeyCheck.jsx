import { useEffect, useRef } from 'react'
import { reducedMotion } from '../../../lib/reduced-motion.js'
import { useThreadAnchor } from '../../../lib/onboarding/use-thread-anchor.js'

// 1b Passkey saved (unchanged from v1, "perfect"): a lit disc, an arc that closes round it, and the
// check. The key's blade arrives as the thread and bends into the check (data-pts, data-k: where
// the check sits as the disc pops from .92). Without the thread the check draws itself.
const EASE_IO = 'cubic-bezier(.65,0,.35,1)'
const EASE_POP = 'cubic-bezier(.34,1.56,.64,1)'

export default function PasskeyCheck() {
  const check = useRef(null), arc = useRef(null), pop = useRef(null)
  useThreadAnchor(check, 'check')
  useEffect(() => {
    if (reducedMotion() || !arc.current?.animate) return
    const runs = [
      arc.current.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 480, easing: EASE_IO, fill: 'backwards' }),
      pop.current.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 360, delay: 480, easing: EASE_POP, fill: 'backwards' }),
    ]
    // The thread supplies the check when it carried the key's blade here.
    if (!check.current.hasAttribute('data-thread-claim')) {
      runs.push(check.current.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 220, delay: 480, easing: 'ease-out', fill: 'backwards' }))
    }
    return () => runs.forEach(r => r.cancel())
  }, [])
  return (
    <svg className="ob-pass-svg" viewBox="0 0 88 88" aria-hidden="true" focusable="false">
      <g ref={pop} className="ob-pass-pop">
        <circle className="ob-pass-disc" cx="44" cy="44" r="44" />
        <circle ref={arc} className="ob-pass-arc" cx="44" cy="44" r="42.5" pathLength="1" strokeDasharray="1" transform="rotate(-90 44 44)" />
        <path ref={check} className="ob-pass-chk" data-pts="28 45.5 39 56 60 33" data-k=".92" d="M28 45.5 39 56 60 33" pathLength="1" strokeDasharray="1" />
      </g>
    </svg>
  )
}
