import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB, EXIDX, BODYPARTS, isCardio } from './lib/exercises.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, todayISO, uid, DAYN, MONTHS_LONG, ACCENTS } from './lib/format.js'
import { lastEntryFor, bestWeightFor, buildSets, effectiveRoutineId, workoutVolume, setsDone, setsDoneActive, lastBW, supersetUnits, unitOf, setLabel, defaultConfig } from './lib/history.js'
import { beep, vibrate } from './lib/sound.js'
import { nav } from './lib/nav.js'
import Media, { Thumb } from './components/Media.jsx'
import Stepper from './components/Stepper.jsx'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* ============================ starter plan ============================ */
export function loadStarterPlan() {
  const mk = (name, emoji, list) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) })
  update(st => {
    const push = mk('Push Day', '🫸', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]])
    const pull = mk('Pull Day', '🫷', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]])
    const legs = mk('Leg Day', '🦵', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]])
    st.routines.push(push, pull, legs)
    st.week[1] = push.id; st.week[3] = pull.id; st.week[5] = legs.id
  })
  toast('Starter plan loaded — Mon Push · Wed Pull · Fri Legs')
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, close }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const start = bw ? bw.w : 70
  const [v, setV] = useState(start)
  const clamp = x => Math.max(20, Math.min(300, Math.round((x || 0) * 10) / 10))
  const set = x => setV(clamp(x))                 // absolute (slider)
  const step = d => setV(p => clamp(p + d))       // relative (buttons/chips) — safe for rapid taps
  // fixed slider window around the starting value (buttons/quick chips can go beyond)
  const lo = Math.max(30, Math.round(start - 20))
  const hi = Math.min(250, Math.round(start + 20))
  const save = () => {
    const n = clamp(v)
    if (!n || n <= 0) { toast('Enter a valid weight'); return }
    update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (onDone) onDone(n); else toast('Weight saved ✓')
  }
  const recent = [...st.bodyweight].reverse().slice(0, 6)
  const delEntry = d => update(s => { s.bodyweight = s.bodyweight.filter(b => b.d !== d) })
  return <>
    <h3>{required ? 'Quick check-in ⚖️' : 'Log body weight'}</h3>
    <div className="muted small">{required ? 'Slide or tap to set your weight — tracked before every workout so your curve stays honest.' : 'Today, ' + fmtDate(todayISO(), true)}</div>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => step(-0.1)} aria-label="minus">−</button>
      <div className="bw-read">{fmtNum(v)}<span className="u"> {unit}</span></div>
      <button className="bw-pm" onClick={() => step(0.1)} aria-label="plus">+</button>
    </div>
    <input className="bw-slider" type="range" min={lo} max={hi} step="0.1"
      value={Math.max(lo, Math.min(hi, v))} onChange={e => set(parseFloat(e.target.value))}
      style={{ '--track': `linear-gradient(90deg, var(--acc) ${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%, var(--bg2) ${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%)` }} />
    <div style={{ height: 14 }} />
    <button className="btn primary" onClick={save}>{required ? 'Save & start workout' : 'Save'}</button>
    {required && <>
      <div style={{ height: 8 }} /><button className="btn ghost dim" onClick={() => { close(); onDone && onDone(null) }}>Skip today</button>
      <div style={{ height: 2 }} /><button className="btn ghost dim" onClick={() => { close(); nav('/workout') }}>↺ Choose a different workout</button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">Recent weigh-ins</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <div key={b.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--bg2)' }}>
          <span className="small muted">{fmtDate(b.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
            <button className="iconbtn" style={{ width: 34, height: 30, fontSize: '.9rem' }} onClick={() => delEntry(b.d)} aria-label="delete">🗑</button></span>
        </div>)}
      </div>
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: !!opts.required })
  return h
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--mut)'
  if (!S().targetW) return 'var(--txt)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? String(bw.w) : ''))
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 250) }, [])
  return <>
    <h3>Target weight 🎯</h3>
    <div className="muted small">Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.</div>
    <div className="bwin"><input ref={ref} type="number" inputMode="decimal" step="0.5" value={v} onChange={e => setV(e.target.value)} placeholder="0.0" /><span>{st.unit}</span></div>
    <button className="btn primary" onClick={() => {
      const n = parseFloat(v)
      if (!n || n <= 0 || n > 400) { toast('Enter a valid weight'); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast('Goal set: ' + fmtNum(n) + ' ' + st.unit + (b ? ' (' + fmtNum(Math.abs(n - b.w)) + ' to go)' : ''))
    }}>Save goal</button>
    {st.targetW && <><div style={{ height: 8 }} /><button className="btn danger" onClick={() => { update(s => { s.targetW = null }); close(); toast('Goal removed') }}>Remove goal</button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ exercise detail ============================ */
function ExerciseDetail({ ex }) {
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id)
  return <>
    <h3 className="capitalize">{ex.n}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      <span className="tag acc">{ex.bp}</span>
      {ex.tg && <span className="tag">🎯 {ex.tg}</span>}
      <span className="tag">🛠 {ex.eq}</span>
      {(ex.sm || []).slice(0, 3).map((s, i) => <span key={i} className="tag">{s}</span>)}
    </div>
    {best > 0 && <div className="small" style={{ marginBottom: 6 }}>🏆 Best: <b className="accent">{fmtNum(best)} {st.unit}</b>{last ? ` · last ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s)).join(', ')}` : ''}</div>}
    <button className="btn primary" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>＋ Add to my plan</button>
    {ex.st && ex.st.length > 0 && <><h4 className="sec">How to</h4><ol className="steps-list">{ex.st.map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
export const exerciseDetailSheet = ex => ui().openSheet(() => <ExerciseDetail ex={ex} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: 'New routine', emoji: '💪', ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast('“' + ex.n + '” added to ' + (r ? r.name : 'routine') + ' ✓')
      if (isNew && r) nav('/plan/r/' + r.id)
    })
  }
  return <>
    <h3 className="capitalize">Add “{ex.n}”</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Pick a routine — sets, reps & weight come next.</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => pick(r.id)}>
        <div style={{ fontSize: '1.3rem', flex: 'none' }}>{r.emoji || '💪'}</div>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{r.ex.length} exercises</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">already in</span>}<span className="chev">＋</span>
      </div>)}
      <div className="item" onClick={() => pick('_new')}><div style={{ fontSize: '1.3rem', flex: 'none' }}>✨</div>
        <div className="grow"><div className="tt">New routine</div><div className="ss">Create one and start with this exercise</div></div><span className="chev">＋</span></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach(w => w.entries.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
function ExercisePicker({ onPick, close }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')          // '' = all, '★' = chosen, else a body part
  const [shown, setShown] = useState(50)
  const ql = q.toLowerCase().trim()
  let f = EXDB.filter(e =>
    (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) &&
    (!ql || e.n.includes(ql) || e.tg.includes(ql) || e.eq.includes(ql)))
  if (bp === '★') f = [...f].sort((a, b) => (usage[b.id] - usage[a.id]) || (a.n < b.n ? -1 : 1))
  const chosenCount = Object.keys(usage).length
  return <>
    <h3>Add exercise</h3>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={`Search ${EXDB.length} exercises…`} value={q} onChange={e => { setQ(e.target.value); setShown(50) }} /></div>
    <div className="chips" style={{ margin: '10px 0' }}>
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setShown(50) }}>⭐ Chosen ({chosenCount})</button>}
      <button className={'chip' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(50) }}>All</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(50) }}>{b}</button>)}
    </div>
    <div className="list">
      {f.slice(0, shown).map(e => <div key={e.id} className="item" onClick={() => onPick(e)}>
        <Thumb ex={e} /><div className="grow"><div className="tt">{e.n}</div><div className="ss">{(e.tg || e.bp)} · {e.eq}</div></div>
        {usage[e.id] && <span className="tag acc">⭐</span>}<span className="chev">+</span>
      </div>)}
      {f.length === 0 && <div className="empty">{bp === '★' ? 'Nothing chosen yet — add exercises and they’ll show up here.' : 'No match 🤷'}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><button className="btn" onClick={() => setShown(s => s + 50)}>Show more</button></>}
  </>
}
export const exercisePicker = onPick => ui().openSheet(close => <ExercisePicker onPick={onPick} close={close} />)

/* ============================ exercise config ============================ */
function ExConfig({ ex, existing, onSave, onDelete, close }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  const [c, setC] = useState(existing || defaultConfig(ex.id))
  const save = () => {
    close()
    if (cardio) onSave({ sets: Math.max(1, Math.round(c.sets) || 1), min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8) })
    else onSave({ sets: Math.max(1, Math.round(c.sets) || 3), reps: Math.max(1, Math.round(c.reps) || 10), weight: Math.max(0, c.weight || 0) })
  }
  return <>
    <h3 className="capitalize">{ex.n}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc">🏃 Cardio</span>}
      <span className="tag">{ex.tg || ex.bp}</span><span className="tag">{ex.eq}</span>
    </div>
    <div className="row" style={{ justifyContent: 'space-around', marginBottom: 18 }}>
      {cardio ? <>
        <Stepper label="Intervals" value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label="Minutes" value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        <Stepper label="Speed (km/h)" value={c.speed} step={0.5} onChange={v => setC(x => ({ ...x, speed: v }))} />
      </> : <>
        <Stepper label="Sets" value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label="Reps" value={c.reps} step={1} decimal={false} onChange={v => setC(x => ({ ...x, reps: v }))} />
        <Stepper label={'Weight (' + st.unit + ')'} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </>}
    </div>
    <button className="btn primary" onClick={save}>{existing ? 'Save' : 'Add to routine'}</button>
    {onDelete && <><div style={{ height: 8 }} /><button className="btn danger" onClick={() => { close(); onDelete() }}>Remove exercise</button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} onSave={onSave} onDelete={onDelete} close={close} />)

/* ============================ emoji picker ============================ */
const ROUTINE_EMOJIS = ['💪', '🏋️', '🏋️‍♀️', '🦵', '🦾', '🫸', '🫷', '🔥', '⚡', '💥', '🏃', '🏃‍♀️', '🚴', '🏊', '🤸', '🥊', '🧗', '⛰️', '🏔️', '🚀', '🧘', '🧘‍♀️', '🎯', '🏆', '🥇', '⭐', '🌟', '👑', '🛡️', '⚔️', '🦍', '🐂', '🐻', '🦁', '🐺', '🦈', '😤', '🤖', '🧨', '❤️‍🔥']
export const emojiPicker = (current, onPick) => ui().openSheet(close => <>
  <h3>Pick an emoji</h3>
  <div className="emoji-grid">{ROUTINE_EMOJIS.map(e => <button key={e} className={'emoji-cell' + (e === current ? ' on' : '')} onClick={() => { close(); onPick(e) }}>{e}</button>)}</div>
</>)

/* ============================ day override / assign ============================ */
function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === st.week[wd])
  const hasOvr = st.dayPlan[iso] !== undefined
  const effId = effectiveRoutineId(st, iso)
  const set = v => {
    update(s => { if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v })
    close()
    toast(v === '' ? 'Back to weekly plan' : v === 'rest' ? fmtDate(iso) + ' set to rest' : (st.routines.find(r => r.id === v) || {}).name + ' planned for ' + fmtDate(iso) + ' ✓')
  }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>Weekly plan: {weeklyR ? weeklyR.name : 'Rest'}{hasOvr && <span style={{ color: 'var(--orange)' }}> · changed for this day</span>}<br />Sick, missed a day or want a different session? Pick what to train instead.</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <div style={{ fontSize: '1.3rem', flex: 'none' }}>{r.emoji || '💪'}</div>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{r.ex.length} exercises</div></div>
        {effId === r.id && <span className="accent">✓</span>}</div>)}
      <div className="item" onClick={() => set('rest')}><div className="grow"><div className="tt">😌 Rest / skip this day</div></div>{effId === null && <span className="accent">✓</span>}</div>
      {hasOvr && <div className="item" onClick={() => set('')}><div className="grow"><div className="tt">↺ Back to weekly plan</div></div></div>}
    </div>
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

function DayAssign({ day, close }) {
  const st = useStore(s => s.S)
  const set = v => { update(s => { if (v) s.week[day] = v; else delete s.week[day] }); close() }
  return <>
    <h3>{DAYN[day]}</h3>
    <div className="list">
      <div className="item" onClick={() => set('')}><div className="grow"><div className="tt">😌 Rest day</div></div>{!st.week[day] && <span className="accent">✓</span>}</div>
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <div style={{ fontSize: '1.3rem', flex: 'none' }}>{r.emoji || '💪'}</div>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{r.ex.length} exercises</div></div>
        {st.week[day] === r.id && <span className="accent">✓</span>}</div>)}
    </div>
  </>
}
export const dayAssignSheet = day => ui().openSheet(close => <DayAssign day={day} close={close} />)

/* ============================ workout detail ============================ */
function WorkoutDetail({ w, close }) {
  const st = useStore(s => s.S)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{fmtDate(w.d, true)} · {fmtDur(w.end - w.start)} · {fmtVol(w.vol, st.unit)}{w.bw ? ' · ⚖️ ' + fmtNum(w.bw) + ' ' + st.unit : ''}</div>
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} />}
        <div className="grow"><div className="tt capitalize" style={{ fontWeight: 700 }}>{ex ? ex.n : e.id} {w.prs && w.prs.includes(e.id) && <span className="pr">🏆 PR</span>}</div>
          <div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s)).join('  ·  ') || 'no sets'}</div></div>
      </div>
    })}
    <button className="btn danger" onClick={() => { if (confirm('Delete this workout from history?')) { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast('Workout deleted') } }}>Delete workout</button>
  </>
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
function Calendar({ start, close }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  st.workouts.forEach(w => (byDay[w.d] = byDay[w.d] || []).push(w))
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => w.d.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], effId = effectiveRoutineId(st, iso), ovr = st.dayPlan[iso] !== undefined
    const dotCls = ws ? 'done' : ovr && effId ? 'ovr' : effId ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet(c2 => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))}>‹</button>
      <h3 style={{ margin: 0 }}>{MONTHS_LONG[mo]} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))}>›</button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${monthWs.length} workout${monthWs.length > 1 ? 's' : ''} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : 'No workouts this month'}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{l}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />Trained</span>
      <span><i style={{ background: 'var(--blue)' }} />Planned</span>
      <span><i style={{ background: 'var(--orange)' }} />Rescheduled</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>Tap a trained day for details · tap any other day to plan a session</div>
  </>
}
export const calendarSheet = start => ui().openSheet(close => <Calendar start={start} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const emoji = (st.routines.find(r => r.id === w.routineId) || {}).emoji || '💪'
  return <div className="item" onClick={onClick}>
    <div style={{ fontSize: '1.5rem', flex: 'none' }}>{emoji}</div>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{fmtDate(w.d, true)} · {fmtDur(w.end - w.start)} · {setsDone(w)} sets · {fmtVol(w.vol, st.unit)}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr">🏆 {w.prs.length} PR</span>}
    <span className="chev">›</span>
  </div>
}

/* ============================ workout lifecycle ============================ */
export function startFlow(routineId) {
  bwSheet({ required: true, onDone: bw => beginWorkout(routineId, bw) })
}
export function beginWorkout(routineId, bw) {
  const st = S()
  const r = routineId ? st.routines.find(x => x.id === routineId) : null
  const entries = (r ? r.ex : []).map(cfg => ({ id: cfg.id, sg: cfg.sg, target: { ...cfg }, sets: buildSets(st, cfg) }))
  update(s => {
    s.active = { id: uid(), d: todayISO(), start: Date.now(), routineId, name: r ? r.name : 'Freestyle', bw: bw || null, cur: 0, entries }
  })
  useUI.getState().stopRest()
  nav('/workout')
}
function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = st.active
  const entry = A.entries[entryIdx]
  const ex = EXIDX[entry.id]
  const maxSet = Math.max(0, ...entry.sets.filter(s => s.done).map(s => s.w || 0))
  const prevBest = Math.max((st.exWeights[entry.id] || {}).w || 0, bestWeightFor(st, entry.id))
  const [v, setV] = useState(String(Math.max(maxSet, prevBest) || entry.target.weight || 0))
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 250) }, [])

  const units = supersetUnits(A.entries)
  const unit = unitOf(units, entryIdx)
  const unitDone = unit.every(i => A.entries[i].sets.every(s => s.done))
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1

  const commit = advance => {
    const n = parseFloat(v)
    if (!isFinite(n) || n < 0) { toast('Enter a valid weight'); return }
    update(s => {
      s.active.entries[entryIdx].topW = n
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }
    })
    close()
    if (advance && unitDone) {
      if (isLastUnit) workoutCompleteSheet()               // whole workout done → finish/continue prompt
      else update(s => { s.active.cur = units[unitIdx + 1][0] })
    } else toast('Tracked — next time starts at ' + fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit + ' 📈')
  }
  return <>
    <h3 className="capitalize">✅ {ex.n} done</h3>
    <div className="muted small">Confirm the weight you worked with — your highest becomes the default next time.{!unitDone && unit.length > 1 ? ' Then finish the superset partner.' : ''}</div>
    <div className="bwin"><input ref={ref} type="number" inputMode="decimal" step="0.5" value={v} onChange={e => setV(e.target.value)} /><span>{st.unit}</span></div>
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>Previous best: {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--gold)' }}> — new record! 🏆</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <button className="btn primary" onClick={() => commit(true)}>{isLastUnit ? 'Save ✓' : 'Save & next exercise ›'}</button>
      <div style={{ height: 8 }} /><button className="btn ghost dim" onClick={() => commit(false)}>Just close</button>
    </> : <button className="btn primary" onClick={() => commit(false)}>Save weight</button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: '3rem' }}>🎉</div>
    <h3 style={{ margin: '8px 0' }}>That's the whole workout!</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>Every exercise done — great work. Finish up, or keep going and add another exercise.</div>
    <button className="btn primary" onClick={() => { close(); finishWorkout() }}>Finish workout 🏁</button>
    <div style={{ height: 8 }} />
    <button className="btn" onClick={() => { close(); useUI.getState().toast('Keep going 💪 — tap “+ Add exercise” below') }}>Continue workout</button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

function FinishSummary({ w, prs, close }) {
  const st = useStore(s => s.S)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: '3rem' }}>🎉</div>
    <h3 style={{ margin: '8px 0' }}>Workout complete!</h3>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Duration</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">Volume</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">Sets</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsDone(w)}</div></div>
      <div className="tile"><div className="l">PRs</div><div className="v" style={{ fontSize: '1.1rem' }}>{prs.length ? '🏆 ' + prs.length : '—'}</div></div>
    </div>
    {prs.length > 0 && <div style={{ textAlign: 'left', marginBottom: 12 }}>{prs.map(id => <div key={id} className="small accent capitalize">🏆 New PR: {(EXIDX[id] || {}).n || id}</div>)}</div>}
    <button className="btn primary" onClick={() => { close(); nav('/home') }}>Nice! 💪</button>
  </div>
}
export function finishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const done = setsDoneActive(A)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  if (!done && !confirm('No sets logged — finish anyway?')) return
  if (done < total && done > 0 && !confirm('Some sets are unchecked. Finish workout?')) return
  const prs = []
  A.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w))
    if (mx > 0 && mx > bestWeightFor(st, e.id)) prs.push(e.id)
  })
  const w = {
    id: A.id, d: A.d, start: A.start, end: Date.now(), routineId: A.routineId, name: A.name, bw: A.bw,
    entries: A.entries.map(e => ({ id: e.id, sets: e.sets, topW: e.topW || null })).filter(e => e.sets.some(s => s.done)),
    prs
  }
  w.vol = workoutVolume(w)
  update(s => {
    w.entries.forEach(e => {
      const mx = Math.max(0, ...e.sets.filter(x => x.done).map(x => x.w || 0), e.topW || 0)
      if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d } }
    })
    s.workouts.push(w)
    s.active = null
  })
  useUI.getState().stopRest()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  ui().openSheet(close => <FinishSummary w={w} prs={prs} close={close} />, { kind: 'center', locked: true })
}
