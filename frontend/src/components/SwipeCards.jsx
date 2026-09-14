import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const IGNORED_TARGETS = 'button,input,textarea,select,a,[role="button"],[role="checkbox"],[role="switch"],[role="slider"],[contenteditable="true"],.exmedia,[data-swipe-ignore]'
const AXIS_SLOP = 8
const AXIS_RATIO = 1.5
const COMMIT_DISTANCE = 70
const GAP = 12
const DURATION = 200

export default function SwipeCards({ children, renderPreview, onNavigate, index, count, revision, timerKey, workKey }) {
  const surface = useRef(null)
  const card = useRef(null)
  const preview = useRef(null)
  const gesture = useRef(null)
  const pending = useRef(null)
  const latest = useRef({ revision, timerKey, workKey })
  const [direction, setDirection] = useState(null)
  latest.current = { revision, timerKey, workKey }

  const paint = (offset, animate = false, toward = gesture.current?.direction) => {
    if (card.current) {
      card.current.style.transition = animate ? `transform ${DURATION}ms ease-out` : 'none'
      card.current.style.transform = `translateX(${offset}px)`
    }
    if (preview.current && toward) {
      preview.current.style.transition = animate ? `transform ${DURATION}ms ease-out` : 'none'
      const start = toward > 0 ? '100% + ' : '-100% - '
      preview.current.style.transform = `translateX(calc(${start}${GAP}px + ${offset}px))`
    }
  }

  const reset = () => {
    clearTimeout(pending.current)
    pending.current = null
    gesture.current = null
    setDirection(null)
    for (const node of [card.current, preview.current]) {
      node?.style.removeProperty('transform')
      node?.style.removeProperty('transition')
    }
  }

  useEffect(() => {
    reset()
    return () => clearTimeout(pending.current)
  }, [revision, timerKey, workKey, index, count])

  useLayoutEffect(() => {
    if (gesture.current) paint(gesture.current.offset, false, direction)
  }, [direction])

  const onPointerDown = event => {
    if (pending.current || gesture.current) return
    if (event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    if (event.target.closest?.(IGNORED_TARGETS)) return
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offset: 0,
      direction: null,
      revision,
      timerKey,
      workKey,
    }
  }

  const onPointerMove = event => {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    if (!active.direction) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_SLOP) return
      if (Math.abs(dx) <= Math.abs(dy) * AXIS_RATIO) {
        gesture.current = null
        return
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    const nextDirection = dx < 0 ? 1 : -1
    const available = index + nextDirection >= 0 && index + nextDirection < count
    active.direction = nextDirection
    active.offset = available ? dx : dx * 0.35
    setDirection(available ? nextDirection : null)
    paint(active.offset, false, nextDirection)
  }

  const finish = (event, cancelled = false) => {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    const available = index + active.direction >= 0 && index + active.direction < count
    const commit = !cancelled && active.direction != null && available && Math.abs(dx) >= COMMIT_DISTANCE && Math.abs(dx) > Math.abs(dy) * AXIS_RATIO
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const width = surface.current?.getBoundingClientRect().width || 360
    const stillCurrent = () => {
      const current = latest.current
      return current.revision === active.revision && current.timerKey === active.timerKey && current.workKey === active.workKey
    }
    const complete = () => {
      const navigate = commit && stillCurrent()
      const completedDirection = active.direction
      reset()
      if (navigate) onNavigate(completedDirection)
    }

    paint(commit ? -active.direction * (width + GAP) : 0, !reducedMotion, active.direction)
    if (reducedMotion) complete()
    else pending.current = setTimeout(complete, DURATION)
  }

  return <div ref={surface} className="workout-swipe-surface workout-swipe-stack" data-testid="workout-swipe-surface"
    onPointerDown={onPointerDown} onPointerMove={onPointerMove}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => {
      if (event.target === event.currentTarget && !pending.current && gesture.current?.id === event.pointerId) reset()
    }}>
    {direction != null && <div ref={preview} className="workout-swipe-preview" aria-hidden="true" inert>{renderPreview(direction)}</div>}
    <div ref={card} className="workout-swipe-card">{children}</div>
  </div>
}
