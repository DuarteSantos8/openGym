import { useLayoutEffect, useRef } from 'react'
import { exitCopy } from '../lib/exit-copy.js'

let leaving = false
export const routeLeaving = v => { leaving = v }

/** A block that fades out as an inert copy when it unmounts (lib/exit-copy.js). Plan's header and Edit's bar swap with it.
 *  `when`: asked at the moment it unmounts; false makes no copy (the starred list leaves one only for Favourites off). */
export default function ExitFade({ children, when, ...props }) {
  const ref = useRef(null)
  const copy = useRef(null)
  // StrictMode (dev) runs cleanup and effect again on a block that stays: the effect drops the copy that cleanup just made.
  useLayoutEffect(() => {
    copy.current?.remove(); copy.current = null
    const n = ref.current
    return () => { if (!leaving && (!when || when())) copy.current = exitCopy(n) }
  }, [])
  return <div ref={ref} {...props}>{children}</div>
}
