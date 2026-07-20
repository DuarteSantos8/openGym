import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout } from '../sheets.jsx'

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  return <div className="narrow">
    <div className="hdr"><div><h1>Start workout</h1><div className="sub">{DAYN[new Date().getDay()]} — {todayR ? 'today is ' + todayR.name : 'rest day, but no one’s stopping you'}</div></div></div>
    {todayR && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">Today's plan{todayOvr ? ' · rescheduled' : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{todayR.ex.length} exercises</div></div>
        <div style={{ fontSize: '2rem' }}>{todayR.emoji || '💪'}</div>
      </div>
      <button className="btn primary" onClick={() => startFlow(todayR.id)}>Start {todayR.name} ▶</button>
    </div>}
    {others.length > 0 && <><h4 className="sec">Other routines</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <div style={{ fontSize: '1.5rem', flex: 'none' }}>{r.emoji || '💪'}</div>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{r.ex.length} exercises</div></div>
        <span className="tag acc">Start ▶</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    <button className="btn" onClick={() => startFlow(null)}>🎯 Freestyle workout (pick as you go)</button>
    {!S.routines.length && <><div style={{ height: 10 }} /><button className="btn primary" onClick={() => nav('/plan')}>Build a plan first</button></>}
  </div>
}

/* ---------- one exercise block (used standalone or inside a superset card) ---------- */
function ExerciseBlock({ entryIdx, compact, onToggle, onWeight, onReps, onAddSet }) {
  const S = useStore(s => s.S)
  const entry = S.active.entries[entryIdx]
  const ex = EXIDX[entry.id]
  const last = lastEntryFor(S, entry.id)
  const best = bestWeightFor(S, entry.id)
  const hint = last && last.sets.length >= (entry.target.sets || 1) && last.sets.every(s => s.r >= entry.target.reps) && last.sets[0].w > 0
    ? Math.max(...last.sets.map(s => s.w)) + 2.5 : null
  return <>
    <Media ex={ex} key={entry.id} compact={compact} />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: compact ? '1.05rem' : '1.2rem', fontWeight: 800, textTransform: 'capitalize', lineHeight: 1.2 }}>{ex.n}</div>
      <button className="iconbtn" onClick={() => exerciseDetailSheet(ex)}>ℹ️</button>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      <span className="tag">{ex.tg || ex.bp}</span><span className="tag">{ex.eq}</span>
      {best > 0 && <span className="tag">Best: {fmtNum(best)} {S.unit}</span>}
    </div>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>Last time ({fmtDate(last.d)}): {last.sets.map(s => fmtNum(s.w) + '×' + s.r).join(', ')}</div>}
    {hint && <button className="tag acc" style={{ border: 'none' }} onClick={() => onWeight(-1, hint)}>💡 Last time you hit all reps — try {fmtNum(hint)} {S.unit}</button>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      <div className="sethead"><span className="n-sp" /><span className="w-sp">Weight ({S.unit})</span><span className="r-sp">Reps</span><span className="ck-sp" /></div>
      {entry.sets.map((s, i) => <div key={i} className={'setrow' + (s.done ? ' done' : '')}>
        <div className="n">{i + 1}</div>
        <div className="step w">
          <button onClick={() => onWeight(i, Math.max(0, (s.w || 0) - 2.5))}>−</button>
          <input type="number" inputMode="decimal" value={s.w} onFocus={e => e.target.select()} onChange={e => onWeight(i, e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0))} />
          <button onClick={() => onWeight(i, Math.max(0, (s.w || 0) + 2.5))}>+</button>
        </div>
        <div className="step r">
          <button onClick={() => onReps(i, Math.max(0, (s.r || 0) - 1))}>−</button>
          <input type="number" inputMode="numeric" value={s.r} onFocus={e => e.target.select()} onChange={e => onReps(i, e.target.value === '' ? 0 : Math.max(0, Math.round(parseFloat(e.target.value) || 0)))} />
          <button onClick={() => onReps(i, Math.max(0, (s.r || 0) + 1))}>+</button>
        </div>
        <button className={'ck' + (s.done ? ' on' : '')} onClick={() => onToggle(i)}><svg viewBox="0 0 24 24"><path d="m4.5 12.5 5 5 10-11" /></svg></button>
      </div>)}
      <div style={{ height: 8 }} />
      <button className="btn sm" onClick={onAddSet}>+ Add set</button>
    </div>
  </>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  const A = S.active
  const [elapsed, setElapsed] = useState('0:00')

  useEffect(() => {
    const tick = () => { const sec = Math.floor((Date.now() - A.start) / 1000); setElapsed(Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [A.start])

  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  const setWeight = (idx, i, v) => { if (i === -1) mutEntry(idx, e => e.sets.forEach(s => { if (!s.done) s.w = v })); else mutEntry(idx, e => { e.sets[i].w = v }) }
  const setReps = (idx, i, v) => mutEntry(idx, e => { e.sets[i].r = v })
  const addSet = idx => mutEntry(idx, e => { const l = e.sets[e.sets.length - 1]; e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false }) })

  const toggle = (idx, i) => {
    let askTop = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        const isLastExInUnit = idx === unit[unit.length - 1]
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (isLastExInUnit && !unitDone) startRest(S.restSec)
        else if (unitDone) stopRest()
        if (e.sets.every(x => x.done) && !e.asked) { e.asked = true; askTop = true }
      }
    })
    if (askTop) topWeightSheet(idx)
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => { if (confirm('Discard this workout? Logged sets will be lost.')) { update(s => { s.active = null }); stopRest(); nav('/home') } }}>✕</button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 800 }}>{A.name}</div><div className="sub">{elapsed} · {done}/{total} sets</div></div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} onClick={finishWorkout}>✓</button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <>
      <div className="muted small" style={{ marginBottom: 6 }}>{isSuperset ? `Superset ${unitIdx + 1} / ${units.length}` : `Exercise ${unitIdx + 1} / ${units.length}`}</div>
      {isSuperset ? (
        <div className="ss-card">
          <div className="ss-hd">🔗 Superset · do these back-to-back, rest after both</div>
          {unit.map((idx, k) => <div key={idx} className="ss-ex">
            {k > 0 && <div className="ss-amp">+</div>}
            <ExerciseBlock entryIdx={idx} compact
              onToggle={i => toggle(idx, i)} onWeight={(i, v) => setWeight(idx, i, v)} onReps={(i, v) => setReps(idx, i, v)} onAddSet={() => addSet(idx)} />
          </div>)}
        </div>
      ) : (
        <ExerciseBlock entryIdx={cur} onToggle={i => toggle(cur, i)} onWeight={(i, v) => setWeight(cur, i, v)} onReps={(i, v) => setReps(cur, i, v)} onAddSet={() => addSet(cur)} />
      )}
    </> : <div className="empty"><div className="ico">🎯</div>Freestyle workout — add your first exercise.</div>}

    <div style={{ height: 12 }} />
    <div className="row">
      <button className="btn" disabled={unitIdx <= 0} onClick={() => update(s => { s.active.cur = units[unitIdx - 1][0] })}>‹ Prev</button>
      <button className="btn" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => update(s => { s.active.cur = units[unitIdx + 1][0] })}>Next ›</button>
    </div>
    <div style={{ height: 10 }} />
    <button className="btn" onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
      s.active.entries.push({ id: ex.id, target: { ...cfg }, sets: buildSets(s, { ...cfg, id: ex.id }) })
      s.active.cur = s.active.entries.length - 1
    })))}>+ Add exercise</button>
    <div style={{ height: 10 }} />
    <button className="btn primary" onClick={finishWorkout}>Finish workout 🏁</button>
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
