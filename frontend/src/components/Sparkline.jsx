// A small trend line with no axes, labels or hover: the shape of a series at a glance, inside a
// row that is itself the tap target (the favourite-lifts card on Home). For a curve you read
// values off, use LineChart.
//
// points: [{ y }] in chronological order. Fewer than two draws nothing — one point has no trend.
export default function Sparkline({ points, w = 64, h = 24, color = 'var(--acc)' }) {
  if (!points || points.length < 2) return null
  const ys = points.map(p => p.y)
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const pad = 2.5   // room for the end dot and the stroke at the extremes
  const x = i => pad + (i * (w - 2 * pad)) / (points.length - 1)
  // A flat series sits in the middle instead of on the floor.
  const y = v => (hi === lo ? h / 2 : h - pad - ((v - lo) * (h - 2 * pad)) / (hi - lo))
  const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' ')
  const last = points.length - 1
  return <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: 'block', flexShrink: 0, pointerEvents: 'none' }}>
    <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={x(last)} cy={y(points[last].y)} r="2.25" fill={color} />
  </svg>
}
