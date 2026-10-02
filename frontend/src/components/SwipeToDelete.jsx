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
//
// A swipe is a pointer gesture, so the keyboard needs its own way through. role, tabIndex and
// onKeyDown (what tappable() hands a row) land on the row itself, so a row that was reachable
// with Tab and opened with Enter or Space before it learned to swipe still is. The delete
// button sits in the tab order right before its row but under it on screen, so focusing it
// slides the row open the way a swipe would, and moving focus on closes it again: otherwise
// Tab would land on a button nobody can see.
//
// The red button is transparent while the row is shut. Both are clipped by the same rounded
// corners, and anti-aliasing at a curve lets some of what is underneath through: in dark mode a
// red hairline traced every corner of every row at rest (QA 1.3.9). It shows as soon as the row
// moves, and goes once the row has slid shut again.
//
// The button sits at the row's inline end: the right in a left-to-right language, the left in
// Arabic. Offsets below are kept in that logical sense (negative = towards the start, opening)
// and turned into pixels only in setX, so one gesture reads the same in both directions.
const REVEAL = 76
const endSide = () => (document.documentElement.dir === 'rtl' ? -1 : 1)
export default function SwipeToDelete({ children, onDelete, deleteLabel, className, onClick, role, tabIndex, onKeyDown }) {
  const outerRef = useRef(null)
  const rowRef = useRef(null)
  const btnRef = useRef(null)
  const hideTimer = useRef(null)
  const drag = useRef({ startX: null, startY: null, delta: 0, open: false, axis: null })
  // Set while the row is open only because the delete button has focus, so a blur closes what
  // the focus opened and leaves a row the finger swiped open alone.
  const focusOpened = useRef(false)

  const setX = (x, animate) => {
    const el = rowRef.current
    if (!el) return
    el.style.transition = animate ? 'transform .18s ease-out' : 'none'
    el.style.transform = `translateX(${x * endSide()}px)`
    const btn = btnRef.current
    if (!btn) return
    window.clearTimeout(hideTimer.current)
    if (x !== 0) btn.style.opacity = '1'
    else if (!animate) btn.style.opacity = '0'
    else hideTimer.current = window.setTimeout(() => { if (!drag.current.open) btn.style.opacity = '0' }, 200)
  }
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])
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
    d.delta = dx * endSide()
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
    <div ref={outerRef} style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--r-card)' }}
      onTouchStart={e => { if (e.target.closest('button,input')) return; start(e.touches[0].clientX, e.touches[0].clientY) }}
      onTouchEnd={end}
      onMouseDown={e => { if (e.button !== 0 || e.target.closest('button,input')) return; start(e.clientX, e.clientY) }}
      onMouseMove={e => { if (drag.current.startX !== null && e.buttons === 1) move(e.clientX, e.clientY) }}
      onMouseUp={end}
      onMouseLeave={() => { if (drag.current.startX !== null) end() }}>
      <button ref={btnRef} className="swipe-del" aria-label={deleteLabel || t('Delete')}
        style={{ position: 'absolute', top: 0, bottom: 0, insetInlineEnd: 0, width: REVEAL, background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 600, opacity: 0 }}
        onFocus={() => { if (drag.current.open) return; focusOpened.current = true; drag.current.open = true; setX(-REVEAL, true) }}
        onBlur={() => { if (!focusOpened.current) return; focusOpened.current = false; drag.current.open = false; setX(0, true) }}
        onClick={() => { setX(0, true); drag.current.open = false; onDelete() }}>{t('Delete')}</button>
      <div ref={rowRef} className={className} role={role} tabIndex={tabIndex} onKeyDown={onKeyDown}
        onClick={e => { if (drag.current.open) { e.stopPropagation(); setX(0, true); drag.current.open = false; return } onClick && onClick(e) }}
        style={{ background: 'var(--surface)', position: 'relative' }}>
        {children}
      </div>
    </div>
  )
}
