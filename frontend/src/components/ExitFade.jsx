import { useLayoutEffect, useRef } from 'react'
import { exitCopy } from '../lib/exit-copy.js'

let leaving = false
export const routeLeaving = v => { leaving = v }

/** A block that fades out as an inert copy when it unmounts (lib/exit-copy.js). Plan's header and Edit's bar swap with it.
 *  `when`: asked at the moment it unmounts; false makes no copy (the starred list leaves one only for Favourites off). */
export default function ExitFade({ children, when, ...props }) {
  const ref = useRef(null)
  useLayoutEffect(() => { const n = ref.current; return () => { if (!leaving && (!when || when())) exitCopy(n) } }, [])
  return <div ref={ref} {...props}>{children}</div>
}
