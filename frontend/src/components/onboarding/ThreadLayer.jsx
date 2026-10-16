import { useContext } from 'react'
import { ThreadContext } from '../../lib/onboarding/contexts.js'

// The one overlay path the thread is drawn with, between screens only (lib/onboarding/thread-engine.js).
// Decorative and untouchable. It mounts in the onboarding layout and nowhere else.
export default function ThreadLayer() {
  const thread = useContext(ThreadContext)
  if (!thread) throw new Error('ThreadLayer: the thread layer mounts only in the onboarding layout')
  return (
    <svg ref={thread.svg} className="ob-thread" aria-hidden="true" focusable="false" data-anchors="0">
      <path ref={thread.path} />
    </svg>
  )
}
