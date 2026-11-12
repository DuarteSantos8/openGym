// Settings → Look & Home → Motion and Text size (v1.4.5): the app's own switches, on top of the
// phone's. Kept per device (localStorage), since a phone and a laptop want different sizes, and
// applied before the first render (main.jsx), so nothing jumps.
//
// Motion 'less' does what the system's "Reduce motion" does: every CSS animation and transition
// ends at once (the .reduce-motion rule in index.css), and every place in the app that asks
// matchMedia('(prefers-reduced-motion: reduce)') hears yes, which is how the swipes, the tour,
// the seasonal snow and the timers already decide. One switch, no second code path to forget.
// Text size scales the root font size: the type scale (--fs-* in index.css) is in rem.
// Glass off (iPhone, Liquid Glass G9) sets <html data-reduce-transparency>, the hook the glass
// fallbacks in index.css already answer for Reduce Transparency: every bar and sheet goes solid.
//
// "Default" follows the phone's own text size where the shell tells us (systemTextScale):
// Android's font scale and iOS Dynamic Type. The shells stop their WebView from scaling text by
// itself (Android's textZoom pinned to 100 in TextScalePlugin.java; a WKWebView never followed
// Dynamic Type for our own font), so the page does it once, here, and rem-based spacing grows with
// the words instead of only the glyphs. The other sizes are fixed: a pick is a pick, it does not
// multiply with the phone's (which made "Larger" on an already large phone unreadable twice over).
const KEY = 'gym_display'
export const TEXT_SIZES = { smallest: 0.82, small: 0.9, default: 1, large: 1.12, larger: 1.25, largest: 1.4 }
// What "Default" may become from the phone: the same span as the picks, so the layouts audited at
// Smallest and Largest hold for every phone. Android 14 goes up to 200 % and iOS's accessibility
// sizes past 300 %; those people get Largest, and the system's own zoom for the rest.
export const SYSTEM_MIN = 0.82
export const SYSTEM_MAX = 1.4
export const TEXT_SCALE_EVENT = 'opengym:text-scale'

/**
 * The phone's text size as a factor (1 = the platform's default), or 1 where nobody says (the web:
 * there the browser's own font size setting already moves the root size, which is in %).
 * Android: window.OpenGymText.scale(), live (TextScalePlugin.java). iOS: window.__ogTextScale, set
 * before the page runs and again when Dynamic Type changes (MainViewController.swift).
 */
export function systemTextScale(win = globalThis) {
  let k = null
  try {
    const a = win?.OpenGymText
    if (a && typeof a.scale === 'function') k = Number(a.scale())
  } catch { /* the bridge went away */ }
  if (!(k > 0)) k = Number(win?.__ogTextScale)
  if (!(k > 0) || !Number.isFinite(k)) return 1
  return Math.min(SYSTEM_MAX, Math.max(SYSTEM_MIN, Math.round(k * 100) / 100))
}

/** The factor a choice comes to on this device. */
export function textScaleFor(text, win = globalThis) {
  if (text === 'default' || !Object.hasOwn(TEXT_SIZES, text)) return systemTextScale(win)
  return TEXT_SIZES[text]
}

/** Whether the shell tells us the phone's text size (then "Default" reads "Like the phone"). */
export function followsSystemText(win = globalThis) {
  return typeof win?.OpenGymText?.scale === 'function' || Number(win?.__ogTextScale) > 0
}
const MOTIONS = ['system', 'less']
const QUERY = /prefers-reduced-motion\s*:\s*reduce/

export function readDisplay() {
  let v = null
  try { v = JSON.parse(localStorage.getItem(KEY)) } catch { /* nothing saved, or no storage */ }
  return {
    motion: MOTIONS.includes(v?.motion) ? v.motion : 'system',
    text: Object.hasOwn(TEXT_SIZES, v?.text) ? v.text : 'default',
    glass: v?.glass !== false,
  }
}

let less = false
let patched = false
function patchMatchMedia(win) {
  if (patched || typeof win?.matchMedia !== 'function') return
  patched = true
  const orig = win.matchMedia
  win.matchMedia = function (q) {
    const real = orig.call(win, q)
    if (!less || !QUERY.test(String(q))) return real
    // The same object with `matches` saying yes: listeners still work on the real one.
    return new Proxy(real, { get: (o, k) => (k === 'matches' ? true : typeof o[k] === 'function' ? o[k].bind(o) : o[k]) })
  }
}

/** Applies a display choice to the page (and remembers it when `save`). */
export function applyDisplay(d = readDisplay(), { save = false, win = globalThis } = {}) {
  less = d.motion === 'less'
  patchMatchMedia(win)
  const root = win?.document?.documentElement
  if (root) {
    root.classList.toggle('reduce-motion', less)
    root.toggleAttribute('data-reduce-transparency', d.glass === false)
    const k = textScaleFor(d.text, win)
    if (k === 1) root.style.removeProperty('font-size'); else root.style.fontSize = Math.round(k * 100) + '%'
    // For the few things that size themselves in px from JS (canvas charts): the same factor.
    root.style.setProperty('--text-k', String(k))
  }
  listenForSystem(win)
  if (save) { try { localStorage.setItem(KEY, JSON.stringify({ motion: d.motion, text: d.text, glass: d.glass !== false })) } catch { /* private mode */ } }
  return d
}

// The phone's size changed while the app was open (iOS posts an event, Android is asked again
// whenever the app comes back to the front): "Default" follows at once.
let listening = false
function listenForSystem(win) {
  if (listening || typeof win?.addEventListener !== 'function') return
  listening = true
  const again = () => { if (readDisplay().text === 'default') applyDisplay(readDisplay(), { win }) }
  win.addEventListener(TEXT_SCALE_EVENT, again)
  win.document?.addEventListener?.('visibilitychange', () => { if (win.document.visibilityState === 'visible') again() })
}

/** For the tests. */
export function _resetDisplay() { less = false; patched = false; listening = false }
