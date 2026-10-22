// A workout's heart rate (w.hr, lib/heart-rate.js) as one line under the detail sheet's header:
// no axes, the average and peak in its label for a screen reader.
import { fmtHr } from '../lib/heart-rate.js'

const W = 300
const H = 40
const PAD = 4

export default function HrSparkline({ hr }) {
  const s = hr?.s || []
  if (!s.length) return null
  // One reading still draws: a flat line across.
  const pts = s.length > 1 ? s : [[s[0][0], s[0][1]], [s[0][0] + 1, s[0][1]]]
  const x0 = pts[0][0]
  const span = pts[pts.length - 1][0] - x0 || 1
  const range = hr.max - hr.min
  const y = bpm => (range > 0 ? PAD + ((hr.max - bpm) / range) * (H - 2 * PAD) : H / 2)
  const line = pts.map(([o, bpm]) => `${Math.round(((o - x0) / span) * W * 10) / 10},${Math.round(y(bpm) * 10) / 10}`).join(' ')
  return <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={fmtHr(hr)} style={{ display: 'block', marginBottom: 12 }}>
    <polyline points={line} fill="none" stroke="var(--red)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg>
}
