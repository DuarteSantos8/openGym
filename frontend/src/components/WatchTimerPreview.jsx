import { DIGIT_SEGMENTS, SEGMENT_POINTS } from '../lib/watch-display.js'

export default function WatchTimerPreview({ font, color }) {
  return <div style={{ background: '#000', borderRadius: 16, padding: '18px 12px', textAlign: 'center', color }}>
    {font === 'segments' ? <svg viewBox="0 0 196 100" aria-label="01:30" role="img" style={{ height: 64, maxWidth: '100%' }}>
      {[0, 1, 3, 0].map((digit, index) => <g key={index} transform={`translate(${[0, 46, 108, 154][index]} 0) scale(.42 1)`}>
        {[...DIGIT_SEGMENTS[digit]].map(segment => <polygon key={segment} points={SEGMENT_POINTS[Number(segment)]} fill="currentColor" />)}
      </g>)}
      <circle cx="99" cy="31" r="5" fill="currentColor" /><circle cx="99" cy="69" r="5" fill="currentColor" />
    </svg> : <span style={{ fontSize: 64, lineHeight: 1, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
      fontFamily: font === 'mono' ? 'ui-monospace, monospace' : 'ui-rounded, system-ui, sans-serif' }}>01:30</span>}
  </div>
}
