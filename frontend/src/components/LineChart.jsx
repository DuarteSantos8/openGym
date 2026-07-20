import { useRef, useState } from 'react'
import { fmtNum, fmtDate, MONTHS, isoOf } from '../lib/format.js'

// points: [{ t: ms, y: num, d?: iso }] sorted by t. opts: { h, unit, color, axes, goal }
export default function LineChart({ points, h = 150, unit = '', color = 'var(--acc)', axes = true, goal = null }) {
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null)   // { x, y, iso, v }

  if (!points || points.length === 0) return <div className="empty small">No data yet</div>
  const W = 340, H = h
  const P = { l: axes ? 34 : 8, r: 12, t: 10, b: axes ? 22 : 8 }
  const single = points.length === 1
  const pts = single ? [points[0], points[0]] : points
  const ys = pts.map(p => p.y)
  let ymin = Math.min(...ys), ymax = Math.max(...ys)
  if (goal != null && isFinite(goal)) { ymin = Math.min(ymin, goal); ymax = Math.max(ymax, goal) }
  if (ymin === ymax) { ymin -= 1; ymax += 1 }
  const pad = (ymax - ymin) * 0.12; ymin -= pad; ymax += pad
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1
  const X = t => (t1 === t0 ? (P.l + W - P.r) / 2 : P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r))
  const Y = y => P.t + (1 - (y - ymin) / (ymax - ymin)) * (H - P.t - P.b)

  const gridlines = []
  if (axes) {
    const range = ymax - ymin, raw = range / 3
    const pow = Math.pow(10, Math.floor(Math.log10(raw)))
    let step = 10 * pow
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) { step = m * pow; break }
    for (let v = Math.ceil(ymin / step) * step; v <= ymax + 1e-9; v += step) {
      const y = Y(v)
      gridlines.push(<g key={'y' + v}>
        <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
        <text x={P.l - 5} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="var(--dim)">{fmtNum(v)}</text>
      </g>)
    }
    const d0 = new Date(t0), d1 = new Date(t1)
    const ticks = []
    let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1)
    while (m <= d1) { ticks.push({ t: +m, txt: MONTHS[m.getMonth()] }); m = new Date(m.getFullYear(), m.getMonth() + 1, 1) }
    if (ticks.length === 0 && !single) {
      for (let i = 0; i <= 2; i++) {
        const t = t0 + (t1 - t0) * i / 2, dd = new Date(t)
        ticks.push({ t, txt: dd.getDate() + ' ' + MONTHS[dd.getMonth()], anchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle' })
      }
    }
    const every = Math.max(1, Math.ceil(ticks.length / 7))
    ticks.forEach((tk, i) => {
      if (i % every) return
      const x = X(tk.t)
      gridlines.push(<g key={'x' + i}>
        <line x1={x} y1={P.t} x2={x} y2={H - P.b} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
        <text x={x} y={H - 7} textAnchor={tk.anchor || 'middle'} fontSize="9.5" fill="var(--dim)">{tk.txt}</text>
      </g>)
    })
  }

  const poly = pts.map(p => X(p.t).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ')
  const last = pts[pts.length - 1]
  const gid = 'g' + Math.round(t0 % 1e7) + '_' + H
  const hoverPts = (single ? [points[0]] : points).map(p => ({ x: X(p.t), y: Y(p.y), iso: p.d || isoOf(new Date(p.t)), v: p.y }))

  const onMove = e => {
    const c = e.touches ? e.touches[0] : e
    if (!c || c.clientX === undefined) return
    const r = svgRef.current.getBoundingClientRect()
    const w = r.width || W
    const vx = (c.clientX - r.left) / w * W
    let best = hoverPts[0]
    hoverPts.forEach(p => { if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p })
    setHover(best)
  }

  return (
    <div className="chart-i"
      onMouseMove={onMove} onMouseDown={onMove}
      onTouchStart={onMove} onTouchMove={onMove}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ aspectRatio: `${W}/${H}` }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient></defs>
        {gridlines}
        {goal != null && isFinite(goal) && <>
          <line x1={P.l} y1={Y(goal)} x2={W - P.r} y2={Y(goal)} stroke="var(--gold)" strokeWidth="1.6" strokeDasharray="7 4" />
          <text x={W - P.r - 2} y={Y(goal) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--gold)">🎯 {fmtNum(goal)}</text>
        </>}
        <polygon points={`${P.l},${H - P.b} ${poly} ${X(last.t).toFixed(1)},${H - P.b}`} fill={`url(#${gid})`} />
        <polyline points={poly} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(last.t)} cy={Y(last.y)} r="4" fill={color} />
        {hover && <g>
          <line className="cvl" x1={hover.x} y1={P.t} x2={hover.x} y2={H - P.b} stroke="var(--mut)" strokeWidth="1" strokeDasharray="3 3" />
          <line className="chl" x1={P.l} y1={hover.y} x2={W - P.r} y2={hover.y} stroke="var(--mut)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={hover.x} cy={hover.y} r="5" fill={color} stroke="var(--bg)" strokeWidth="2" />
        </g>}
      </svg>
      {hover && <div className="ctip" style={{ left: `calc(${hover.x / W * 100}% - 55px)` }}>
        {fmtDate(hover.iso, true)} · {fmtNum(hover.v)}{unit ? ' ' + unit : ''}
      </div>}
    </div>
  )
}
