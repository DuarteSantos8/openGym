import { useEffect, useRef, useState } from 'react'
import { tick } from './haptics.js'
import { t } from './i18n.js'

// Long-press drag for the routine rows on Plan: hold a row about 0.45 s and it lifts, then it
// follows the finger. Let go over another row to reorder, over a drop target (a folder row, the
// current plan header) to move the routine there. The hook only holds state; the look (scale,
// shadow, dashed outline, "Move here") is the view's, from `lifted`, `drag` and `over`.
//
//   const d = useLongPressDrag({ listRef, rows: ids, onReorder: (from, to) => …, onDropOn: (key, id) => … })
//   <div ref={listRef}>{ids.map(id => <div key={id} {...d.rowProps(id)}>…</div>)}</div>
//   <div {...d.targetProps(folderId)}>…</div>
//
// Moving more than `slop` px before the hold fires is a scroll or a swipe: nothing lifts and the
// row's own gesture (SwipeRow, the page scroll) carries on. Rows are found by `data-drag-row`
// (their id, on the row or on any wrapper inside the list, such as SwipeRow), targets by `data-drop-target` (their key), both hit-tested by rectangle.
const EDGE = 56      // px from a scroll edge where the list starts to scroll
const SPEED = 12     // px per 16 ms tick

const scrollParent = el => {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n
  }
  return document.scrollingElement || document.documentElement
}

const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

export function useLongPressDrag({ listRef, rows, onReorder, onDropOn, nameOf = x => x, holdMs = 450, slop = 8 }) {
  const [lifted, setLifted] = useState(null)
  const [over, setOver] = useState(null)       // { kind: 'row' | 'target', key }
  const [drag, setDrag] = useState(null)       // { id, dy, height } while lifted
  const [announce, setAnnounce] = useState('') // text for a polite live region
  const g = useRef(null)
  const latest = useRef()
  latest.current = { rows, onReorder, onDropOn, nameOf }

  useEffect(() => () => g.current?.stop(), [])

  const rowProps = id => ({
    'data-drag-row': id,
    onContextMenu: e => { if (g.current) e.preventDefault() }, // the iOS long-press menu
    onPointerDown: e => {
      if (g.current || (e.button != null && e.button !== 0)) return
      const el = e.currentTarget
      const sp = scrollParent(el)
      const s = { id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, sp, sp0: sp.scrollTop, lifted: false, over: null }
      g.current = s

      const hit = () => {
        const { x, y } = s
        const tgt = [...document.querySelectorAll('[data-drop-target]')].find(n => inside(n.getBoundingClientRect(), x, y))
        if (tgt) return { kind: 'target', key: tgt.getAttribute('data-drop-target') }
        const row = [...(listRef.current?.querySelectorAll('[data-drag-row]') || [])].find(n => n.hasAttribute('data-drag-row')
          && n.getAttribute('data-drag-row') !== id && inside(n.getBoundingClientRect(), x, y))
        return row ? { kind: 'row', key: row.getAttribute('data-drag-row') } : null
      }
      const refresh = () => {
        s.over = hit()
        setOver(s.over)
        setDrag({ id, dy: s.y - s.y0 + s.sp.scrollTop - s.sp0, height: s.height })
      }
      const end = () => { s.stop(); setLifted(null); setOver(null); setDrag(null) }

      const hold = setTimeout(() => {
        s.lifted = true
        s.height = el.getBoundingClientRect().height
        tick('lift')
        setLifted(id)
        refresh()
        // Near an edge the list scrolls under the finger; the target is looked up again each tick.
        s.scroller = setInterval(() => {
          const r = s.sp === document.scrollingElement || s.sp === document.documentElement
            ? { top: 0, bottom: window.innerHeight } : s.sp.getBoundingClientRect()
          const by = s.y < r.top + EDGE ? -SPEED : s.y > r.bottom - EDGE ? SPEED : 0
          if (by) { s.sp.scrollTop += by; refresh() }
        }, 16)
      }, holdMs)

      const move = ev => {
        s.x = ev.clientX; s.y = ev.clientY
        if (!s.lifted) {
          if (Math.hypot(s.x - s.x0, s.y - s.y0) > slop) end()
          return
        }
        ev.preventDefault?.()
        refresh()
      }
      const up = () => {
        const { rows: ids, onReorder: reorder, onDropOn: dropOn, nameOf: name } = latest.current
        const o = s.over
        const was = s.lifted
        end()
        if (!was) return
        // The browser still fires a click after a lifted release; it must not open the routine.
        const eat = ev => { ev.preventDefault(); ev.stopPropagation() }
        window.addEventListener('click', eat, { capture: true })
        setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0)
        tick('drop')
        if (o?.kind === 'target') {
          dropOn?.(o.key, id)
          setAnnounce(t('Moved {0} to {1}', name(id), name(o.key)))
        } else if (o?.kind === 'row') {
          const from = ids.indexOf(id), to = ids.indexOf(o.key)
          if (from >= 0 && to >= 0 && from !== to) {
            reorder?.(from, to)
            setAnnounce(t('Moved {0} to {1}', name(id), name(o.key)))
          }
        }
      }
      // Once lifted, the page must not scroll under the finger (only our edge scroll moves it).
      const block = ev => { if (s.lifted && ev.cancelable) ev.preventDefault() }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', end)
      window.addEventListener('touchmove', block, { passive: false })
      s.stop = () => {
        clearTimeout(hold); clearInterval(s.scroller)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', end)
        window.removeEventListener('touchmove', block)
        g.current = null
      }
    },
  })

  const targetProps = key => ({ 'data-drop-target': key })

  return { lifted, over, drag, announce, rowProps, targetProps }
}
