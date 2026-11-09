import { useLayoutEffect, useRef, useState } from 'react'
import { vibrate } from './sound.js'
import { SCRUB_HOLD_MS, SCRUB_SLOP, SCRUB_DEAD_PX, scrubMove } from './scrubby-input.js'

// Touch/pen only: mouse selection and keyboard editing keep their native behavior.
// The listeners exist only for the lifetime of one press. Like RoutineEdit's long-press
// reorder, a non-passive touchmove cancels scrolling AFTER activation, never before it.
export function useScrubbyInput({ enabled, value, next, onCommit, revision, targetKey, isValid }) {
  const ref = useRef(null)
  const latest = useRef(null)
  latest.current = { enabled, value, next, onCommit, revision, isValid }
  const gesture = useRef(null)
  const suppression = useRef(null)
  const [preview, setPreview] = useState(null)

  const clearSuppression = () => { suppression.current?.(); suppression.current = null }
  const suppressClick = () => {
    clearSuppression()
    const swallow = e => {
      if (e.detail === 0) return // keyboard / assistive activation
      e.preventDefault(); e.stopImmediatePropagation()
      clearSuppression()
    }
    const clear = () => clearSuppression()
    const timer = setTimeout(clear, 700)
    document.addEventListener('click', swallow, true)
    document.addEventListener('pointerdown', clear, true)
    suppression.current = () => {
      clearTimeout(timer)
      document.removeEventListener('click', swallow, true)
      document.removeEventListener('pointerdown', clear, true)
    }
  }
  const finish = (commit = false, focus = false) => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    clearTimeout(g.timer)
    g.cleanup()
    try { ref.current?.releasePointerCapture?.(g.id) } catch { /* already lost */ }
    if (g.active) suppressClick()
    setPreview(null)
    const p = latest.current
    if (commit && g.active && p.enabled && p.revision === g.revision && (!p.isValid || p.isValid()) && !Object.is(g.value, g.initial)) p.onCommit(g.value)
    // Focus while still in the user's pointerup task, so iOS can show its keyboard.
    if (focus && !g.active && g.input?.isConnected) g.input.focus()
  }

  useLayoutEffect(() => { finish() }, [enabled, revision, targetKey, value])
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const down = e => {
      if (gesture.current) return
      // A non-editable hit surface receives the initial touch, so the WebView never gets
      // an editable native target to focus. Mouse down still enters the real field at once.
      const hit = e.target.closest?.('.scrubby-hit')
      const input = hit ? el.querySelector('input') : e.target.closest?.('input')
      if (hit && e.pointerType === 'mouse' && (e.button == null || e.button === 0)) {
        input?.focus()
        return
      }
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      if (e.isPrimary === false || (e.button != null && e.button !== 0)) return
      if (e.target.disabled || (input && document.activeElement === input)) return
      clearSuppression()
      // Defensive fallback for programmatic events on the input; physical touches land
      // on the non-editable hit surface. Never cancel touchstart: early scroll stays native.
      if (input) e.preventDefault()
      const p = latest.current
      const g = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, initial: p.value, value: p.value, revision: p.revision, input, active: false }
      gesture.current = g
      const valid = () => latest.current.enabled && latest.current.revision === g.revision && (!latest.current.isValid || latest.current.isValid())
      const move = ev => {
        if (ev.pointerId !== g.id) return
        if (!valid()) { finish(); return }
        if (!g.active) {
          if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > SCRUB_SLOP) finish()
          else g.lastY = ev.clientY
          return
        }
        ev.preventDefault(); ev.stopImmediatePropagation()
        const dy = g.lastY - ev.clientY
        if (!g.moved && Math.abs(dy) <= SCRUB_DEAD_PX) return
        if (!g.moved) { g.lastY -= Math.sign(dy) * SCRUB_DEAD_PX; g.moved = true }
        const result = scrubMove(g.lastY, ev.clientY, g.value, latest.current.next)
        g.lastY = result.y
        if (!Object.is(g.value, result.value)) {
          g.value = result.value
          setPreview({ value: g.value })
          if (Date.now() - g.buzzAt >= 50) { vibrate(4); g.buzzAt = Date.now() }
        }
      }
      const up = ev => {
        if (ev.pointerId !== g.id) return
        // Let ancestor swipe handlers clear their pending (never locked) press too.
        if (g.active) ev.preventDefault()
        finish(valid(), true)
      }
      const cancel = ev => { if (ev.pointerId == null || ev.pointerId === g.id) finish() }
      const lost = ev => {
        // Touch begins with implicit capture on the input/button. Transferring that capture
        // to our wrapper emits a loss on the old target; only losing OUR capture cancels.
        if (ev.target === el) cancel(ev)
      }
      const other = ev => { if (ev.pointerId !== g.id) finish() }
      const touch = ev => {
        if (ev.touches.length > 1) { finish(); return }
        if (g.active && ev.cancelable) ev.preventDefault()
      }
      const hidden = () => { if (document.visibilityState === 'hidden') finish() }
      const key = ev => { if (ev.key === 'Escape') finish() }
      const context = ev => { if (el.contains(ev.target)) ev.preventDefault() }
      const listeners = [
        [document, 'pointermove', move, true], [document, 'pointerup', up, true],
        [document, 'pointercancel', cancel, true], [document, 'lostpointercapture', lost, true],
        [document, 'pointerdown', other, true], [document, 'touchmove', touch, { passive: false, capture: true }],
        [document, 'touchstart', touch, { passive: false, capture: true }],
        [document, 'visibilitychange', hidden], [window, 'blur', cancel],
        [document, 'keydown', key, true], [document, 'contextmenu', context, true],
      ]
      g.cleanup = () => listeners.forEach(([target, name, fn, options]) => target.removeEventListener(name, fn, options))
      listeners.forEach(([target, name, fn, options]) => target.addEventListener(name, fn, options))
      g.timer = setTimeout(() => {
        if (!valid()) { finish(); return }
        g.active = true; g.buzzAt = Date.now()
        try { el.setPointerCapture?.(g.id) } catch { /* document listeners still track */ }
        window.getSelection?.()?.removeAllRanges()
        setPreview({ value: g.value })
        vibrate(6)
      }, SCRUB_HOLD_MS)
    }
    el.addEventListener('pointerdown', down)
    return () => {
      el.removeEventListener('pointerdown', down)
      finish()
      // A released touch may still click after this component has gone away. The temporary
      // document guard removes itself on the next press or timeout.
    }
  }, [enabled])

  return { ref, active: preview !== null, value: preview ? preview.value : value }
}
