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

export function scrollToTop() {
  // Reduce Motion: a jump, not a glide through three screens of thumbnails.
  window.scrollTo({ top: 0, left: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
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
