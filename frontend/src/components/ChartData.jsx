import { fmtDate, fmtNum } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'

const MAX_ROWS = 62

// At most MAX_ROWS rows, evenly spread, the last day always in.
function sampled(points) {
  if (points.length <= MAX_ROWS) return points
  const step = Math.ceil(points.length / MAX_ROWS)
  const rows = points.filter((_, i) => i % step === 0)
  const last = points[points.length - 1]
  return rows[rows.length - 1] === last ? rows : [...rows, last]
}

// A chart with a text alternative. Screen readers get the summary as the chart's label and the
// days as a table that is visually hidden (a long range is thinned to MAX_ROWS rows). `summary` is
// { avg, min, max, count } as trends.js summaryOf makes it.
export default function ChartData({ label, unit, points, summary, children }) {
  const text = tn('{1}: average {2} {3}, lowest {4}, highest {5}, {0} day logged', '{1}: average {2} {3}, lowest {4}, highest {5}, {0} days logged',
    summary.count, label, fmtNum(summary.avg), unit, fmtNum(summary.min), fmtNum(summary.max))
  return <>
    <div className="chart" role="img" aria-label={text}>{children}</div>
    <table className="vh">
      <caption>{text}</caption>
      <thead><tr><th scope="col">{t('Date')}</th><th scope="col">{label}</th></tr></thead>
      <tbody>
        {sampled(points).map(p => <tr key={p.d}><th scope="row">{fmtDate(p.d, true, true)}</th><td>{fmtNum(p.y)}</td></tr>)}
      </tbody>
    </table>
  </>
}
