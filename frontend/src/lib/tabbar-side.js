import { useEffect, useState } from 'react'

// Where the tab bar stands: on the right edge when the screen is wider than it is tall and
// narrower than a computer's: a phone turned sideways, a foldable's wide screen. There the bottom
// bar took height the page did not have to spare, and the right edge had nothing on it. From
// 1000px up the computer layout keeps its floating bar at the bottom.
export const WIDE_QUERY = '(min-aspect-ratio: 1/1) and (max-width: 999px)'

/** Whether WIDE_QUERY matches now, kept up to date as the screen turns or the window resizes. */
export function useWideScreen() {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null
  const [wide, setWide] = useState(() => !!query()?.matches)
  useEffect(() => {
    const mq = query()
    if (!mq) return
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return wide
}
