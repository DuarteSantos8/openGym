import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// The About-you pickers' mechanics (§3b; prototype v4 picker()): a strip of steps moved under a
// fixed needle (a ruler, axis 'x') or a band (the year wheel, axis 'y'). Drag with a finger or a
// mouse, with a fling that carries on for ~180ms of its speed; scroll; tap a step to go there; tap
// the centre (or press Enter) to type instead; arrows, Page Up/Down, Home and End. The value is a
// slider's to a screen reader (the component renders role=slider from `index`).
//
// onInput(value, final): every step while moving (final false), and once when it settles (true).
// onTouch(): the first touch of any kind (the picker stops being "untouched").
const EASE = 'cubic-bezier(.32,.72,0,1)'
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function usePicker(config) {
  const box = useRef(null)
  const track = useRef(null)
  const cfg = useRef(config)
  cfg.current = config
  const count = () => Math.round((cfg.current.max - cfg.current.min) / cfg.current.step)
  const toI = v => clamp(Math.round((v - cfg.current.min) / cfg.current.step), 0, count())
  const toV = i => Number((cfg.current.min + i * cfg.current.step).toFixed(3))

  const [index, setIndex] = useState(() => toI(config.value ?? config.start))
  const idx = useRef(index)
  const pos = useRef(index)
  const drag = useRef(null)

  const place = useCallback((p, ms) => {
    const b = box.current, tr = track.current
    if (!b || !tr) return
    const { axis, px, cell = 0 } = cfg.current
    pos.current = p
    const off = ((axis === 'x' ? b.clientWidth : b.clientHeight) / 2 - p * px - cell / 2).toFixed(1)
    tr.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none'
    tr.style.transform = axis === 'x' ? `translate3d(${off}px,0,0)` : `translate3d(0,${off}px,0)`
  }, [])

  const setI = useCallback((ni, final) => {
    const n = clamp(ni, 0, count())
    const changed = n !== idx.current
    idx.current = n
    setIndex(n)
    if (changed || final) cfg.current.onInput(toV(n), !!final)
    // count and toV read the latest config through the ref
  }, [])

  // A new scale (the unit chip): the same value, placed on it at once.
  const { min, max, step, px } = config
  useLayoutEffect(() => {
    const n = toI(cfg.current.value ?? cfg.current.start)
    idx.current = n
    setIndex(n)
    place(n, 0)
  }, [min, max, step, px, place])

  // A narrower or wider box moves the centre: put the strip back under it.
  useEffect(() => {
    const b = box.current
    if (!b || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(() => place(idx.current, 0))
    ro.observe(b)
    return () => ro.disconnect()
  }, [place])

  // A wheel or a trackpad: 40px of scroll a step, settled 240ms after the last.
  useEffect(() => {
    const b = box.current
    if (!b) return undefined
    let acc = 0, settle = 0
    const onWheel = e => {
      const { axis } = cfg.current
      const d = axis === 'y' ? e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0
      if (!d) return
      e.preventDefault()
      acc += d
      const steps = Math.trunc(acc / 40)
      if (!steps) return
      acc -= steps * 40
      cfg.current.onTouch()
      setI(idx.current + steps, false)
      place(idx.current, 160)
      clearTimeout(settle)
      settle = setTimeout(() => setI(idx.current, true), 240)
    }
    b.addEventListener('wheel', onWheel, { passive: false })
    return () => { b.removeEventListener('wheel', onWheel); clearTimeout(settle) }
  }, [place, setI])

  const coord = e => (cfg.current.axis === 'x' ? e.clientX : e.clientY)
  const onPointerDown = e => {
    if (e.button > 0 || e.target.closest('input')) return
    drag.current = { c0: coord(e), p0: pos.current, moved: false, id: e.pointerId, s: [[e.timeStamp, coord(e)]] }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no capture: moves still arrive over the box */ }
    e.currentTarget.classList.add('dragging')
  }
  const onPointerMove = e => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const c = coord(e), delta = c - d.c0
    if (!d.moved && Math.abs(delta) < 5) return
    if (!d.moved) { d.moved = true; cfg.current.onTouch() }
    const N = count()
    let p = d.p0 - delta / cfg.current.px
    if (p < 0) p /= 3
    else if (p > N) p = N + (p - N) / 3 // a rubber band past the ends
    place(p, 0)
    d.s.push([e.timeStamp, c])
    if (d.s.length > 6) d.s.shift()
    setI(Math.round(p), false)
  }
  const end = (e, cancelled) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    e.currentTarget.classList.remove('dragging')
    const { px, onTapCenter } = cfg.current
    if (!d.moved) {
      if (cancelled) { place(idx.current, 200); return }
      const rect = e.currentTarget.getBoundingClientRect()
      const c = cfg.current.axis === 'x' ? e.clientX - rect.left : e.clientY - rect.top
      const k = Math.round((c - (cfg.current.axis === 'x' ? rect.width : rect.height) / 2) / px)
      cfg.current.onTouch()
      if (k === 0 && onTapCenter) { setI(idx.current, true); onTapCenter(); return }
      setI(idx.current + k, true)
      place(idx.current, 280)
      return
    }
    const a = d.s[0], b = d.s[d.s.length - 1]
    const v = (b[1] - a[1]) / Math.max(16, b[0] - a[0])
    setI(Math.round(pos.current - (cancelled ? 0 : (v * 180) / px)), true)
    place(idx.current, 320)
  }

  const onKeyDown = e => {
    const { axis, big = 10, onTapCenter } = cfg.current
    // The wheel follows its rows (down is the next year); the ruler follows the slider convention.
    const map = axis === 'y'
      ? { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1, PageDown: big, PageUp: -big }
      : { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: big, PageDown: -big }
    let ni = null
    if (e.key in map) ni = idx.current + map[e.key]
    else if (e.key === 'Home') ni = 0
    else if (e.key === 'End') ni = count()
    else if ((e.key === 'Enter' || e.key === ' ') && onTapCenter) {
      e.preventDefault()
      cfg.current.onTouch()
      setI(idx.current, true)
      onTapCenter()
      return
    }
    if (ni === null) return
    e.preventDefault()
    cfg.current.onTouch()
    setI(ni, true)
    place(idx.current, 160)
  }

  /** Puts a value on the picker from outside (a typed number), as a settled answer. */
  const set = useCallback(v => { setI(toI(v), true); place(idx.current, 280) }, [setI, place])

  return {
    box, track, value: toV(index), set,
    handlers: { onPointerDown, onPointerMove, onPointerUp: e => end(e, false), onPointerCancel: e => end(e, true), onKeyDown },
  }
}
