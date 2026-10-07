import { useEffect, useRef, useState } from 'react'

// Reorder a flat list by its handle, the way iOS does in Edit mode: press the handle and the row
// follows the finger at once (no long press: the handle only exists while you are reordering, so
// there is no scroll to tell apart), the rows it passes slide out of its way, and letting go
// commits one move. The arrow keys on a focused handle move the row one place, for a keyboard.
//
// The routine editor has its own, superset-aware drag (RoutineEdit.jsx). This one is for lists
// with nothing grouped: Plan's routines and the rotation's loop.
//
//   const r = useListReorder(items.length, (from, to) => …)
//   <div ref={r.listRef}>{items.map((x, i) => <div data-reorder-row style={r.rowStyle(i)}>
//     … <button {...r.handle(i)} /></div>)}</div>
//
// `to` is the row's index after the move, so splice(from, 1) then splice(to, 0, row) applies it.
export function useListReorder(count, onMove) {
  const listRef = useRef(null)
  const gesture = useRef(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const [drag, setDrag] = useState(null)   // { from, to, dy, stride } while a row is held

  useEffect(() => () => { gesture.current = null }, [])

  const end = commit => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    try { g.el.releasePointerCapture?.(g.id) } catch { /* already released */ }
    setDrag(null)
    if (commit && g.to !== g.from) onMoveRef.current(g.from, g.to)
  }

  const rowsOf = () => [...(listRef.current?.children || [])].filter(el => el.hasAttribute('data-reorder-row'))

  const handle = i => ({
    'data-reorder-handle': '',
    onPointerDown: e => {
      if (e.button != null && e.button !== 0) return
      const rows = rowsOf()
      if (!rows[i]) return
      e.preventDefault()
      e.stopPropagation()
      const rects = rows.map(row => row.getBoundingClientRect())
      // The distance from one row to the next, gap included, is how far a passed row slides.
      const stride = rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) || rects[0].height : rects[0].height
      gesture.current = { id: e.pointerId, el: e.currentTarget, from: i, to: i, y0: e.clientY, rects, stride }
      try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* unsupported */ }
      setDrag({ from: i, to: i, dy: 0, stride })
    },
    onPointerMove: e => {
      const g = gesture.current
      if (!g || e.pointerId !== g.id) return
      e.preventDefault()
      const dy = e.clientY - g.y0
      const held = g.rects[g.from]
      const mid = held.top + held.height / 2 + dy
      // The new index is how many of the other rows now sit above the held row's middle.
      g.to = g.rects.reduce((n, r, k) => n + (k !== g.from && r.top + r.height / 2 < mid ? 1 : 0), 0)
      setDrag({ from: g.from, to: g.to, dy, stride: g.stride })
    },
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

  // The held row follows the pointer; the rows between where it was and where it would land
  // slide one place towards the gap it left.
  const rowStyle = i => {
    if (!drag) return undefined
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, zIndex: 2, position: 'relative', transition: 'none' }
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return { transform: `translateY(${-drag.stride}px)` }
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return { transform: `translateY(${drag.stride}px)` }
    return { transform: 'translateY(0)' }
  }

  return { listRef, drag, handle, rowStyle }
}

/** `list` with the entry at `from` moved to index `to` (a new array). */
export const moved = (list, from, to) => {
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}
