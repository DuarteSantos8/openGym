// FLIP for list moves: measure each keyed row before a state change (flipMeasure), then after the
// commit play it from the old place to the new one (flipPlay). Transform only, so it runs on the
// compositor. Rows carry data-flip-key. Reduce Motion and the OS setting: rows just switch.
const KEY = '[data-flip-key]'
const EASE = 'cubic-bezier(.32,.72,0,1)'   // = --ease; the Web Animations API takes no var()
export const FLIP_MAX = 12   // rows that animate; the rest switch
const live = new WeakMap()   // each row's running cleanup, so a new flip can retire the old one

export const still = () => {
  try {
    return document.documentElement.classList.contains('reduce-motion') ||
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch { return false }
}

/** Where every keyed row is now. Call before the state change. A row still in flight reports its live place, so a new flip starts from there. */
export function flipMeasure(root) {
  const m = new Map()
  for (const el of root?.querySelectorAll(KEY) || []) {
    const r = el.getBoundingClientRect()
    m.set(el.dataset.flipKey, { x: r.left, y: r.top })
  }
  return m
}

/** Slides each row that moved from its `before` place to where it is now. Call after the commit.
 *  `far`: a row that would travel more than this many px does not fly through the list: it fades in at its new place (160 ms, after `fadeDelay`, 80). */
// Call only after a commit, never during a live drag: it clears inline transform/transition on every keyed row.
export function flipPlay(root, before, { duration = 'var(--dur-flip)', delay = 'var(--flip-delay)', far, fadeDelay = 80 } = {}) {
  if (!root || !before?.size) return
  const rows = [...root.querySelectorAll(KEY)]
  // Drop any flip still in flight: the rows are back at their layout place, which is what we measure.
  for (const el of rows) {
    const p = live.get(el)
    if (p) { el.removeEventListener('transitionend', p); el.removeEventListener('transitioncancel', p); live.delete(el) }
    el.style.transition = 'none'; el.style.transform = ''
  }
  const moved = []
  for (const el of rows) {
    const a = before.get(el.dataset.flipKey)
    if (!a) continue
    const r = el.getBoundingClientRect()
    const dx = a.x - r.left, dy = a.y - r.top
    if (dx || dy) moved.push([el, dx, dy])
  }
  for (const el of rows) if (!moved.some(([e]) => e === el)) el.style.transition = ''
  if (still()) { for (const [el] of moved) el.style.transition = ''; return }
  const shown = moved.slice(0, FLIP_MAX)   // one budget for fades and flights; the rest switch
  const fade = far ? shown.filter(([, , dy]) => Math.abs(dy) > far) : []
  for (const [el] of fade) { el.style.transition = ''; el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: fadeDelay, easing: EASE, fill: 'backwards' }) }
  const go = shown.filter(m => !fade.includes(m))
  for (const [el] of moved) if (!go.some(([e]) => e === el)) el.style.transition = ''
  for (const [el, dx, dy] of go) el.style.transform = `translate(${dx}px,${dy}px)`
  go[0]?.[0].getBoundingClientRect()   // commit the start position once, then let go
  const t0 = performance.now()   // events born before this belong to a flip we retired
  for (const [el] of go) {
    el.style.transition = `transform ${duration} var(--ease) ${delay}`
    el.style.transform = ''
    // Only this row's own transform ends it (a child's transition bubbles); a cancel ends it too.
    const done = e => {
      if (e.timeStamp < t0 || e.target !== el || (e.propertyName && e.propertyName !== 'transform')) return
      el.style.transition = ''; live.delete(el)
      el.removeEventListener('transitionend', done); el.removeEventListener('transitioncancel', done)
    }
    el.addEventListener('transitionend', done); el.addEventListener('transitioncancel', done)
    live.set(el, done)
  }
}
