import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tick } from './haptics.js'
import { t } from './i18n.js'
import { still } from './flip.js'

// Long-press drag for the routine rows on Plan: hold a row about 0.45 s and it lifts, then it
// follows the finger. Let go over another row to reorder, over a drop target (a folder row, the
// current plan header) to move the routine there. The hook only holds state; the look (scale,
// shadow, dashed outline, "Move here") is the view's, from `lifted`, `drag` and `over`.
//
//   const d = useLongPressDrag({ listRef, rows: ids, onReorder: (from, to) => …, onDropOn: (key, id) => … })
//   <div ref={listRef}>{ids.map(id => <div key={id} {...d.rowProps(id)}>…</div>)}</div>
//   <div {...d.targetProps(folderId)}>…</div>
//   <div {...d.areaProps(key)}>…another list; over its rows the drop goes to `key` as a target…</div>
//
// Moving more than `slop` px before the hold fires is a scroll or a swipe: nothing lifts and the
// row's own gesture (SwipeRow, the page scroll) carries on. Rows are found by `data-drag-row`
// (their id, on the row or on any wrapper inside the list, such as SwipeRow), targets by `data-drop-target` (their key), both hit-tested by rectangle.
const EDGE = 56      // px from a scroll edge where the list starts to scroll
const SPEED = 12     // px per 16 ms tick
const GAP = 20       // px between the finger and the lifted row, so what is under the finger stays readable

const scrollParent = el => {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n
  }
  return document.scrollingElement || document.documentElement
}

const CUE_MS = 120   // into the hold, the row dips (data-cue) so the lift is not a surprise
const SETTLE_MS = 280
const EASE = 'cubic-bezier(.32,.72,0,1)' // --ease; WAAPI takes no var()
const DRAG_ROW = '[data-drag-row]'
const GATE = 2       // px the finger must move before the row layout is read again

const rowEl = (root, id) => [...(root?.querySelectorAll(DRAG_ROW) || [])].find(n => n.getAttribute('data-drag-row') === id)
const centre = r => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })
const inner = el => el.querySelector('.drag-in') || el
const later = (ms, fn) => setTimeout(fn, ms)

const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

// `ride`: the lifted row rides 'above' the finger (its bottom edge about 16 px over it; below when there is no room
// above) or 'below' it (its top edge GAP under it).
// Into a folder: a copy of the lifted row flies to the target (its opacity held for 60% of the flight,
// ending at scale .92), the dashed slot fades out in 100 ms, and the target's count ticks at 200 ms.
function flyTo(n, from, slot, key) {
  const tgt = [...document.querySelectorAll('[data-drop-target],[data-drop-area]')].find(x => (x.getAttribute('data-drop-target') ?? x.getAttribute('data-drop-area')) === key)
  if (!tgt) return false
  const tr = tgt.getBoundingClientRect()
  const w = n.offsetWidth, h = n.offsetHeight
  const g = n.cloneNode(true)
  g.classList.add('drag-ghost')
  g.style.cssText = `left:${from.x - w / 2}px;top:${from.y - h / 2}px;width:${w}px;height:${h}px`
  const sl = document.createElement('div')
  sl.className = 'drag-slot-ghost'
  sl.style.cssText = `left:${slot.left + 8}px;top:${slot.top + 4}px;width:${slot.width - 16}px;height:${slot.height - 8}px`
  document.body.append(sl, g)
  const dx = tr.left + tr.width * .7 - from.x, dy = tr.top + Math.min(tr.height, 56) / 2 - from.y
  const a = g.animate([
    { transform: 'scale(1.03) rotate(1deg)', opacity: 1 },
    { opacity: 1, offset: .6 },
    { transform: `translate(${dx}px,${dy}px) scale(.92)`, opacity: 0 },
  ], { duration: SETTLE_MS, easing: EASE, fill: 'forwards' })
  const clean = () => { g.remove(); sl.remove() }
  a.onfinish = clean
  later(SETTLE_MS + 200, clean)
  later(200, () => {
    const c = tgt.querySelector('.ss') || tgt
    c.classList.add('drop-tick')
    later(220, () => c.classList.remove('drop-tick'))
  })
  return true
}

export function useLongPressDrag({ listRef, rows, onReorder, onDropOn, nameOf = x => x, ride = 'above', holdMs = 450, slop = 8 }) {
  const [lifted, setLifted] = useState(null)
  const [over, setOver] = useState(null)       // { kind: 'row' | 'target', key }
  const [drag, setDrag] = useState(null)       // { id, dy, height } while lifted
  const [announce, setAnnounce] = useState('') // text for a polite live region
  const g = useRef(null)
  const clear = useRef()
  const latest = useRef()
  const pending = useRef(null)  // a settle to play once the drop's state change has rendered
  const settling = useRef(null) // the running settle's cleanup
  latest.current = { rows, onReorder, onDropOn, nameOf }

  useEffect(() => () => { g.current?.stop(); clearTimeout(clear.current); settling.current?.() }, [])
  // Drop settle for a row that stays in its list: from where the finger left it to its place (transform
  // only). Reduce Motion: no flight, the row just fades in at its place.
  useLayoutEffect(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    const el = rowEl(listRef.current, p.id)
    if (!el) return
    const n = inner(el)
    if (still()) {
      n.classList.add('drop-fade')
      n.addEventListener('animationend', () => n.classList.remove('drop-fade'), { once: true })
      return
    }
    const a = centre(n.getBoundingClientRect())
    const dx = p.from.x - a.x, dy = p.from.y - a.y
    if (!dx && !dy) return
    n.style.transition = 'none'
    n.style.transform = `translate(${dx}px,${dy}px) scale(1.03) rotate(1deg)`
    n.getBoundingClientRect() // commit the start, then let go
    n.style.transition = `transform ${SETTLE_MS}ms var(--ease)`
    n.style.transform = ''
    const done = () => { clearTimeout(tm); n.style.transition = ''; n.style.transform = ''; n.removeEventListener('transitionend', done); settling.current = null }
    const tm = later(SETTLE_MS + 120, done)
    n.addEventListener('transitionend', done)
    settling.current = done
  })
  // Empty again soon after, so a repeat of the same move is a real change a screen reader speaks.
  const say = text => {
    setAnnounce(text)
    clearTimeout(clear.current)
    clear.current = setTimeout(() => setAnnounce(''), 1500)
  }

  const rowProps = id => ({
    'data-drag-row': id,
    onContextMenu: e => { if (g.current) e.preventDefault() }, // the iOS long-press menu
    onPointerDown: e => {
      if (g.current || (e.button != null && e.button !== 0)) return
      settling.current?.()
      const el = e.currentTarget
      const sp = scrollParent(el)
      const s = { id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, sp, sp0: sp.scrollTop, lifted: false, over: null }
      g.current = s

      const hit = () => {
        const { x, y } = s
        s.byArea = false
        const tgt = [...document.querySelectorAll('[data-drop-target]')].find(n => inside(n.getBoundingClientRect(), x, y))
        if (tgt) return { kind: 'target', key: tgt.getAttribute('data-drop-target') }
        const row = [...(listRef.current?.querySelectorAll('[data-drag-row]') || [])].find(n => n.getAttribute('data-drag-row') !== id && inside(n.getBoundingClientRect(), x, y))
        if (row) return { kind: 'row', key: row.getAttribute('data-drag-row') }
        // Another list as a whole: its rows count as that list's target.
        const area = [...document.querySelectorAll('[data-drop-area]')].find(n => !n.contains(el) && inside(n.getBoundingClientRect(), x, y))
        s.byArea = !!area // its caption is above the finger, so the row rides below
        return area ? { kind: 'target', key: area.getAttribute('data-drop-area') } : null
      }
      const top = () => s.sp === document.scrollingElement || s.sp === document.documentElement ? 0 : s.sp.getBoundingClientRect().top
      const refresh = force => {
        // Read the layout only once the finger (or the scroll) has moved.
        if (!force && Math.hypot(s.x - s.lx, s.y - s.ly) < GATE && s.sp.scrollTop === s.lst) return
        s.lx = s.x; s.ly = s.y; s.lst = s.sp.scrollTop
        s.over = hit()
        setOver(s.over)
        const natural = s.top0 - (s.sp.scrollTop - s.sp0)
        const above = ride === 'above' && !s.byArea && s.y - GAP - s.height >= top()
        setDrag({ id, dy: (above ? s.y - GAP - s.height : s.y + GAP) - natural, height: s.height })
      }
      const end = () => { s.stop(); el.removeAttribute('data-cue'); setLifted(null); setOver(null); setDrag(null) }

      const cancel = ev => { if (ev.pointerId === s.pid) end() }

      const cue = setTimeout(() => { if (!still()) el.setAttribute('data-cue', '') }, CUE_MS)
      const hold = setTimeout(() => {
        el.removeAttribute('data-cue')
        s.lifted = true
        const b = el.getBoundingClientRect()
        s.height = b.height; s.top0 = b.top
        tick('lift')
        setLifted(id)
        refresh(true)
        // Near an edge the list scrolls under the finger; the target is looked up again each tick.
        s.scroller = setInterval(() => {
          const r = s.sp === document.scrollingElement || s.sp === document.documentElement
            ? { top: 0, bottom: window.innerHeight } : s.sp.getBoundingClientRect()
          const by = s.y < r.top + EDGE ? -SPEED : s.y > r.bottom - EDGE ? SPEED : 0
          const max = s.sp.scrollHeight - s.sp.clientHeight
          // Nothing left to scroll that way: leave the page where it is.
          if (by && (by < 0 ? s.sp.scrollTop > 0 : s.sp.scrollTop < max)) { s.sp.scrollTop += by; refresh() }
        }, 16)
      }, holdMs)

      const move = ev => {
        if (ev.pointerId !== s.pid) return // a second finger is not ours
        s.x = ev.clientX; s.y = ev.clientY
        if (!s.lifted) {
          if (Math.hypot(s.x - s.x0, s.y - s.y0) > slop) end()
          return
        }
        ev.preventDefault?.()
        refresh()
      }
      const up = ev => {
        if (ev.pointerId !== s.pid) return
        const { rows: ids, onReorder: reorder, onDropOn: dropOn, nameOf: name } = latest.current
        const o = s.over
        const was = s.lifted
        const n = was && inner(el)
        const from = n && centre(n.getBoundingClientRect()) // where the finger left it, tilt and all
        const slot = n && el.getBoundingClientRect()
        const ghost = n && o?.kind === 'target' && !still() && n.animate && flyTo(n, from, slot, o.key)
        if (n && !ghost) pending.current = { id, from }
        end()
        if (!was) return
        // The browser still fires a click after a lifted release; it must not open the routine.
        const eat = ev => { ev.preventDefault(); ev.stopPropagation() }
        window.addEventListener('click', eat, { capture: true })
        setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0)
        tick('drop')
        if (o?.kind === 'target') {
          dropOn?.(o.key, id)
          say(t('Moved {0} to {1}', name(id), name(o.key)))
        } else if (o?.kind === 'row') {
          const from = ids.indexOf(id), to = ids.indexOf(o.key)
          if (from >= 0 && to >= 0 && from !== to) {
            reorder?.(from, to)
            say(t('Moved {0} to {1}', name(id), name(o.key)))
          }
        }
      }
      // Once lifted, the page must not scroll under the finger (only our edge scroll moves it).
      const block = ev => { if (s.lifted && ev.cancelable) ev.preventDefault() }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('touchmove', block, { passive: false })
      s.stop = () => {
        clearTimeout(cue); clearTimeout(hold); clearInterval(s.scroller)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('touchmove', block)
        g.current = null
      }
    },
  })

  const targetProps = key => ({ 'data-drop-target': key })
  const areaProps = key => ({ 'data-drop-area': key })

  const held = () => !!g.current?.lifted

  return { lifted, over, held, drag, announce, rows, rowProps, targetProps, areaProps }
}
