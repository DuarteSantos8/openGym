import { useEffect, useState } from 'react'

// Where the tab bar stands (Settings → Look & Home → Tab bar): 'bottom', 'right', or 'auto', the
// default, which puts it on the right edge when the screen is wider than it is tall and narrower
// than a computer's: a phone turned sideways, a foldable's wide screen. There the bottom bar took
// height the page did not have to spare, and the right edge had nothing on it. From 1000px up the
// computer layout keeps its floating bar at the bottom, unless 'right' is picked.
export const WIDE_QUERY = '(min-aspect-ratio: 1/1) and (max-width: 999px)'

export const tabbarOnSide = (pref, wide) => pref === 'right' || (pref !== 'bottom' && !!wide)

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

// A right edge this wide is not a camera cutout (an iPhone on its side keeps about 60px there):
// it is a column the system writes the time and the battery in, as the iPhone Duo's closed screen
// does (about 80px, the status block about 150px tall). There the tab bar is that column, its
// icons below the status block (index.css body.tabbar-status), instead of a bar beside it.
export const STATUS_COLUMN_MIN = 70

export const statusColumn = rightInset => Number(rightInset) >= STATUS_COLUMN_MIN

/** The right safe-area inset in px, measured as CSS sees it, kept up to date on resize. */
export function useRightInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-right:env(safe-area-inset-right,0px)'
    document.body.appendChild(probe)
    const measure = () => setInset(parseFloat(getComputedStyle(probe).paddingRight) || 0)
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure); probe.remove() }
  }, [])
  return inset
}
