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
  if (viewportDisplacement(win) <= 1) return false
  // Never touch a page while a text field has focus — no blur, no scroll, no unpin (issue #242).
  // `keyboardOpen` cannot be trusted mid-animation: both sides of its subtraction move, because
  // the browser chrome collapses while the keyboard comes up. Measured on iOS 26.6 with the
  // keyboard animating in, `innerHeight` fell 684 → 374 while the visual viewport sat at 158,
  // so the difference dropped back under the threshold and the keyboard read as closed about
  // 100 ms after every tap. This used to blur the field there, which is why the login sheet's
  // name and invite-code fields threw the keyboard straight back out.
  // Nothing is lost by standing down: the correction still runs on `focusout`, which is when
  // iOS actually needs it, and the two cases the blur was written for let go of the field
  // themselves — Workout.jsx blurs when a set is ticked, Modals.jsx when a sheet opens.
  if (isText(win.document.activeElement)) return false
  if (bodyPinned(win)) return realignPinned(win)
  win.scrollTo(win.scrollX || 0, win.scrollY || 0)
  return true
}

const bodyPinned = win => win.document.body?.style?.position === 'fixed'

/** The same correction while Modals.jsx has the body pinned (`position:fixed; top:-y`): the
 *  document has no scroll range then, so asking for the current position is a no-op and iOS
 *  keeps the offset — the picker sheet left open after the keyboard closed. Let the page scroll
 *  for one call, land it where the pin says it was, and pin it again. */
export function realignPinned(win = window) {
  const b = win.document.body?.style
  if (!b || b.position !== 'fixed') return false
  const top = b.top
  const y = Math.max(0, -parseFloat(top || '0') || 0)
  b.position = ''
  win.scrollTo(win.scrollX || 0, y)
  b.top = top
  b.position = 'fixed'
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
  // Back on screen after a lock or an app switch. A page that kept running while hidden (a rest
  // timer holds the audio session, and iOS keeps a page playing audio alive) was laid out against
  // a viewport iOS was not showing, and can come back with the two viewports apart — the tab bar
  // and the timer bar sitting mid-page and scrolling with it — with no resize, scroll or focus
  // event to bring the checks above. So the return itself is one.
  const onVisible = () => { if (!win.document.hidden) settle() }

  vv.addEventListener('resize', onResize)
  vv.addEventListener('scroll', onScroll)
  win.document.addEventListener('focusout', onFocusOut)
  win.document.addEventListener('visibilitychange', onVisible)
  return () => {
    vv.removeEventListener('resize', onResize)
    vv.removeEventListener('scroll', onScroll)
    win.document.removeEventListener('focusout', onFocusOut)
    win.document.removeEventListener('visibilitychange', onVisible)
    timers.forEach(t => win.clearTimeout(t))
  }
}
