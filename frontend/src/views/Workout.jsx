import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX, isCardio } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet } from '../sheets.jsx'

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

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise block (strength: weight×reps · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, compact, onToggle, onField, onBumpAll, onAddSet }) {
  const S = useStore(s => s.S)
  const entry = S.active.entries[entryIdx]
  const ex = EXIDX[entry.id]
  const cardio = isCardio(ex)
  const last = lastEntryFor(S, entry.id)
  const best = cardio ? 0 : bestWeightFor(S, entry.id)
  const hint = !cardio && last && last.sets.length >= (entry.target.sets || 1) && last.sets.every(s => s.r >= entry.target.reps) && last.sets[0].w > 0
    ? Math.max(...last.sets.map(s => s.w)) + 2.5 : null
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: 'Duration (min)' } : { f: 'w', step: 2.5, dec: true, hd: `Weight (${S.unit})` }
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: 'Speed (km/h)' } : { f: 'r', step: 1, dec: false, hd: 'Reps' }
  const cell = (s, i, col, cls) => (
    <div className={'step ' + cls}>
      <button onClick={() => onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) - col.step) * 100) / 100))}>−</button>
      <input type="number" inputMode={col.dec ? 'decimal' : 'numeric'} value={s[col.f] ?? ''} onFocus={e => e.target.select()}
        onChange={e => onField(i, col.f, e.target.value === '' ? 0 : Math.max(0, (col.dec ? parseFloat(e.target.value) : Math.round(parseFloat(e.target.value))) || 0))} />
      <button onClick={() => onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + col.step) * 100) / 100))}>+</button>
    </div>
  )
  return <>
    <Media ex={ex} key={entry.id} compact={compact} />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: compact ? '1.05rem' : '1.2rem', fontWeight: 800, textTransform: 'capitalize', lineHeight: 1.2 }}>{ex.n}</div>
      <button className="iconbtn" onClick={() => exerciseDetailSheet(ex)}>ℹ️</button>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc">🏃 Cardio</span>}
      <span className="tag">{ex.tg || ex.bp}</span><span className="tag">{ex.eq}</span>
      {best > 0 && <span className="tag">Best: {fmtNum(best)} {S.unit}</span>}
    </div>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>Last time ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s)).join(', ')}</div>}
    {hint && <button className="tag acc" style={{ border: 'none' }} onClick={() => { onBumpAll('w', hint); useUI.getState().toast('Weights bumped to ' + fmtNum(hint) + ' ' + S.unit + ' 💪') }}>💡 Last time you hit all reps — try {fmtNum(hint)} {S.unit}</button>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      <div className="sethead"><span className="n-sp" /><span className="w-sp">{col1.hd}</span><span className="r-sp">{col2.hd}</span><span className="ck-sp" /></div>
      {entry.sets.map((s, i) => <div key={i} className={'setrow' + (s.done ? ' done' : '')}>
        <div className="n">{i + 1}</div>
        {cell(s, i, col1, 'w')}
        {cell(s, i, col2, 'r')}
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
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  const setField = (idx, i, field, v) => mutEntry(idx, e => { e.sets[i][field] = v })
  const bumpAll = (idx, field, v) => mutEntry(idx, e => e.sets.forEach(s => { if (!s.done) s[field] = v }))
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    if (isCardio(e.id)) e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })

  const toggle = (idx, i) => {
    const cardioEntry = isCardio(A.entries[idx].id)
    const isLastUnit = unitIdx >= units.length - 1
    let askTop = false, exJustDone = false, workoutDone = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        const isLastExInUnit = idx === unit[unit.length - 1]
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (isLastExInUnit && !unitDone) startRest(S.restSec)
        else if (unitDone) stopRest()
        if (unitDone && isLastUnit) workoutDone = true      // last exercise's last set → done
        if (e.sets.every(x => x.done)) { exJustDone = true; if (!cardioEntry && !e.asked) { e.asked = true; askTop = true } }
      }
    })
    // non-cardio: topWeight first (it chains into the finish/continue prompt on the last unit).
    // cardio or already-confirmed: go straight to the prompt.
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast('Cardio logged 🏃')
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => { if (confirm('Discard this workout? Logged sets will be lost.')) { update(s => { s.active = null }); stopRest(); nav('/home') } }}>✕</button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 800 }}>{A.name}</div><div className="sub"><Elapsed start={A.start} /> · {done}/{total} sets</div></div>
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
              onToggle={i => toggle(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onBumpAll={(f, v) => bumpAll(idx, f, v)} onAddSet={() => addSet(idx)} />
          </div>)}
        </div>
      ) : (
        <ExerciseBlock entryIdx={cur} onToggle={i => toggle(cur, i)} onField={(i, f, v) => setField(cur, i, f, v)} onBumpAll={(f, v) => bumpAll(cur, f, v)} onAddSet={() => addSet(cur)} />
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
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {allDone ? 'Finish workout 🏁' : `Finish workout early · ${exDone}/${A.entries.length} exercises`}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
