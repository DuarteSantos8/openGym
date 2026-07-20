import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { bestWeightFor, lastBW, streakWeeks } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO } from '../lib/format.js'
import { bwSheet, goalSheet, calendarSheet, workoutDetailSheet, WorkoutRow, bwDeltaColor } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'

export default function Stats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [range, setRange] = useState(90)
  const [exId, setExId] = useState(null)
  const now = Date.now()

  const bwPts = S.bodyweight.filter(b => range === 0 || (b.t || new Date(b.d).getTime()) > now - range * 86400000)
    .map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const bw30 = S.bodyweight.filter(b => (b.t || new Date(b.d).getTime()) > now - 30 * 86400000)
  const bwDelta30 = bw30.length > 1 ? bw30[bw30.length - 1].w - bw30[0].w : null
  const monthW = S.workouts.filter(w => w.d.slice(0, 7) === todayISO().slice(0, 7)).length

  const exHist = [...new Set(S.workouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id]).sort((a, b) => EXIDX[a].n < EXIDX[b].n ? -1 : 1)
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null
  let exPts = [], exList = []
  if (curEx) {
    S.workouts.forEach(w => {
      const en = w.entries.find(e => e.id === curEx)
      if (en) { const mx = Math.max(0, ...en.sets.filter(s => s.done).map(s => s.w), en.topW || 0); if (mx > 0) exPts.push({ t: w.start, y: mx, d: w.d, sets: en.sets.filter(s => s.done) }) }
    })
    exList = exPts.slice(-5).reverse()
  }

  return <>
    <div className="hdr"><div><h1>Stats</h1><div className="sub">Progress & history</div></div>
      <button className="iconbtn" onClick={() => nav('/history')}>🗂</button></div>

    <div className="tiles">
      <div className="tile"><div className="l">Workouts</div><div className="v">{S.workouts.length}</div></div>
      <div className="tile"><div className="l">This month</div><div className="v">{monthW}</div></div>
      <div className="tile"><div className="l">Week streak</div><div className="v">{streakWeeks(S)} 🔥</div></div>
      <div className="tile"><div className="l">Weight 30d</div><div className="v" style={{ fontSize: '1.15rem', color: bwDelta30 === null ? 'inherit' : bwDeltaColor(bwDelta30, (lastBW(S) || {}).w || 0) }}>{bwDelta30 === null ? '—' : (bwDelta30 > 0 ? '+' : '') + fmtNum(bwDelta30) + ' ' + S.unit}</div></div>
    </div>

    <div className="card">
      <h2>Activity — last 12 months <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· by time trained</span></h2>
      <Heatmap S={S} onDay={iso => { const ws = S.workouts.filter(w => w.d === iso); if (ws.length === 1) workoutDetailSheet(ws[0]); else if (ws.length) calendarSheet(iso) }} />
    </div>

    <div className="cols">
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Body weight</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" style={S.targetW ? { color: 'var(--gold)' } : undefined} onClick={goalSheet}>🎯 {S.targetW ? fmtNum(S.targetW) : 'Goal'}</button>
            <button className="btn sm" onClick={() => bwSheet()}>+ Log</button>
          </div>
        </div>
        <div className="chips" style={{ marginBottom: 8 }}>
          {[[30, '1M'], [90, '3M'], [365, '1Y'], [0, 'All']].map(([d, l]) => <button key={l} className={'chip' + (range === d ? ' on' : '')} onClick={() => setRange(d)}>{l}</button>)}
        </div>
        <div className="chart"><LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} /></div>
      </div>

      <div className="card">
        <h2>Exercise progress</h2>
        {exHist.length ? <>
          <select className="input capitalize" style={{ marginBottom: 10 }} value={curEx} onChange={e => setExId(e.target.value)}>
            {exHist.map(id => <option key={id} value={id}>{EXIDX[id].n}</option>)}
          </select>
          <div className="chart"><LineChart points={exPts.map(p => ({ t: p.t, y: p.y, d: p.d }))} h={150} unit={S.unit} color="var(--blue)" /></div>
          <div style={{ marginTop: 8 }}>{exList.map((p, i) => <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--bg2)' }}>
            <span className="muted">{fmtDate(p.d, true)}</span><span>{p.sets.map(s => fmtNum(s.w) + '×' + s.r).join('  ')}</span></div>)}</div>
          <div className="small dim" style={{ marginTop: 8 }}>Best set weight per workout · Best ever: <b className="accent">{fmtNum(bestWeightFor(S, curEx))} {S.unit}</b></div>
        </> : <div className="muted small">Finish your first workout to see strength curves here. 📈</div>}
      </div>
    </div>

    {S.workouts.length > 0 && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>History</h4>
        <button className="btn sm ghost accent" onClick={() => nav('/history')}>All {S.workouts.length} ›</button>
      </div>
      <div className="list">{[...S.workouts].reverse().slice(0, 5).map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
    </>}
  </>
}
