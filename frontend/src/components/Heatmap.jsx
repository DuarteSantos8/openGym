import { useEffect, useRef } from 'react'
import { fmtVol, isoOf, todayISO } from '../lib/format.js'

// GitHub-style activity heatmap, shaded by time trained per day.
export default function Heatmap({ S, onDay }) {
  const wrapRef = useRef(null)
  useEffect(() => { if (wrapRef.current) wrapRef.current.scrollLeft = wrapRef.current.scrollWidth }, [])

  const agg = {}
  S.workouts.forEach(w => {
    const a = agg[w.d] = agg[w.d] || { n: 0, vol: 0, min: 0 }
    a.n++; a.vol += w.vol || 0
    a.min += Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000))
  })
  const mins = Object.values(agg).map(a => a.min).filter(v => v > 0).sort((a, b) => a - b)
  const q = p => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(p * mins.length))] : 0)
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  const level = a => !a ? 0 : !a.min ? 1 : a.min >= t3 ? 4 : a.min >= t2 ? 3 : a.min >= t1 ? 2 : 1

  const today = new Date(); today.setHours(12, 0, 0, 0)
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const start = new Date(end); start.setDate(end.getDate() - 52 * 7)

  const months = [], cols = []
  let lastMonth = -1
  for (let wk = 0; wk <= 52; wk++) {
    const colStart = new Date(start); colStart.setDate(start.getDate() + wk * 7)
    const mo = colStart.getMonth()
    const showM = mo !== lastMonth && colStart.getDate() <= 7 && wk < 51
    months.push(<span key={wk}>{showM ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo] : ''}</span>)
    if (colStart.getDate() <= 7) lastMonth = mo
    const cells = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart); day.setDate(colStart.getDate() + d)
      const key = isoOf(day)
      const a = agg[key]
      const cls = 'hm-c l' + level(a) + (key === todayISO() ? ' today' : '') + (day > today ? ' future' : '')
      cells.push(<div key={d} className={cls}
        title={key + (a ? ` · ${a.n} workout${a.n > 1 ? 's' : ''} · ${a.min} min · ${fmtVol(a.vol, S.unit)}` : '')}
        onClick={a ? () => onDay(key) : undefined} />)
    }
    cols.push(<div key={wk} className="hm-col">{cells}</div>)
  }

  return <>
    <div className="hm-wrap" ref={wrapRef}>
      <div className="hm-months" style={{ marginLeft: 30 }}>{months}</div>
      <div className="hm-body">
        <div className="hm-days"><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span /></div>
        <div className="hm-grid">{cols}</div>
      </div>
    </div>
    <div className="hm-legend">Less time <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> More time</div>
  </>
}
