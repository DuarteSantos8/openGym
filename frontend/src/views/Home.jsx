import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtVol, fmtDate, todayISO, isoOf, weekKey, DAYS, DAYN } from '../lib/format.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, WorkoutRow, loadStarterPlan, bwDeltaColor, workoutDetailSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'

export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{DAYS[d.getDay()]}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? 'This week' : `${monday.getDate()} ${monday.toLocaleDateString('en-GB', { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString('en-GB', { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const lastW = S.workouts[S.workouts.length - 1]
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  return <>
    <div className="hdr">
      <div><h1>{user ? 'Hi ' + user.name + ' 💪' : 'openGym 🏋️'}</h1><div className="sub">{today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')}>⚙️</button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => setWeekOffset(w => w - 1)}>‹</button>
        <div className="small muted" style={{ fontWeight: 600 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => setWeekOffset(w => w + 1)}>›</button>
      </div>
      <div className="week">{strip}</div>
      <div className="small dim" style={{ marginTop: 8, textAlign: 'center' }}>Tap a day to plan or move a session</div>
    </div>

    <div className="cols"><div>
      {S.active ? (
        <div className="card" style={{ borderColor: 'var(--orange)' }}>
          <h2 style={{ color: 'var(--orange)' }}>Workout in progress</h2>
          <div className="row between">
            <div><div className="big">{S.active.name}</div><div className="muted small">{setsDoneActive(S.active)} sets logged</div></div>
            <button className="btn sm primary" onClick={() => nav('/workout')}>Resume ▶</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <h2>Today</h2>
          {routine ? <>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div><div className="big">{routine.name}</div><div className="muted small">{routine.ex.length} exercises · ~{routine.ex.length * 8} min{todayOvr && <span style={{ color: 'var(--orange)' }}> · rescheduled</span>}</div></div>
              <div style={{ fontSize: '2rem' }}>{routine.emoji || '💪'}</div>
            </div>
            <button className="btn primary" onClick={() => startFlow(routine.id)}>Start workout</button>
          </> : S.routines.length ? <>
            <div className="big" style={{ marginBottom: 4 }}>Rest day 😌</div>
            <div className="muted small" style={{ marginBottom: 12 }}>Nothing planned for {DAYN[today.getDay()]} — recovery counts too. Feeling strong anyway?</div>
            <button className="btn" onClick={() => nav('/workout')}>Start a workout anyway</button>
          </> : <>
            <div className="big" style={{ marginBottom: 4 }}>Welcome! 👋</div>
            <div className="muted small" style={{ marginBottom: 12 }}>Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.</div>
            <button className="btn primary" onClick={loadStarterPlan}>Load starter plan (PPL)</button>
            <div style={{ height: 8 }} /><button className="btn" onClick={() => nav('/plan')}>Build my own plan</button>
          </>}
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Body weight</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" style={S.targetW ? { color: 'var(--gold)' } : undefined} onClick={goalSheet}>🎯 {S.targetW ? fmtNum(S.targetW) : 'Goal'}</button>
            <button className="btn sm" onClick={() => bwSheet()}>+ Log</button>
          </div>
        </div>
        {bw ? <>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
            {delta !== null && <span className="small" style={{ fontWeight: 700, color: bwDeltaColor(delta, bw.w) }}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {fmtNum(Math.abs(delta))}</span>}
            <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
          </div>
          {S.targetW && <div className="small" style={{ color: 'var(--gold)', marginTop: 2 }}>🎯 Goal {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? 'reached! 🎉' : fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit + ' to ' + (S.targetW > bw.w ? 'gain' : 'lose')}</div>}
          <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        </> : <div className="muted small">No entries yet — log your weight to start the curve. It's also asked automatically before every workout.</div>}
      </div>
    </div><div>

      <div className="tiles">
        <div className="tile tappable" onClick={() => calendarSheet()}><div className="l">This week 📅</div><div className="v">{wThisWeek}<span className="muted" style={{ fontSize: '1rem' }}>{plannedPerWeek ? ' / ' + plannedPerWeek : ''}</span></div></div>
        <div className="tile tappable" onClick={() => calendarSheet()}><div className="l">Week streak 📅</div><div className="v">{streakWeeks(S)} 🔥</div></div>
        <div className="tile tappable" onClick={() => calendarSheet()}><div className="l">Total workouts</div><div className="v">{S.workouts.length}</div></div>
        <div className="tile"><div className="l">Last volume</div><div className="v" style={{ fontSize: '1.15rem' }}>{lastW ? fmtVol(lastW.vol, S.unit) : '—'}</div></div>
      </div>

      {S.workouts.length > 0 && <>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h4 className="sec" style={{ margin: 0 }}>Recent workouts</h4>
          <button className="btn sm ghost accent" onClick={() => nav('/history')}>See all ›</button>
        </div>
        <div className="list">{[...S.workouts].reverse().slice(0, 3).map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
      </>}
    </div></div>
  </>
}
