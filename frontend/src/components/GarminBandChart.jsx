// One line over a shaded band: a value against its own usual range (HRV against Garmin's
// baseline, resting heart rate against its weekly mean). Upstream's LineChart has goal lines but
// no band, and this stays out of it. points: [{ d: iso, y, lo?, hi? }] sorted by day.
import { fmtDate, fmtNum } from '../lib/format.js'
import { useScrub, ScrubTip, ScrubMark } from './GarminFx.jsx'

const W = 340, P = { l: 30, r: 8, t: 8, b: 18 }

export default function GarminBandChart({ points, h = 160, unit = '', color = 'var(--acc)', label = '' }) {
  const xs = points.map((_, i) => P.l + (i / Math.max(1, points.length - 1)) * (W - P.l - P.r))
  const { i: at, bind } = useScrub(xs, W)
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
  const sel = at != null ? points[at] : null
  return <div {...bind}><svg viewBox={`0 0 ${W} ${h}`} width="100%" role="img"
    aria-label={`${label}: ${fmtNum(last.y)} ${unit} on ${fmtDate(last.d)}${last.lo != null ? `, usual ${fmtNum(last.lo)} to ${fmtNum(last.hi)}` : ''}`}>
    {band.length > 1 && <polygon className="g-fade" points={poly} fill={color} opacity="0.13" />}
    <polyline className="g-draw" pathLength="1" points={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    {points.map((p, i) => out(p) && <circle key={i} className="g-pop-in" cx={X(i)} cy={Y(p.y)} r="3.2" fill="var(--orange)" />)}
    <circle className="g-pop-in" cx={X(points.length - 1)} cy={Y(last.y)} r="4" fill={color} />
    <ScrubMark x={sel && X(at)} y={sel && Y(sel.y)} top={P.t} bottom={h - P.b} color={color} />
    {[hi - pad, lo + pad].map(v => <text key={v} x={P.l - 4} y={Y(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtNum(Math.round(v))}</text>)}
    <text x={P.l} y={h - 4} fontSize="9.5" fill="var(--label-2)">{fmtDate(points[0].d)}</text>
    <text x={W - P.r} y={h - 4} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtDate(last.d)}</text>
  </svg>
  <ScrubTip x={sel && X(at)} W={W}>{sel && <><b>{fmtNum(sel.y)} {unit}</b> {fmtDate(sel.d)}{sel.lo != null && <span className="muted">, usual {fmtNum(sel.lo)} to {fmtNum(sel.hi)}</span>}</>}</ScrubTip>
  </div>
}
