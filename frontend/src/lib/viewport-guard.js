/* The iOS keyboard leaves the page displaced.
 *
 * On iOS Safari (and the home-screen PWA) the keyboard does not resize the layout viewport;
 * it scrolls the page so the focused field is visible, even when the body is pinned by an
 * open sheet. When the keyboard goes away again, the scroll it made is not always undone:
 * the layout viewport stays offset inside the screen, everything `position:fixed` — the tab
 * bar, the rest timer — sits where the layout viewport ends, i.e. mid-screen, and the page's
 * first rows hide under the status bar. It stays like that until something scrolls.
 *
 * The exercise picker is where it bites: search, tap "+", the sheet stays open, the keyboard
 * closes — and the sheet's own restore (Modals.jsx) has not run because nothing closed. So the
 * correction lives here, on the window, and fires whenever the keyboard has just gone away or
 * a text field lost focus: if the visual viewport is not where the layout viewport is, ask for
 * the scroll position we already have. iOS treats that as a scroll and realigns the viewports;
 * on every other platform it is a no-op.
 */
const KEYBOARD_MIN_PX = 100
const SETTLE_MS = 350   // the keyboard's dismiss animation; the offset is only wrong after it

const isText = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

export function viewportDisplacement(win = window) {
  const vv = win.visualViewport
  if (!vv) return 0
  const offset = vv.offsetTop || 0
  const scrolledPast = (vv.pageTop || 0) - (win.scrollY || 0)
  return Math.max(offset, scrolledPast)
}

export function keyboardOpen(win = window) {
  const vv = win.visualViewport
  if (!vv) return false
  return (win.innerHeight - vv.height) > KEYBOARD_MIN_PX
}

/** Realign the viewports if iOS left them apart. Returns true when a correction was issued. */
export function realign(win = window) {
  if (keyboardOpen(win)) return false
  if (isText(win.document.activeElement)) return false
  if (viewportDisplacement(win) <= 1) return false
  win.scrollTo(win.scrollX || 0, win.scrollY || 0)
  return true
}

export function installViewportGuard(win = window) {
  const vv = win.visualViewport
  if (!vv) return () => {}
  let wasOpen = keyboardOpen(win)
  const timers = new Set()
  const later = (fn, ms) => { const t = win.setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }
  const settle = () => { realign(win); later(() => realign(win), SETTLE_MS) }

  const onResize = () => {
    const open = keyboardOpen(win)
    if (wasOpen && !open) settle()
    wasOpen = open
  }
  const onScroll = () => { if (!wasOpen) realign(win) }
  const onFocusOut = e => { if (isText(e.target)) settle() }

  vv.addEventListener('resize', onResize)
  vv.addEventListener('scroll', onScroll)
  win.document.addEventListener('focusout', onFocusOut)
  return () => {
    vv.removeEventListener('resize', onResize)
    vv.removeEventListener('scroll', onScroll)
    win.document.removeEventListener('focusout', onFocusOut)
    timers.forEach(t => win.clearTimeout(t))
  }
}
