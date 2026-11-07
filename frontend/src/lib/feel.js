// The iPhone's controls with liquid feedback (Liquid Glass G5, index.css "Controls with liquid
// feedback"). Pure helpers first, then the few bits of DOM the CSS cannot do. Everything here is
// the iPhone's alone: isIOS() is false on the web and on Android, where the controls stay as they
// were. Reduce Motion is the system's setting or Settings → Motion: Less, both heard through
// matchMedia (lib/display-prefs.js makes it answer yes for the app's own switch).
import { haptic } from './sound.js'
import { isIOS } from './platform-now.js'

export const reduceMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const feelOn = () => isIOS() && !reduceMotion()
/** A haptic, on the iPhone only (sound.js drops it anywhere else; the check keeps the other platforms' paths as they were). */
export const tap = kind => { if (isIOS()) haptic(kind) }

/** How a number rolls from `old` to `text`: [from, to] per column. Same length and no decimal
 *  point, only the digits that changed move; anything else (82.5 -> 85, 99 -> 100) rolls whole,
 *  so columns never misalign. */
export const rollCols = (old, text) =>
  old.length !== text.length || /\./.test(old + text) ? [[old, text]] : [...text].map((c, i) => [old[i], c])

// Holding a stepper button: the iPhone waits 420 ms, then repeats every 150 ms, speeding up to 55.
// Elsewhere it is what it always was: 400 ms, then every 80 ms, every 40 after 15 steps.
export const HOLD_MS = 420
export const repeatDelay = done => Math.max(55, 150 - done * 10)
// (the old code waited 400 ms and only then started its 80 ms interval, so its first repeat came at 480)
const legacy = { hold: 480, next: done => (done >= 15 ? 40 : 80) }

let stepAt = 0
let tm = null
let held = false
let stopAt = 0
const stop = () => { if (tm) stopAt = Date.now(); clearTimeout(tm); tm = null }
export const stopHold = stop

/** One step of a stepper, wherever it came from (tap, hold, arrow key, VoiceOver). `step(dir)`
 *  answers false when the value is at its limit: that is one light haptic and the hold stops. */
export function stepOnce(step, dir) {
  stepAt = Date.now()
  const moved = step(dir)
  tap(moved === false ? 'light' : 'selection')
  return moved
}

/** Pointer props for a - / + button. The click does the first step (so VoiceOver and the
 *  keyboard work); holding repeats, and sliding the finger off the button stops it. `repeat`
 *  false (set rows off the iPhone) is the plain click it was. */
export function holdProps(step, dir, repeat = true) {
  if (!repeat) return { onClick: () => step(dir) }
  const t = isIOS() ? { hold: HOLD_MS, next: repeatDelay } : legacy
  return {
    onPointerDown: e => {
      if (e.button) return
      stop(); held = false
      let done = 0
      const again = () => {
        held = true
        if (stepOnce(step, dir) === false) return stop()
        tm = setTimeout(again, t.next(++done))
      }
      tm = setTimeout(again, t.hold)
    },
    // A touch keeps the pointer on the button when the finger slides off, so leave never fires.
    onPointerMove: e => {
      if (!isIOS()) return // elsewhere only leaving the button stops a hold, as it always did
      const r = e.currentTarget.getBoundingClientRect()
      if (e.clientX < r.left - 4 || e.clientX > r.right + 4 || e.clientY < r.top - 2 || e.clientY > r.bottom + 2) stop()
    },
    onPointerUp: stop, onPointerCancel: stop, onPointerLeave: stop, onBlur: stop,
    // The click that follows a hold that repeated must not add a step.
    // `held` goes stale when no click follows (slid off, limit, cancel), so it only counts just after the stop.
    onClick: () => { const swallow = held && Date.now() - stopAt < 500; held = false; if (!swallow) stepOnce(step, dir) },
  }
}

/** A number field rolls like a counter when a - / + (or an arrow key) moved it, never when typed
 *  into: `old` and `text` are what it showed before and now. The roll is an aria-hidden overlay
 *  over the real input for 320 ms; a screen reader only ever hears the real value. */
export function rollField(inp, old, text) {
  if (!inp?.animate || Date.now() - stepAt > 700 || old === text || !feelOn() || document.activeElement === inp) return
  const val = inp.parentElement
  const up = parseFloat(text) >= parseFloat(old)
  const cs = getComputedStyle(inp)
  const ov = document.createElement('span')
  ov.className = 'roll'; ov.setAttribute('aria-hidden', 'true')
  Object.assign(ov.style, {
    left: inp.offsetLeft + 'px', top: inp.offsetTop + 'px', width: inp.offsetWidth + 'px', height: inp.offsetHeight + 'px',
    fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing,
    justifyContent: { right: 'flex-end', end: 'flex-end', left: 'flex-start', start: 'flex-start' }[cs.textAlign] || 'center',
  })
  let last
  rollCols(old, text).forEach(([o, c]) => {
    if (o === c) { const s = document.createElement('span'); s.textContent = c; ov.append(s); return }
    const w = document.createElement('span'), col = document.createElement('span')
    w.className = 'roll-r'; col.className = 'roll-c'
    ;(up ? [o, c] : [c, o]).forEach(x => { const s = document.createElement('span'); s.textContent = x; col.append(s) })
    w.append(col); ov.append(w)
    last = col.animate(up ? [{ transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }] : [{ transform: 'translateY(-50%)' }, { transform: 'translateY(0)' }],
      { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'both' })
  })
  if (!last) return
  val.querySelectorAll(':scope > .roll').forEach(n => n.remove())
  val.append(ov)
  inp.style.color = 'transparent'
  const end = () => { ov.remove(); if (!val.querySelector(':scope > .roll')) inp.style.color = '' }
  last.finished.then(end, end)
}

// The set tick (components/ui.jsx Check with `pop`): the circle pops with six dots and the row
// lifts, once. Only the user's own tap gets here: a set ticked by sync, the watch or the
// programme changes `checked` without a click, so it gets nothing. The haptic is in Workout's
// toggle(), in the same tap. The classes go on after React has painted the new state, which
// would otherwise wipe them with the className it sets.
let tickAt = 0
/** True within a moment of the user's own tick: a record trophy mounting now sparkles. */
export const recentTick = () => Date.now() - tickAt < 600
export function tickFeel(btn) {
  tickAt = Date.now()
  if (!feelOn()) return
  queueMicrotask(() => {
    // a tap that opened a question instead (odd weights) ticked nothing
    if (btn.getAttribute('aria-checked') !== 'true') return
    const row = btn.closest('.setrow')
    for (const [el, cls] of [[btn, 'pop'], [row, 'lift']]) {
      if (!el) continue
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls)
      const done = e => { if (e.target !== el) return; el.classList.remove(cls); el.removeEventListener('animationend', done) }
      el.addEventListener('animationend', done)
    }
  })
}

const LIT = '.btn,.chip,.seg button,.stp button,.chk,.ck,.sw'
/** Once, at start: the press light follows the finger (CSS reads --px and --py), and a chip tap is a
 *  selection haptic. */
export function initFeel() {
  if (!isIOS()) return
  document.addEventListener('pointerdown', e => {
    const c = e.target.closest?.(LIT)
    if (!c) return
    const r = c.getBoundingClientRect()
    c.style.setProperty('--px', e.clientX - r.left + 'px'); c.style.setProperty('--py', e.clientY - r.top + 'px')
  }, { passive: true })
  // a chip that picks something changes (aria-pressed or .on) in this tap; one that opens a sheet or navigates stays silent
  const state = c => c.getAttribute('aria-pressed') + c.classList.contains('on')
  let chip, before
  document.addEventListener('click', e => { chip = e.target.closest?.('.chip'); before = chip && state(chip) }, true)
  document.addEventListener('click', () => { const c = chip, b = before; if (c && !c.disabled) setTimeout(() => { if (c.isConnected && state(c) !== b) tap('selection') }) })
}
