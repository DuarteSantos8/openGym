// FLIP for list moves: measure each keyed row before a state change (flipMeasure), then after the
// commit play it from the old place to the new one (flipPlay). Transform only, so it runs on the
// compositor. Rows carry data-flip-key. Reduce Motion and the OS setting: rows just switch.
const KEY = '[data-flip-key]'
export const FLIP_MAX = 12   // rows that animate; the rest switch

const still = () => {
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

/** Slides each row that moved from its `before` place to where it is now. Call after the commit. */
export function flipPlay(root, before, { duration = 'var(--dur-flip)', delay = 'var(--flip-delay)' } = {}) {
  if (!root || !before?.size) return
  const rows = [...root.querySelectorAll(KEY)]
  // Drop any flip still in flight: the rows are back at their layout place, which is what we measure.
  for (const el of rows) { el.style.transition = 'none'; el.style.transform = '' }
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
  const go = moved.slice(0, FLIP_MAX)
  for (const [el] of moved.slice(FLIP_MAX)) el.style.transition = ''
  for (const [el, dx, dy] of go) el.style.transform = `translate(${dx}px,${dy}px)`
  go[0]?.[0].getBoundingClientRect()   // commit the start position once, then let go
  for (const [el] of go) {
    el.style.transition = `transform ${duration} var(--ease) ${delay}`
    el.style.transform = ''
    // Only this row's own transform ends it (a child's transition bubbles); a cancel ends it too.
    const done = e => {
      if (e.target !== el || (e.propertyName && e.propertyName !== 'transform')) return
      el.style.transition = ''
      el.removeEventListener('transitionend', done); el.removeEventListener('transitioncancel', done)
    }
    el.addEventListener('transitionend', done); el.addEventListener('transitioncancel', done)
  }
}
