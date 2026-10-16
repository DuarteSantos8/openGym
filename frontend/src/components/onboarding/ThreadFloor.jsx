import { useRef } from 'react'
import { at } from '../../lib/onboarding/art.js'
import { useThreadAnchor } from '../../lib/onboarding/use-thread-anchor.js'

// The floor a scene stands on (`M16 {y} H304`, 1.5, --sep), registered as the screen's thread
// anchor: the line the thread lands on and leaves from. `birth`: the invite's, drawn out of a dot.
export default function ThreadFloor({ y, birth = false }) {
  const ref = useRef(null)
  useThreadAnchor(ref, 'line', { birth })
  return <path ref={ref} className="il-floor" d={`M16 ${y} H304`} {...at(0)} />
}
