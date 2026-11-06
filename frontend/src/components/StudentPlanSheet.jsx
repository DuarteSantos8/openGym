import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { uid, exerciseNameText, DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { exLine, pickedExerciseConfig } from '../lib/history.js'
import { exOr } from '../lib/exercises.js'
import { buildPlanBundle, parsePlan } from '../lib/plan-share.js'
import { planExport } from '../lib/admin-export.js'
import { exercisePicker, exConfigSheet, confirmSheet } from '../sheets.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const WEEK = [1, 2, 3, 4, 5, 6, 0]
const letter = i => String.fromCharCode(65 + (i % 26))
const blank = i => ({ id: uid(), name: t('Routine {0}', letter(i)), ex: [], days: [] })

// A teacher builds a student's plan without leaving the student's profile, in three plain steps:
// how to start (from nothing, from one of their own plans, from another student's, from a file),
// the routines with their exercises and weekdays, and a review of what will be sent. It goes to
// the student's inbox, where they add it with one tap; nothing in their own plan changes before
// they do, and the teacher's own plan is never touched.
export default function StudentPlanSheet({ student, onSent, close }) {
  const toast = useUI(s => s.toast)
  const unit = useStore(s => s.S.unit) || 'kg'
  const [step, setStep] = useState('start')                // 'start' | 'edit'
  const [pick, setPick] = useState(null)                   // 'mine' | 'student' while choosing what to copy
  const [name, setName] = useState(t('Plan for {0}', student.name))
  const [routines, setRoutines] = useState(() => [blank(0)])
  const [brought, setBrought] = useState([])               // custom exercises that came with a copied plan
  const [students, setStudents] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const edit = (id, fn) => setRoutines(rs => rs.map(r => (r.id === id ? fn({ ...r, ex: r.ex.slice(), days: r.days.slice() }) : r)))
  const addRoutine = () => setRoutines(rs => [...rs, blank(rs.length)])
  const dropRoutine = id => setRoutines(rs => rs.filter(r => r.id !== id))
  const hasWork = routines.some(r => r.ex.length)

  /* ---------------------------------------------------------------- step 1: how to start */

  // A parsed plan (parsePlan's shape) becomes the editable routines. `only` keeps one routine.
  const take = (p, only) => {
    const keep = only ? p.routines.filter(r => String(r.id) === String(only)) : p.routines
    if (!keep.length) return toast(t('That plan has no routines.'))
    setRoutines(keep.map(r => ({ ...r, id: r.id || uid(), days: WEEK.filter(d => [].concat(p.week?.[d] || []).includes(r.id)) })))
    setBrought(p.customEx || [])
    if (p.name && !only) setName(p.name)
    setStep('edit'); setPick(null)
    toast(p.dropped ? t('Loaded. {0} exercise(s) in it do not exist here and were left out.', p.dropped) : t('Loaded. Change anything you like before sending.'))
  }
  const parse = (raw, only) => {
    try { take(parsePlan(raw, unit), only) } catch (e) { toast(e?.code === 'not-plan' ? t('Import failed: {0}', e.message) : t('Couldn’t read that file.')) }
  }
  const loadFile = f => {
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => parse(rd.result)
    rd.readAsText(f)
  }
  const myPlans = (useStore.getState().S.routines || []).filter(r => r && Array.isArray(r.ex) && r.ex.length)
  const takeMine = id => parse(buildPlanBundle(useStore.getState().S, ''), id)
  const openStudents = () => {
    setPick('student')
    if (!students) api('/api/admin/users').then(r => setStudents(r.users.filter(u => u.id !== student.id && !u.admin && !u.disabled && u.routines > 0))).catch(e => toast(e.message))
  }
  const takeStudent = u => api('/api/admin/user?id=' + encodeURIComponent(u.id)).then(d => parse(planExport(d, null).text)).catch(e => toast(e.message))

  /* ---------------------------------------------------------------- step 2: routines */

  const addExercise = r => exercisePicker((ex, quick) => {
    if (quick) {
      edit(r.id, x => { x.ex.push({ id: ex.id, ...pickedExerciseConfig(ex.id) }); return x })
      toast(t('“{0}” added to {1}', exerciseNameText(ex), r.name))
    } else {
      exConfigSheet(ex, null, cfg => edit(r.id, x => { x.ex.push({ id: ex.id, ...cfg }); return x }), null, r, null, null, undefined, { backups: true })
    }
  }, { title: t('Add exercise') })
  const editExercise = (r, i) => {
    const e = r.ex[i]
    exConfigSheet(exOr(e.id), e, cfg => edit(r.id, x => { x.ex[i] = { id: e.id, ...cfg }; return x }), () => edit(r.id, x => { x.ex.splice(i, 1); return x }), r, null, null, undefined, { backups: true })
  }

  /* ---------------------------------------------------------------- step 3: review and send */

  const ready = routines.filter(r => r.ex.length)
  const empty = routines.filter(r => !r.ex.length)
  const days = WEEK.filter(d => ready.some(r => r.days.includes(d)))
  const exerciseCount = ready.reduce((n, r) => n + r.ex.length, 0)
  const send = () => {
    if (!ready.length) return toast(t('Add at least one exercise first.'))
    setBusy(true)
    const week = {}
    for (const d of WEEK) { const ids = ready.filter(r => r.days.includes(d)).map(r => r.id); if (ids.length) week[d] = ids }
    // The teacher's own custom exercises travel with the plan when it uses them (buildPlanBundle),
    // and so do the ones that came with a plan copied from someone else.
    const mine = useStore.getState().S.customEx || []
    const customEx = [...mine, ...brought.filter(c => !mine.some(m => m.id === c.id))]
    const S = { unit, routines: ready.map(({ days: _d, ...r }) => ({ ...r, name: r.name.trim() || t('Routine') })), week, customEx }
    const bundle = buildPlanBundle(S, name.trim() || t('Plan for {0}', student.name))
    api('/api/admin/user/plan', { method: 'POST', body: JSON.stringify({ id: student.id, bundle }) })
      .then(r => { toast(t('Sent. {0} waiting for {1}.', r.pending, student.name)); onSent?.(); close() })
      .catch(e => { setBusy(false); toast(e.message) })
  }
  // Closing with work in it asks first: the sheet is locked, so a stray tap beside it cannot lose a plan.
  const leave = () => (hasWork
    ? confirmSheet({ title: t('Discard this plan?'), message: t('What you built here has not been sent and will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: close })
    : close())
  const startOver = () => (hasWork
    ? confirmSheet({ title: t('Start over?'), message: t('What you built here will be lost.'), confirmText: t('Start over'), danger: true, onConfirm: () => { setRoutines([blank(0)]); setBrought([]); setStep('start') } })
    : setStep('start'))

  const banner = <div className="adm-pill acc" style={{ margin: '0 0 8px', display: 'inline-block' }}>{t('Not your own plan: this one is for {0}.', student.name)}</div>
  const fileInput = <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => { loadFile(e.target.files?.[0]); e.target.value = '' }} />

  if (step === 'start') {
    const option = (icon, title, sub, onClick) => <div className="item" role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter') onClick() }}>
      <span className="lrow-i"><Icon name={icon} /></span>
      <div className="grow"><div className="tt">{title}</div><div className="ss">{sub}</div></div>
      <Icon name="chevronRight" className="chev" />
    </div>
    return <>
      <h3>{t('Plan for {0}', student.name)}</h3>
      {banner}
      {fileInput}
      {!pick && <>
        <div className="adm-lead">{t('How do you want to start?')}</div>
        <div className="list">
          {option('plus', t('From scratch'), t('Add the exercises one by one'), () => setStep('edit'))}
          {option('clipboard', t('Copy one of my plans'), t('From your own Plan tab'), () => setPick('mine'))}
          {option('person', t('Copy from another student'), t('Their plans become your starting point'), openStudents)}
          {option('download', t('From a plan file'), t('Downloaded from a student’s Plans, or exported from a Plan tab'), () => fileRef.current?.click())}
        </div>
      </>}
      {pick === 'mine' && <>
        <div className="adm-lead">{t('Pick one of your plans')}</div>
        {myPlans.map(r => <button key={r.id} className="btn" style={{ marginBottom: 8 }} onClick={() => takeMine(r.id)}>{r.name} · {t('{0} exercises', r.ex.length)}</button>)}
        {!myPlans.length && <div className="adm-empty">{t('You have no plans with exercises yet.')}</div>}
        <Button variant="ghost" className="dim" onClick={() => setPick(null)}>{t('Back')}</Button>
      </>}
      {pick === 'student' && <>
        <div className="adm-lead">{t('Pick a student')}</div>
        {!students ? <div className="muted small">{t('Loading…')}</div> : students.map(u => <button key={u.id} className="btn" style={{ marginBottom: 8 }} onClick={() => takeStudent(u)}>{u.name} · {t('{0} plans', u.routines)}</button>)}
        {students && !students.length && <div className="adm-empty">{t('No other student has a plan yet.')}</div>}
        <Button variant="ghost" className="dim" onClick={() => setPick(null)}>{t('Back')}</Button>
      </>}
      {!pick && <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>}
    </>
  }

  return <>
    <h3>{t('Plan for {0}', student.name)}</h3>
    {banner}
    {fileInput}

    <h4 className="sec">{t('1. Name the plan')}</h4>
    <input className="input" value={name} onChange={e => setName(e.target.value)} aria-label={t('Plan name')} placeholder={t('Plan name')} maxLength={80} />

    <h4 className="sec">{t('2. Routines and exercises')}</h4>
    <div className="adm-hint" style={{ marginTop: 0 }}>{t('A routine is one workout, like “Chest and triceps”. Pick the days it is for, then add its exercises.')}</div>
    {routines.map(r => <div key={r.id} className="card" style={{ marginBottom: 10 }}>
      <div className="row between" style={{ gap: 8 }}>
        <input className="input grow" value={r.name} onChange={e => edit(r.id, x => { x.name = e.target.value; return x })} aria-label={t('Name of this routine')} maxLength={40} />
        {routines.length > 1 && <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => dropRoutine(r.id)} aria-label={t('Remove routine')}><Icon name="trash" /></button>}
      </div>
      <div className="chips" style={{ margin: '8px 0' }} role="group" aria-label={t('Days')}>
        {WEEK.map(d => <button key={d} className={'chip' + (r.days.includes(d) ? ' on' : '')} onClick={() => edit(r.id, x => { x.days = x.days.includes(d) ? x.days.filter(v => v !== d) : [...x.days, d]; return x })}>{t(DAYS[d])}</button>)}
      </div>
      {r.ex.map((e, i) => <div key={i} className="item" onClick={() => editExercise(r, i)}>
        <div className="grow"><div className="tt">{exerciseNameText(exOr(e.id))}</div><div className="ss">{exLine(e, unit)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
      <Button size="sm" icon="plus" onClick={() => addExercise(r)}>{t('Add exercise')}</Button>
    </div>)}
    <Button size="sm" icon="plus" onClick={addRoutine} style={{ marginBottom: 6 }}>{t('Add routine')}</Button>

    <h4 className="sec">{t('3. Review and send')}</h4>
    <div className="card" aria-live="polite">
      <div className="small" style={{ fontWeight: 600 }}>{t('{0} routines · {1} exercises', ready.length, exerciseCount)}</div>
      <div className="adm-hint" style={{ marginTop: 4 }}>{days.length ? t('Days: {0}', days.map(d => t(DAYS[d])).join(', ')) : t('No days chosen: {0} decides when to train.', student.name)}</div>
      {empty.map(r => <div key={r.id} className="adm-hint" style={{ color: 'var(--orange)' }}>{t('“{0}” has no exercises and will not be sent.', r.name || t('Routine'))}</div>)}
    </div>
    <Button variant="primary" onClick={send} disabled={busy || !ready.length}>{t('Send to {0}', student.name)}</Button>
    <div className="adm-hint">{t('{0} gets it in their inbox and adds it with one tap. Nothing of theirs changes before that.', student.name)}</div>
    <div className="row" style={{ gap: 8, marginTop: 4 }}>
      <Button variant="ghost" className="dim" onClick={startOver}>{t('Start over')}</Button>
      <Button variant="ghost" className="dim" onClick={leave}>{t('Cancel')}</Button>
    </div>
  </>
}
