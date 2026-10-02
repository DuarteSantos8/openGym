/* The soft keyboard on Android 15. An app that targets it is drawn edge to edge, and then
   adjustResize no longer shrinks the window when the keyboard comes up: innerHeight and the
   visualViewport keep their full height, so nothing on the page can tell that the bottom third
   of the screen is keys. First-launch "Connect to my server" and Home → Body weight had their
   inputs and buttons under the keyboard (Android QA, v1.3.9).

   MainActivity.keyboardScript passes the covered height as --native-kb on <html> (CSS pixels,
   0px when the keyboard is down), sets data-native-kb while it is up, and fires
   'opengym:native-keyboard'. The stylesheet lifts sheets and pads the page by it; this module
   keeps the focused field in view. Older Android versions still resize the window, never get
   the variable, and read 0 here — nothing changes for them, nor in a browser or on iOS. */

export const NATIVE_KEYBOARD_EVENT = 'opengym:native-keyboard'

// Room left between a revealed field and the keyboard's top edge.
const MARGIN = 16

export function nativeKeyboardHeight(doc = typeof document !== 'undefined' ? document : null) {
  const el = doc?.documentElement
  if (!el?.style) return 0
  const v = parseFloat(el.style.getPropertyValue('--native-kb'))
  return Number.isFinite(v) && v > 0 ? v : 0
}

/* The part of the screen the keyboard leaves: the visual viewport where the system shrinks it,
   the layout viewport less --native-kb where it does not, whichever is smaller. */
export function visibleBottom(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return 0
  const vv = win.visualViewport
  const visual = vv ? (vv.offsetTop || 0) + (vv.height || win.innerHeight) : win.innerHeight
  return Math.min(visual, win.innerHeight - nativeKeyboardHeight(win.document))
}

function scrollsVertically(el, win) {
  if (!el || el.nodeType !== 1) return false
  if (el.classList?.contains('sheet')) return true
  const oy = win.getComputedStyle?.(el)?.overflowY
  return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight
}

/* Scroll the nearest scrollable ancestor (the sheet, most often; the page otherwise) just
   enough that `el` sits above the keyboard. Only that one scroller moves: scrollIntoView would
   walk every ancestor and, with the layout viewport still full height, think the field visible.
   Returns the distance scrolled, 0 when the field was already clear. */
export function revealAboveKeyboard(el, win = typeof window !== 'undefined' ? window : null) {
  if (!el || !win || typeof el.getBoundingClientRect !== 'function') return 0
  const doc = win.document
  let scroller = el.parentElement
  while (scroller && scroller !== doc.body && scroller !== doc.documentElement && !scrollsVertically(scroller, win)) {
    scroller = scroller.parentElement
  }
  const page = !scroller || scroller === doc.body || scroller === doc.documentElement
  const r = el.getBoundingClientRect()
  let bottom = visibleBottom(win) - MARGIN
  let top = MARGIN
  if (!page) {
    const s = scroller.getBoundingClientRect()
    bottom = Math.min(bottom, s.bottom - MARGIN)
    top = Math.max(top, s.top + MARGIN)
  }
  let delta = 0
  if (r.bottom > bottom) delta = r.bottom - bottom
  // A tall field (a textarea) keeps its top on screen rather than its foot.
  if (r.top - delta < top) delta = r.top - top
  if (!delta) return 0
  if (page) {
    const se = doc.scrollingElement || doc.documentElement
    const before = se.scrollTop
    win.scrollTo?.(0, before + delta)
    return (se.scrollTop || 0) - before || delta
  }
  const before = scroller.scrollTop || 0
  scroller.scrollTop = before + delta
  return (scroller.scrollTop || 0) - before
}

const isField = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''))

/* Installed once at start-up. Does anything only while --native-kb is above 0, so where the
   system resizes the window (Android 14 and older, iOS, browsers) the WebView's own
   reveal-on-focus keeps doing the work. */
export function startNativeKeyboard(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.addEventListener) return () => {}
  let frame = 0
  const reveal = () => {
    if (frame) (win.cancelAnimationFrame || clearTimeout)(frame)
    // After the sheet has taken its new bottom: one frame for the style, one for layout.
    frame = (win.requestAnimationFrame || (f => setTimeout(f, 16)))(() => {
      frame = 0
      const el = win.document.activeElement
      if (nativeKeyboardHeight(win.document) > 0 && isField(el)) revealAboveKeyboard(el, win)
    })
  }
  const onFocus = e => { if (isField(e.target)) reveal() }
  win.addEventListener(NATIVE_KEYBOARD_EVENT, reveal)
  win.document.addEventListener('focusin', onFocus)
  return () => {
    win.removeEventListener(NATIVE_KEYBOARD_EVENT, reveal)
    win.document.removeEventListener('focusin', onFocus)
  }
}
