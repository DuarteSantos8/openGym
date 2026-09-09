import { useEffect, useRef } from 'react'
import { t } from '../lib/i18n.js'

// Swipe-left-to-reveal-delete, same touch/mouse-drag shape Modals.jsx already uses for
// swipe-to-dismiss (drag ref, transform during move, snap on release) — horizontal instead
// of vertical, and it reveals a button rather than acting outright, since a swipe that goes
// through by accident is a worse mistake than a sheet that closes by accident.
//
// touchmove has to be a real (non-passive) listener, not React's onTouchMove prop — the same
// reason Modals.jsx attaches its own via addEventListener({ passive: false }) rather than the
// JSX prop: React's synthetic touch handlers are passive, so preventDefault from inside one is
// silently ignored, and on iOS Safari a touch that starts on a row gets claimed for page
// scroll before a passive handler ever gets a say. Axis-locking matters just as much: this
// only calls preventDefault once a touch has clearly gone more horizontal than vertical, so a
// normal vertical scroll — or a long-press-then-drag reorder gesture elsewhere on the same
// row (RoutineEdit's own drag-to-reorder) — is never hijacked; both start with the touch
// essentially stationary or moving on the y axis, and this backs off the instant it can tell.
// This deliberately does NOT set data-nodrag on the wrapper: that would opt every row out of
// drag-to-reorder entirely (confirmed by RoutineEdit.drag.test.jsx failing when it was here)
// rather than just out of this one gesture. A fast horizontal swipe cancels the reorder's
// pending long-press before it ever fires (movement clears its slop threshold too soon), and
// a genuine long-press-drag is vertical, so the axis lock below hands it back untouched —
// the two are already mutually exclusive by shape, without needing to be forced apart.
//
// The row keeps its own opaque background rather than trusting whatever sits behind it in the
// DOM (a `.card`'s fill, usually) — without it the red button peeks out at the row's edge even
// at rest, since a transparent row lets an absolutely-positioned sibling show straight through.
const REVEAL = 76
export default function SwipeToDelete({ children, onDelete, deleteLabel, className, onClick }) {
  const outerRef = useRef(null)
  const rowRef = useRef(null)
  const drag = useRef({ startX: null, startY: null, delta: 0, open: false, axis: null })

  const setX = (x, animate) => {
    const el = rowRef.current
    if (!el) return
    el.style.transition = animate ? 'transform .18s ease-out' : 'none'
    el.style.transform = `translateX(${x}px)`
  }
  const start = (x, y) => { drag.current = { startX: x, startY: y, delta: 0, open: drag.current.open, axis: null } }
  const move = (x, y, ev) => {
    const d = drag.current
    if (d.startX === null) return
    const dx = x - d.startX, dy = y - d.startY
    if (d.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (d.axis === 'y') return
    ev?.preventDefault?.()
    d.delta = dx
    const base = d.open ? -REVEAL : 0
    setX(Math.max(-REVEAL - 12, Math.min(0, base + dx)), false)
  }
  const end = () => {
    const d = drag.current
    if (d.startX === null) return
    if (d.axis !== 'x') { d.startX = null; return }
    const traveled = (d.open ? -REVEAL : 0) + d.delta
    d.open = traveled < -REVEAL / 2
    setX(d.open ? -REVEAL : 0, true)
    d.startX = null
  }

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const onTouchMove = e => move(e.touches[0].clientX, e.touches[0].clientY, e)
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  return (
    <div ref={outerRef} style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}
      onTouchStart={e => { if (e.target.closest('button,input')) return; start(e.touches[0].clientX, e.touches[0].clientY) }}
      onTouchEnd={end}
      onMouseDown={e => { if (e.button !== 0 || e.target.closest('button,input')) return; start(e.clientX, e.clientY) }}
      onMouseMove={e => { if (drag.current.startX !== null && e.buttons === 1) move(e.clientX, e.clientY) }}
      onMouseUp={end}
      onMouseLeave={() => { if (drag.current.startX !== null) end() }}>
      <button className="swipe-del" aria-label={deleteLabel || t('Delete')}
        style={{ position: 'absolute', inset: '0 0 0 auto', width: REVEAL, background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 600 }}
        onClick={() => { setX(0, true); drag.current.open = false; onDelete() }}>{t('Delete')}</button>
      <div ref={rowRef} className={className}
        onClick={e => { if (drag.current.open) { e.stopPropagation(); setX(0, true); drag.current.open = false; return } onClick && onClick(e) }}
        style={{ background: 'var(--surface)', position: 'relative' }}>
        {children}
      </div>
    </div>
  )
}
