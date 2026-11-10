// One line over a shaded band: a value against its own usual range (HRV against Garmin's
// baseline, resting heart rate against its weekly mean). Upstream's LineChart has goal lines but
// no band, and this stays out of it. points: [{ d: iso, y, lo?, hi? }] sorted by day.
import { fmtDate, fmtNum } from '../lib/format.js'

const W = 340, P = { l: 30, r: 8, t: 8, b: 18 }

export default function GarminBandChart({ points, h = 160, unit = '', color = 'var(--acc)', label = '' }) {
  if (points.length < 2) return null
  const vals = points.flatMap(p => [p.y, p.lo, p.hi]).filter(v => v != null)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.1 || 1
  lo -= pad; hi += pad
  const X = i => P.l + (i / (points.length - 1)) * (W - P.l - P.r)
  const Y = v => P.t + (1 - (v - lo) / (hi - lo)) * (h - P.t - P.b)
  const band = points.map((p, i) => [i, p]).filter(([, p]) => p.lo != null && p.hi != null)
  const poly = band.map(([i, p]) => `${X(i).toFixed(1)},${Y(p.hi).toFixed(1)}`)
    .concat([...band].reverse().map(([i, p]) => `${X(i).toFixed(1)},${Y(p.lo).toFixed(1)}`)).join(' ')
  const line = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const out = p => p.lo != null && p.hi != null && (p.y < p.lo || p.y > p.hi)
  const last = points[points.length - 1]
  return <svg viewBox={`0 0 ${W} ${h}`} width="100%" role="img"
    aria-label={`${label}: ${fmtNum(last.y)} ${unit} on ${fmtDate(last.d)}${last.lo != null ? `, usual ${fmtNum(last.lo)} to ${fmtNum(last.hi)}` : ''}`}>
    {band.length > 1 && <polygon points={poly} fill={color} opacity="0.13" />}
    <polyline points={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    {points.map((p, i) => out(p) && <circle key={i} cx={X(i)} cy={Y(p.y)} r="3.2" fill="var(--orange)" />)}
    <circle cx={X(points.length - 1)} cy={Y(last.y)} r="4" fill={color} />
    {[hi - pad, lo + pad].map(v => <text key={v} x={P.l - 4} y={Y(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtNum(Math.round(v))}</text>)}
    <text x={P.l} y={h - 4} fontSize="9.5" fill="var(--label-2)">{fmtDate(points[0].d)}</text>
    <text x={W - P.r} y={h - 4} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtDate(last.d)}</text>
  </svg>
}
