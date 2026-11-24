import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { vibrate } from './sound.js'
import { scrollHostFor, autoScrollStep } from './drag-scroll.js'

// Moving a row in a list, the same way everywhere in the app (owner, 2026-11-23: "these little
// things should be the same everywhere, otherwise you feel like you have to learn the app again
// and again"). One gesture, one look:
//
//   - Hold a row (HOLD_MS, a finger that stays within SLOP px) and it lifts: a light buzz, a
//     shadow, a touch larger. Until then the list scrolls as usual. Its buttons and fields keep
//     their own taps.
//   - Or press its grip (`handle(i)`), which picks it up at once.
//   - The rows it passes make room; at the list's edge the page scrolls along; past the first or
//     last row it meets a soft edge instead of a wall. A buzz each time it changes places.
//   - Letting go glides it into its slot (FLIP from where it is on screen), the frame the move
//     lands in runs without transitions, and the tap a release would fire is swallowed.
//   - Escape, a second finger or the app going to the background put it back.
//   - The arrow keys on a focused grip move it one place, for a keyboard.
// With reduced motion (the system's, or Settings → Motion: Less) nothing glides; the row still
// follows the finger. The routine editor keeps its own superset-aware drag (RoutineEdit.jsx) with
// the same timings and the same look.
//
//   const r = useListReorder(items.length, (from, to) => …)
//   <div ref={r.listRef}>{items.map((x, i) => <div data-reorder-row data-reorder-key={x.id}
//     style={r.rowStyle(i)} {...r.press(i)}> … <button {...r.handle(i)} /></div>)}</div>
//
// `to` is the row's index after the move, so splice(from, 1) then splice(to, 0, row) applies it.
export const HOLD_MS = 320
export const SLOP = 8
export const SLIDE_MS = 180
export const FLIP_MS = 260
export const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'

const reduced = () => {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false }
}
const scrollOf = host => (host === window ? (window.scrollY || document.scrollingElement?.scrollTop || 0) : host.scrollTop)

export function useListReorder(count, onMove) {
  const listRef = useRef(null)
  const gesture = useRef(null)
  const hold = useRef(null)
  const swallow = useRef(0)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  // { from, to, dy, stride } while a row is held; { quiet: true } for the frame a move lands in.
  const [drag, setDrag] = useState(null)
  const tops = useRef(new Map())

  const rowsOf = () => [...(listRef.current?.children || [])].filter(el => el.hasAttribute('data-reorder-row'))
  // Each row's top relative to the list, not the screen: a scroll between two renders moves
  // every row on screen and must not read as a move (review 1.4.6, 40 of 40 rows slid).
  const measure = () => {
    const m = new Map()
    const base = listRef.current?.getBoundingClientRect()?.top
    if (!Number.isFinite(base)) return m
    for (const row of rowsOf()) {
      const key = row.getAttribute('data-reorder-key')
      const top = row.getBoundingClientRect()?.top
      if (key != null && Number.isFinite(top)) m.set(key, top - base)
    }
    return m
  }

  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null } }

  // Listeners that live as long as the list: no page scroll under a held row (only a non-passive
  // touchmove can stop a touch scroll the browser has begun), the release's tap swallowed, and
  // a drag put back on Escape or when the app goes away.
  useEffect(() => {
    const el = listRef.current
    if (!el) return undefined
    const stop = e => { if (gesture.current) e.preventDefault() }
    const click = e => { if (Date.now() < swallow.current) { swallow.current = 0; e.preventDefault(); e.stopPropagation() } }
    el.addEventListener('touchmove', stop, { passive: false })
    el.addEventListener('click', click, true)
    return () => { el.removeEventListener('touchmove', stop); el.removeEventListener('click', click, true) }
  })
  useEffect(() => {
    const key = e => { if (e.key === 'Escape' && gesture.current) { e.preventDefault(); end(false) } }
    const away = () => { if (document.visibilityState === 'hidden') end(false) }
    document.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', away)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', away)
      gesture.current = null
      cancelHold()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // FLIP: a row whose place changed since it was last measured slides from there to here.
  useLayoutEffect(() => {
    if (drag && !drag.quiet) return
    const now = measure()
    if (!reduced()) {
      for (const row of rowsOf()) {
        const key = row.getAttribute('data-reorder-key')
        const was = tops.current.get(key), is = now.get(key)
        if (was == null || is == null || Math.abs(was - is) < 0.5 || typeof row.animate !== 'function') continue
        row.animate([{ transform: `translateY(${was - is}px)` }, { transform: 'translateY(0)' }], { duration: FLIP_MS, easing: EASE })
      }
    }
    tops.current = now
  })

  const place = g => {
    // Where the held row is in the list's own coordinates: the finger's travel plus how far the
    // page scrolled under it since the lift.
    const top = g.rects[0].top - g.rects[g.from].top, bottom = g.rects[g.rects.length - 1].top - g.rects[g.from].top
    const band = x => (x * 60) / (60 + Math.abs(x))
    let dy = g.y - g.y0 + (scrollOf(g.host) - g.scroll0)
    if (dy < top) dy = top + band(dy - top)
    else if (dy > bottom) dy = bottom + band(dy - bottom)
    const held = g.rects[g.from]
    const mid = held.top + held.height / 2 + dy
    // The new index is how many of the other rows now sit above the held row's middle.
    const to = g.rects.reduce((n, r, k) => n + (k !== g.from && r.top + r.height / 2 < mid ? 1 : 0), 0)
    if (to !== g.to) vibrate(6)
    g.to = to
    setDrag({ from: g.from, to, dy, stride: g.stride })
  }

  const tick = () => {
    const g = gesture.current
    if (!g) return
    g.frame = null
    const step = autoScrollStep(g.host, g.y)
    if (!step) return
    if (g.host === window) window.scrollBy(0, step); else g.host.scrollTop += step
    place(g)
    g.frame = requestAnimationFrame(tick)
  }

  const begin = (i, pointerId, y, el) => {
    const rows = rowsOf()
    if (!rows[i] || !listRef.current) return false
    const rects = rows.map(row => row.getBoundingClientRect())
    // How far a passed row slides: the held row's height plus the gap between rows. On a list of
    // even rows that is the distance from one row to the next; the live workout's exercises are
    // cards of every height, and a passed card has to make room for this one, not for the first.
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : NaN
    const stride = Number.isFinite(gap) && rects[i].height > 0 ? rects[i].height + Math.max(0, gap)
      : rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) || rects[0].height : rects[0].height
    const host = scrollHostFor(listRef.current)
    gesture.current = { id: pointerId, el, row: rows[i], from: i, to: i, y0: y, y, rects, stride, host, scroll0: scrollOf(host), frame: null }
    // The lifted look (index.css [data-held]): the same shadow on every list.
    rows[i].setAttribute('data-held', '')
    // A bottom sheet the list sits in, and a row's swipe, read this and leave the finger alone.
    listRef.current.setAttribute('data-reordering', '')
    try { el.setPointerCapture?.(pointerId) } catch { /* unsupported, or the pointer is gone */ }
    setDrag({ from: i, to: i, dy: 0, stride })
    return true
  }

  const follow = e => {
    const g = gesture.current
    if (!g) return
    if (e.pointerId !== g.id) { end(false); return }
    e.preventDefault()
    g.y = e.clientY
    place(g)
    if (g.frame == null && typeof requestAnimationFrame === 'function') g.frame = requestAnimationFrame(tick)
  }

  function end(commit) {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    if (g.frame != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(g.frame)
    listRef.current?.removeAttribute('data-reordering')
    g.row?.removeAttribute('data-held')
    try { g.el.releasePointerCapture?.(g.id) } catch { /* already released */ }
    // The tap a release fires right after pointerup is not a tap on the row.
    swallow.current = Date.now() + 400
    // Where every row is on screen right now is where the landing animation starts from.
    tops.current = measure()
    setDrag({ quiet: true })
    if (commit && g.to !== g.from) onMoveRef.current(g.from, g.to)
    const done = () => setDrag(d => (d && d.quiet ? null : d))
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(done))
    else setTimeout(done, 32)
  }

  const handle = i => ({
    'data-reorder-handle': '',
    onPointerDown: e => {
      if (e.button != null && e.button !== 0) return
      if (gesture.current) return
      e.preventDefault()
      e.stopPropagation()
      if (begin(i, e.pointerId, e.clientY, e.currentTarget)) vibrate(12)
    },
    onPointerMove: follow,
    onPointerUp: e => { if (gesture.current && e.pointerId === gesture.current.id) end(true) },
    onPointerCancel: () => end(false),
    onClick: e => e.stopPropagation(),
    onKeyDown: e => {
      const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (!d) return
      e.preventDefault()
      const to = i + d
      if (to >= 0 && to < count) onMoveRef.current(i, to)
    },
  })

  // A hold anywhere on the row (its buttons and inputs keep their own taps): the list scrolls as
  // usual until a finger rests for HOLD_MS, then the row lifts and follows it.
  const press = i => ({
    onPointerDown: e => {
      if (e.button != null && e.button !== 0) return
      if (gesture.current) { if (e.pointerId !== gesture.current.id) end(false); return }
      if (count < 2) return
      if (e.target?.closest?.('input, select, textarea, a, [role="radio"], [role="switch"], [data-reorder-handle], [data-nodrag], button:not([data-row-open])')) return
      const el = e.currentTarget
      cancelHold()
      const h = { id: e.pointerId, x: e.clientX, y: e.clientY }
      h.timer = setTimeout(() => {
        if (hold.current !== h) return
        hold.current = null
        if (begin(i, h.id, h.y, el)) vibrate(12)
      }, HOLD_MS)
      hold.current = h
    },
    onPointerMove: e => {
      const h = hold.current
      if (h && e.pointerId === h.id && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP) cancelHold()
      if (gesture.current) follow(e)
    },
    onPointerUp: e => {
      cancelHold()
      if (gesture.current && e.pointerId === gesture.current.id) end(true)
    },
    onPointerCancel: () => { cancelHold(); end(false) },
    // A long press must not open the phone's text selection or context menu.
    onContextMenu: e => { if (gesture.current || hold.current) e.preventDefault() },
  })

  // The held row follows the pointer, a touch larger; the rows between where it was and where it
  // would land slide one place towards the gap it left.
  const rowStyle = i => {
    if (!drag) return undefined
    if (drag.quiet) return { transition: 'none' }
    const slide = `transform ${SLIDE_MS}ms ${EASE}`
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, scale: '1.02', zIndex: 2, position: 'relative', transition: 'none' }
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return { transform: `translateY(${-drag.stride}px)`, transition: slide }
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return { transform: `translateY(${drag.stride}px)`, transition: slide }
    return { transform: 'translateY(0)', transition: slide }
  }

  const live = drag && !drag.quiet ? drag : null
  return { listRef, drag: live, handle, press, rowStyle, held: i => !!live && i === live.from, lifted: () => !!gesture.current }
}

/** `list` with the entry at `from` moved to index `to` (a new array). */
export const moved = (list, from, to) => {
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}
