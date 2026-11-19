// Whether the window is wide enough for the desktop layout: the tab bar becomes a sidebar
// (index.css, "desktop sidebar") and Home and Admin spread into columns. Keep the width in sync
// with that media query. No matchMedia (tests, very old WebViews) reads as the phone layout.
import { useEffect, useState } from 'react'

export const DESKTOP_QUERY = '(min-width:1100px)'

const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null)

export function useDesktop() {
  const [on, setOn] = useState(() => !!query()?.matches)
  useEffect(() => {
    const mq = query()
    if (!mq) return
    const onChange = () => setOn(mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return on
}
