import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { uid, exerciseNameText, DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { exLine, pickedExerciseConfig } from '../lib/history.js'
import { exOr } from '../lib/exercises.js'
import { buildPlanBundle, parsePlan } from '../lib/plan-share.js'
import { exercisePicker, exConfigSheet } from '../sheets.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const WEEK = [1, 2, 3, 4, 5, 6, 0]
const letter = i => String.fromCharCode(65 + (i % 26))

// A teacher builds a student's plan without leaving the student's profile: routines with their
// exercises (the same picker and set editor as the Plan tab) and, if wanted, the weekdays each
// one is for. It goes to the student's inbox, where they add it with one tap; nothing in their
// own plan changes before they do. The teacher's own plan is not touched either.
export default function StudentPlanSheet({ student, onSent, close }) {
  const toast = useUI(s => s.toast)
  const unit = useStore(s => s.S.unit) || 'kg'
  const [name, setName] = useState(t('Plan for {0}', student.name))
  const [routines, setRoutines] = useState(() => [{ id: uid(), name: t('Routine {0}', 'A'), ex: [], days: [] }])
  const [busy, setBusy] = useState(false)
  const [brought, setBrought] = useState([])      // custom exercises that came with a plan file
  const fileRef = useRef(null)

  // Start from a plan file (a student's plan downloaded from the Plans tab, or one exported from
  // anyone's Plan tab) instead of from nothing; everything stays editable before it is sent.
  const loadFile = f => {
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const p = parsePlan(rd.result, unit)
        if (!p.routines.length) return toast(t('That plan file has no routines.'))
        setRoutines(p.routines.map(r => ({ ...r, id: r.id || uid(), ex: r.ex, days: WEEK.filter(d => [].concat(p.week?.[d] || []).includes(r.id)) })))
        setBrought(p.customEx)
        if (p.name) setName(p.name)
        toast(p.dropped ? t('Loaded. {0} exercise(s) in it do not exist here and were left out.', p.dropped) : t('Loaded. Change anything you like before sending.'))
      } catch (e) { toast(e?.code === 'not-plan' ? t('Import failed: {0}', e.message) : t('Couldn’t read that file.')) }
    }
    rd.readAsText(f)
  }

  const edit = (id, fn) => setRoutines(rs => rs.map(r => (r.id === id ? fn({ ...r, ex: r.ex.slice(), days: r.days.slice() }) : r)))
  const addRoutine = () => setRoutines(rs => [...rs, { id: uid(), name: t('Routine {0}', letter(rs.length)), ex: [], days: [] }])
  const dropRoutine = id => setRoutines(rs => rs.filter(r => r.id !== id))

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

  const ready = routines.filter(r => r.ex.length)
  const send = () => {
    if (!ready.length) return toast(t('Add at least one exercise first.'))
    setBusy(true)
    const week = {}
    for (const d of WEEK) { const ids = ready.filter(r => r.days.includes(d)).map(r => r.id); if (ids.length) week[d] = ids }
    // The teacher's own custom exercises travel with the plan when it uses them (buildPlanBundle).
    const mine = useStore.getState().S.customEx || []
    const customEx = [...mine, ...brought.filter(c => !mine.some(m => m.id === c.id))]
    const S = { unit, routines: ready.map(({ days, ...r }) => ({ ...r, name: r.name.trim() || t('Routine') })), week, customEx }
    const bundle = buildPlanBundle(S, name.trim() || t('Plan for {0}', student.name))
    api('/api/admin/user/plan', { method: 'POST', body: JSON.stringify({ id: student.id, bundle }) })
      .then(r => { toast(t('Sent. {0} waiting for {1}.', r.pending, student.name)); onSent?.(); close() })
      .catch(e => { setBusy(false); toast(e.message) })
  }

  return <>
    <h3>{t('Plan for {0}', student.name)}</h3>
    <div className="adm-pill acc" style={{ margin: '0 0 8px', display: 'inline-block' }}>{t('Not your own plan: this one is for {0}.', student.name)}</div>
    <div className="adm-lead">{t('Build the routines here. {0} adds the plan with one tap; nothing of theirs changes before that.', student.name)}</div>
    <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => { loadFile(e.target.files?.[0]); e.target.value = '' }} />
    <Button size="sm" icon="download" onClick={() => fileRef.current?.click()} style={{ marginBottom: 8 }}>{t('Start from a plan file')}</Button>
    <input className="input" value={name} onChange={e => setName(e.target.value)} aria-label={t('Plan name')} placeholder={t('Plan name')} maxLength={80} style={{ marginBottom: 10 }} />
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
    <Button size="sm" icon="plus" onClick={addRoutine} style={{ marginBottom: 12 }}>{t('Add routine')}</Button>
    <Button variant="primary" onClick={send} disabled={busy || !ready.length}>{t('Send to {0}', student.name)}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
