import { t } from '../lib/i18n.js'
import { ZONE_FLOOR, ZONES } from '../lib/live-tiles.js'

const W = 340
const H = 136
// Room for the zones' numbers, clear of the line.
const GUTTER = 30
const BAND = (H - (ZONES - 1) * 2) / ZONES
// The graph always fills its width: nobody knows when the session ends, so the time scale widens
// as it goes. This little at the very start, where two readings would otherwise be the whole width.
const MIN_SPAN_MS = 10000

const zoneShare = z => ZONE_FLOOR + (z - 1) / (ZONES * 2)

// Heart rate over the session on the five zones (lib/live-tiles.js hrZone), in the colours of Apple's
// workout screen: the one the heart is in lit, the others dimmed. No hover, it is read mid-set. `span` is the
// session's length when it is over; `zone` and the dot at the end are for one still running.
// `marks`: when the sets were ticked (ms from the start), a thin line each. `bands`: [from, to] in ms
// from the start, every other one shaded, to tell the exercises apart.
export default function HeartGraph ({ samples, max, zone = 0, span = 0, marks = [], bands = [] }) {
  const y = bpm => {
    const share = Math.min(1, Math.max(ZONE_FLOOR, bpm / max))
    return H - (share - ZONE_FLOOR) / (1 - ZONE_FLOOR) * H
  }
  const last = samples[samples.length - 1]
  // Wide enough for a set ticked after the last reading (they come a few seconds late).
  const width = span || Math.max(MIN_SPAN_MS, last?.t || 0, ...marks)
  const x = ms => GUTTER + ms / width * (W - GUTTER - 6)
  return (
    <svg className="heart-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Heart rate')} direction="ltr">
      {Array.from({ length: ZONES }, (_, i) => {
        const z = ZONES - i
        const top = i * (BAND + 2)
        return <g key={z}>
          <rect x={GUTTER} y={top} width={W - GUTTER} height={BAND} rx="4" fill={`var(--z${z})`} opacity={z === zone ? 0.7 : 0.35} />
          <text x={GUTTER - 6} y={top + BAND / 2 + 3.5} textAnchor="end" className="heart-graph-z">{Math.round(zoneShare(z) * max)}</text>
        </g>
      })}
      {bands.map(([a, b], i) => i % 2 === 1 && <rect key={'b' + i} x={x(a)} y={0} width={Math.max(1, x(b) - x(a))} height={H} fill='var(--label)' opacity={0.1} />)}
      {marks.map((ms, i) => <line key={i} x1={x(ms)} x2={x(ms)} y1="0" y2={H} stroke="var(--label)" strokeOpacity=".3" strokeWidth="1" />)}
      {samples.length > 1 && <polyline points={samples.map(s => `${x(s.t).toFixed(1)},${y(s.hr).toFixed(1)}`).join(' ')}
        fill="none" stroke="var(--label)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {last && !span && <circle cx={x(last.t)} cy={y(last.hr)} r="4" fill="var(--label)" stroke="var(--bg)" strokeWidth="2" />}
    </svg>
  )
}
