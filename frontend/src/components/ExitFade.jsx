import { useLayoutEffect, useRef } from 'react'
import { exitCopy } from '../lib/exit-copy.js'

/** A block that fades out as an inert copy when it unmounts (lib/exit-copy.js). Plan's header and Edit's bar swap with it. */
export default function ExitFade({ children, ...props }) {
  const ref = useRef(null)
  useLayoutEffect(() => { const n = ref.current; return () => exitCopy(n) }, [])
  return <div ref={ref} {...props}>{children}</div>
}
