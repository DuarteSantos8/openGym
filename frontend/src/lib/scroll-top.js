// Getting back to the top of a long page: the tab bar's re-tap (components/TabBar.jsx) and the
// floating button (components/ScrollTopButton.jsx). The app scrolls the window, not a container
// (App.jsx records and restores window.scrollY per route), so both go through window.scrollTo and
// the route's remembered position simply follows from the scroll events that come out of it.

const reducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// Within a few pixels counts as the top: iOS rubber-banding leaves a fraction behind.
export const AT_TOP = 4

// Shown once the page is this many screens down, gone again under HIDE_AT: the gap between the two
// keeps it from flickering while you hover around one line.
export const SHOW_AT = 2.5
export const HIDE_AT = 1

// How long a glide gets before it is checked on. WebKit (the iPhone app, Safari) drops a smooth
// scroll that starts while the page is still settling: from the very bottom, where the rubber band
// or the page getting shorter under it (the button's own bottom room, body.totop-on) clamps the
// position, the glide was cancelled on its first frame and the tap did nothing (TestFlight 11-08).
// A glide that has not moved by then is finished as a jump.
export const GLIDE_CHECK_MS = 120
export const GLIDE_GIVE_UP_MS = 900

let pending = 0
/** Drops a glide check still waiting (a new glide, or a test that starts over). */
export function cancelGlideCheck() { clearTimeout(pending); pending = 0 }

export function scrollToTop({ win = window } = {}) {
  cancelGlideCheck()
  const from = win.scrollY || 0
  // Reduce Motion: a jump, not a glide through three screens of thumbnails.
  if (reducedMotion()) { win.scrollTo({ top: 0, left: 0, behavior: 'auto' }); return }
  win.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  if (from <= AT_TOP) return
  const started = Date.now()
  let last = from
  const check = () => {
    pending = 0
    const y = win.scrollY || 0
    if (y <= AT_TOP) return
    // Not moving (dropped, or a momentum flick that won): jump the rest of the way.
    if (y >= last - 1 || Date.now() - started >= GLIDE_GIVE_UP_MS) { win.scrollTo(0, 0); return }
    last = y
    pending = setTimeout(check, GLIDE_CHECK_MS)
  }
  pending = setTimeout(check, GLIDE_CHECK_MS)
}

// A sheet pins the body (Modals.jsx) and the page beneath it is not the one to move.
const sheetOpen = () => document.body.style.position === 'fixed'

// The tab you are on, tapped again (the iOS convention): to the top of its page, and from the top
// of Exercises into its search field, the way most apps with a list and a search do it.
export function retapTab(path) {
  if (sheetOpen()) return
  if (window.scrollY > AT_TOP) { scrollToTop(); return }
  if (path === '/library') document.querySelector('#app > .page:not(.under) .search input')?.focus()
}
