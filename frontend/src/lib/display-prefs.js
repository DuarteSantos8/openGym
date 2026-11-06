// Settings → Look & Home → Motion and Text size (v1.4.5): the app's own switches, on top of the
// phone's. Kept per device (localStorage), since a phone and a laptop want different sizes, and
// applied before the first render (main.jsx), so nothing jumps.
//
// Motion 'less' does what the system's "Reduce motion" does: every CSS animation and transition
// ends at once (the .reduce-motion rule in index.css), and every place in the app that asks
// matchMedia('(prefers-reduced-motion: reduce)') hears yes, which is how the swipes, the tour,
// the seasonal snow and the timers already decide. One switch, no second code path to forget.
// Text size scales the root font size: the type scale (--fs-* in index.css) is in rem.
const KEY = 'gym_display'
export const TEXT_SIZES = { small: 0.9, default: 1, large: 1.12, larger: 1.25 }
const MOTIONS = ['system', 'less']
const QUERY = /prefers-reduced-motion\s*:\s*reduce/

export function readDisplay() {
  let v = null
  try { v = JSON.parse(localStorage.getItem(KEY)) } catch { /* nothing saved, or no storage */ }
  return {
    motion: MOTIONS.includes(v?.motion) ? v.motion : 'system',
    text: Object.hasOwn(TEXT_SIZES, v?.text) ? v.text : 'default',
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
    const k = TEXT_SIZES[d.text] || 1
    if (k === 1) root.style.removeProperty('font-size'); else root.style.fontSize = (k * 100) + '%'
  }
  if (save) { try { localStorage.setItem(KEY, JSON.stringify({ motion: d.motion, text: d.text })) } catch { /* private mode */ } }
  return d
}

/** For the tests. */
export function _resetDisplay() { less = false; patched = false }
