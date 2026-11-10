// The small moving parts of the Garmin cards: a card heading with an (i) popover, numbers that
// count up, progress rings, sparklines and the scrub that reads a chart point by hover, tap, drag
// or arrow keys. No library: CSS animations (theme-taste.css, the g- classes) and the native
// Popover API. Reduced motion is honoured by index.css, which stops every animation, and by
// CountUp, which then shows the number at once. Plain English: ours, not upstream's.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { INFO } from '../lib/garmin-info.js'
import Icon from './Icon.jsx'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A card's label with its (i): a native popover, so Escape, a tap outside and focus all work. */
export function GHead({ label, info, children, className = '' }) {
  const id = useId().replace(/:/g, '')
  const x = INFO[info]
  return <div className={'g-head ' + className}>
    <span className="muted small">{label}</span>
    {children}
    {x && <>
      <button type="button" className="g-info" popoverTarget={'gi' + id} aria-label={'About ' + x.title}><Icon name="info" /></button>
      <div popover="auto" id={'gi' + id} className="g-pop" role="dialog" aria-label={x.title}>
        <b>{x.title}</b><p>{x.body}</p>
      </div>
    </>}
  </div>
}

/** A number that runs up to `value` on mount and on change. Renders the final value on the server. */
export function CountUp({ value, fmt = v => String(Math.round(v)) }) {
  const [v, setV] = useState(value)
  const from = useRef(0)
  useLayoutEffect(() => {
    if (typeof value !== 'number' || !isFinite(value) || reduced()) { setV(value); from.current = value; return }
    const a = from.current, t0 = performance.now(), dur = 650
    let raf
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3
      setV(a + (value - a) * e)
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value
    }
    setV(a)
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); from.current = value }
  }, [value])
  return <span className="g-num">{typeof v === 'number' ? fmt(v) : v}</span>
}

/** A progress ring, f 0..1, with an optional label in the middle. */
export function Ring({ f, color = 'var(--acc)', size = 40, label, title }) {
  const k = Math.max(0, Math.min(1, Number(f) || 0)) * 100
  return <span className="g-ring" style={{ width: size, height: size }} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    <svg viewBox="0 0 40 40" width={size} height={size}>
      <circle cx="20" cy="20" r="17" className="g-ring-t" />
      <circle cx="20" cy="20" r="17" pathLength="100" className="g-ring-f" style={{ stroke: color, '--f': k }} transform="rotate(-90 20 20)" />
    </svg>
    {label != null && <span className="g-ring-l">{label}</span>}
  </span>
}

/** A tiny trend line for a tile: the last days of one number. */
export function Spark({ ys, color = 'var(--acc)', w = 64, h = 20 }) {
  const v = ys.filter(y => y != null)
  if (v.length < 3) return null
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1
  const pts = v.map((y, i) => `${(i / (v.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 2 - (y - lo) / r * (h - 4)).toFixed(1)}`).join(' ')
  return <svg className="g-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
    <polyline points={pts} pathLength="1" className="g-draw" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
}

/** Nearest index to svg x `x` in the sorted list `xs`. */
export function nearest(xs, x) {
  let best = 0
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i
  return best
}

/**
 * Reading one point of a chart: hover with a mouse, tap or sideways drag on a phone (vertical
 * drags still scroll the page), arrow keys once focused. `xs` are the points' x in viewBox units
 * of width `W`. Spread `bind` on the chart's wrapper; `i` is the picked index or null.
 */
export function useScrub(xs, W) {
  const [i, setI] = useState(null)
  const ref = useRef(null)
  const n = xs.length
  useEffect(() => { setI(null) }, [n])
  const pick = e => {
    const r = ref.current?.getBoundingClientRect()
    if (r?.width) setI(nearest(xs, (e.clientX - r.left) / r.width * W))
  }
  const bind = {
    ref, tabIndex: 0, className: 'g-chart',
    onPointerDown: pick,
    onPointerMove: e => { if (e.pointerType === 'mouse' || e.buttons) pick(e) },
    onPointerLeave: e => { if (e.pointerType === 'mouse') setI(null) },
    onBlur: () => setI(null),
    onKeyDown: e => {
      const k = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key]
      if (k) { e.preventDefault(); setI(j => Math.max(0, Math.min(n - 1, (j ?? (k > 0 ? -1 : n)) + k))) }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setI(e.key === 'Home' ? 0 : n - 1) }
      else if (e.key === 'Escape') setI(null)
    },
  }
  return { i: i != null && i < n ? i : null, bind }
}

/** The picked point's label over the chart, kept inside its edges; read aloud as it changes. */
export function ScrubTip({ x, W, children }) {
  const pct = x == null ? 0 : Math.max(14, Math.min(86, x / W * 100))
  return <div className={'g-tip' + (x == null ? ' off' : '')} style={{ left: pct + '%' }} aria-live="polite">{x == null ? '' : children}</div>
}

/** The vertical rule and dot on the picked point, inside the svg. */
export function ScrubMark({ x, y, top, bottom, color = 'var(--acc)' }) {
  if (x == null) return null
  return <g className="g-mark" pointerEvents="none">
    <line x1={x} x2={x} y1={top} y2={bottom} />
    {y != null && <circle cx={x} cy={y} r="4.5" fill={color} />}
  </g>
}
