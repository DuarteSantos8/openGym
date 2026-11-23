import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { vibrate } from './sound.js'

// Reorder a flat list by its handle, the way iOS does in Edit mode: press the handle and the row
// follows the finger at once (no long press: the handle only exists while you are reordering, so
// there is no scroll to tell apart), the rows it passes slide out of its way, and letting go
// commits one move. The arrow keys on a focused handle move the row one place, for a keyboard.
//
// Since 1.4.6 (owner, 2026-11-23: "smoother … pressing and holding to push something up or down"):
//   - `press(i)` on a whole row starts the same drag after a hold (HOLD_MS) that did not move
//     more than SLOP px, with a short buzz, so the list scrolls as usual until a finger rests.
//     While a row is held the page cannot scroll under it (a non-passive touchmove on the list).
//   - Every change of order animates (FLIP, transform only): each row is measured after every
//     render and slides from where it was to where it is. Letting go of a held row measures the
//     rows where they are on screen at that moment, so the held one glides into its slot from
//     the finger and the ones it passed stay put; the arrows and moves from elsewhere slide too.
//   - The frame the move lands in runs without CSS transitions, so no row slides back first.
// With reduced motion (the system's, or Settings → Motion: Less, which answers the same query)
// nothing glides; the held row still tracks the finger.
//
// The routine editor has its own, superset-aware drag (RoutineEdit.jsx). This one is for lists
// with nothing grouped: Plan's routines, the rotation's loop, the Home and Stats card lists.
//
//   const r = useListReorder(items.length, (from, to) => …)
//   <div ref={r.listRef}>{items.map((x, i) => <div data-reorder-row data-reorder-key={x.id}
//     style={r.rowStyle(i)} {...r.press(i)}> … <button {...r.handle(i)} /></div>)}</div>
//
// `to` is the row's index after the move, so splice(from, 1) then splice(to, 0, row) applies it.
export const HOLD_MS = 320
export const SLOP = 8
const SLIDE_MS = 180
const FLIP_MS = 260
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'

const reduced = () => {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function useListReorder(count, onMove) {
  const listRef = useRef(null)
  const gesture = useRef(null)
  const hold = useRef(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  // { from, to, dy, stride } while a row is held; { quiet: true } for the frame a move lands in.
  const [drag, setDrag] = useState(null)
  const tops = useRef(new Map())

  const rowsOf = () => [...(listRef.current?.children || [])].filter(el => el.hasAttribute('data-reorder-row'))
  const measure = () => {
    const m = new Map()
    for (const row of rowsOf()) {
      const key = row.getAttribute('data-reorder-key')
      if (key != null) m.set(key, row.getBoundingClientRect().top)
    }
    return m
  }

  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null } }
  useEffect(() => () => { gesture.current = null; cancelHold() }, [])

  // No page scroll under a held row: pointer events alone cannot stop a touch scroll once the
  // browser has started one, a non-passive touchmove can.
  useEffect(() => {
    const el = listRef.current
    if (!el) return undefined
    const stop = e => { if (gesture.current) e.preventDefault() }
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  })

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

  const begin = (i, pointerId, y, el) => {
    const rows = rowsOf()
    if (!rows[i]) return false
    const rects = rows.map(row => row.getBoundingClientRect())
    // The distance from one row to the next, gap included, is how far a passed row slides.
    const stride = rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) || rects[0].height : rects[0].height
    gesture.current = { id: pointerId, el, from: i, to: i, y0: y, rects, stride }
    try { el.setPointerCapture?.(pointerId) } catch { /* unsupported, or the pointer is gone */ }
    setDrag({ from: i, to: i, dy: 0, stride })
    return true
  }

  const follow = e => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    e.preventDefault()
    // Past the first and the last row the held one meets a soft edge instead of a wall.
    const top = g.rects[0].top - g.rects[g.from].top, bottom = g.rects[g.rects.length - 1].top - g.rects[g.from].top
    const band = x => (x * 60) / (60 + Math.abs(x))
    let dy = e.clientY - g.y0
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

  const end = commit => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    try { g.el.releasePointerCapture?.(g.id) } catch { /* already released */ }
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
      begin(i, e.pointerId, e.clientY, e.currentTarget)
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
      if (gesture.current || count < 2) return
      if (e.target?.closest?.('button, input, select, textarea, a, [role="radio"], [role="switch"], [data-reorder-handle]')) return
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
      follow(e)
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
  return { listRef, drag: live, handle, press, rowStyle, held: i => !!live && i === live.from }
}

/** `list` with the entry at `from` moved to index `to` (a new array). */
export const moved = (list, from, to) => {
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}
