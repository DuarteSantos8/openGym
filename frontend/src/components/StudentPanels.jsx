import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtVol, fmtDur, exerciseNameText } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { exLine } from '../lib/history.js'
import { buildPlanBundle } from '../lib/plan-share.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { studentPerformance } from '../lib/student-progress.js'
import { workoutExport, planExport, saveText } from '../lib/admin-export.js'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import StudentPlanSheet from './StudentPlanSheet.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The three areas of a student's page (views/Student.jsx): their plans, how they are doing, and
// their workouts. Each one works on the drill-down document (GET /api/admin/user) and reloads it
// after every change, so what the teacher sees is what the server holds.

/** The student's document, a way to reload it, and `act` for the POST routes that change it. */
export function useStudentDoc(id) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { setD(null); load() }, [id])
  const act = (path, body, done) => api(path, { method: 'POST', body: JSON.stringify({ id, ...body }) })
    .then(r => { done?.(r); return load() }).catch(e => toast(e.message))
  return { d, load, act }
}

/* ------------------------------------------------------------------ plans (fichas) */

// Another student to send one of these plans to: the same inbox, the same one-tap acceptance.
function PickStudentSheet({ fromId, bundle, close }) {
  const toast = useUI(s => s.toast)
  const me = useStore(s => s.user)
  const [list, setList] = useState(null)
  useEffect(() => { api('/api/admin/users').then(r => setList(r.users.filter(u => u.id !== fromId && u.id !== me?.id && !u.admin && !u.disabled))).catch(e => toast(e.message)) }, [])
  const send = u => api('/api/admin/user/plan', { method: 'POST', body: JSON.stringify({ id: u.id, bundle }) })
    .then(r => { toast(t('Sent. {0} waiting for {1}.', r.pending, u.name)); close() }).catch(e => toast(e.message))
  return <>
    <h3>{t('Send “{0}” to…', bundle.name)}</h3>
    <div className="adm-lead">{t('Pick the student who gets a copy. They add it with one tap; nothing of theirs changes before that.')}</div>
    {!list ? <div className="muted small">{t('Loading…')}</div> : list.map(u => <button key={u.id} className="btn" style={{ marginBottom: 8 }} onClick={() => send(u)}>{u.name}</button>)}
    {list && !list.length && <div className="adm-empty">{t('There is no other student to send it to.')}</div>}
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export function FichasPanel({ d, canDelete, act, reload }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [open, setOpen] = useState(null)
  const u = d.user
  const create = () => openSheet(done => <StudentPlanSheet student={u} onSent={reload} close={done} />)
  const archive = (r, archived) => act('/api/admin/user/routines/archive', { routines: [String(r.id)], archived },
    x => toast(archived ? t('{0} archived', x.changed) : t('{0} restored', x.changed)))
  const remove = r => confirmSheet({
    title: t('Delete “{0}”?', r.name),
    message: t('The plan is removed from {0}’s own plan too, on their phone as well, and this cannot be undone. Archive it instead to keep it.', u.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => act('/api/admin/user/routines/delete', { routines: [String(r.id)] }, x => toast(t('{0} deleted', x.removed)))
  })
  const save = f => saveText(f).then(() => toast(t('File saved'))).catch(() => { /* share sheet dismissed */ })
  const copyTo = r => openSheet(done => <PickStudentSheet fromId={u.id} bundle={JSON.parse(planExport(d, [String(r.id)]).text)} close={done} />)
  const menu = r => menuSheet({
    title: r.name,
    items: [
      { icon: 'download', label: t('Download plan file'), sub: t('The file the Plan tab imports'), onClick: () => save(planExport(d, [String(r.id)])) },
      { icon: 'share', label: t('Send to another student…'), onClick: () => copyTo(r) },
      { icon: r.archived ? 'reset' : 'folder', label: r.archived ? t('Restore') : t('Archive'), sub: r.archived ? t('Not archived any more') : t('Marks it as archived for you; the student keeps it'), onClick: () => archive(r, !r.archived) },
      canDelete && { icon: 'trash', label: t('Delete'), danger: true, onClick: () => remove(r) }
    ]
  })
  // The teacher's own routines and weekly schedule, as the plan file carries them, into the student's
  // inbox. A second way in, for a plan the teacher already uses themself.
  const sendMine = () => {
    const me = useStore.getState().user
    const bundle = buildPlanBundle(useStore.getState().S, t('Plan from {0}', me?.name || t('your teacher')))
    if (!bundle.routines.some(r => r.ex.length)) return toast(t('Build the plan in your own Plan tab first, then send it from here.'))
    confirmSheet({
      title: t('Send your plan to {0}?', u.name),
      message: t('{0} routine(s) and your weekly schedule. They choose whether to add it. Nothing of theirs is changed until they do.', bundle.routines.length),
      confirmText: t('Send plan'),
      onConfirm: () => api('/api/admin/user/plan', { method: 'POST', body: JSON.stringify({ id: u.id, bundle }) })
        .then(r => { toast(t('Sent. {0} waiting for {1}.', r.pending, u.name)); reload() }).catch(e => toast(e.message))
    })
  }
  const takeBack = p => confirmSheet({
    title: t('Take back “{0}”?', p.name || t('Plan')),
    message: t('{0} has not added it yet. It disappears from their inbox.', u.name),
    confirmText: t('Take back'),
    onConfirm: () => act('/api/admin/user/plan/cancel', { plan: p.id }, () => toast(t('Taken back')))
  })

  return <>
    <button className="btn primary" style={{ margin: '4px 0' }} onClick={create}>{t('New plan for {0}', u.name)}</button>
    <div className="adm-hint">{t('Plans made here are for {0}, not for you. They land in {0}’s inbox and are added with one tap.', u.name)}</div>

    <button className="btn" style={{ margin: '8px 0 4px' }} onClick={sendMine}>{t('Send a copy of my own plan')}</button>
    <div className="adm-hint">{t('Sends the routines and weekly schedule from your own Plan tab to {0}.', u.name)}</div>

    {(d.pending || []).length > 0 && <>
      <h4 className="sec">{t('On its way')}</h4>
      {d.pending.map(p => <div key={p.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{p.name || t('Plan')}</div>
          <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{t('Waiting for {0} to add it', u.name)} · {t('{0} routines', p.routines)}</div></div>
        <button className="btn" style={{ padding: '4px 10px' }} onClick={() => takeBack(p)}>{t('Take back')}</button>
      </div>)}
    </>}

    <h4 className="sec">{t('{0}’s plans', u.name)}</h4>
    {d.routines.length ? <div className="list" style={{ gap: 0 }}>
      {d.routines.map(r => <div key={r.id} style={{ borderBottom: '1px solid var(--sep)', opacity: r.archived ? .55 : 1 }}>
        <div className="row between" style={{ padding: '9px 2px' }}>
          <button className="grow" style={{ textAlign: 'start', background: 'none', border: 0, color: 'inherit', padding: 0 }} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div className="small" style={{ fontWeight: 600 }}>{r.emoji ? r.emoji + ' ' : ''}{r.name}{r.archived && <span className="adm-pill" style={{ marginInlineStart: 6 }}>{t('archived')}</span>}</div>
            <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{t('{0} exercises', r.count)}</div>
          </button>
          <button className="iconbtn adm-iconbtn" onClick={() => menu(r)} aria-label={t('Plan options')}><Icon name="more" /></button>
        </div>
        {open === r.id && <div style={{ padding: '0 2px 10px' }}>
          {(r.ex || []).map((e, i) => <div key={i} className="row between" style={{ padding: '4px 0' }}>
            <span className="small">{exerciseNameText(exOr(e.id))}</span>
            <span className="small muted">{exLine(e, d.unit)}</span>
          </div>)}
          {!(r.ex || []).length && <div className="adm-empty">{t('No exercises in this plan.')}</div>}
        </div>}
      </div>)}
    </div> : <div className="adm-empty">{t('No plans yet.')}</div>}
    {d.routines.length > 0 && <>
      <button className="btn" style={{ margin: '12px 0 4px' }} onClick={() => save(planExport(d, null))}>{t('Download all plans')}</button>
      <div className="adm-hint">{t('A plan file can be imported in the Plan tab, or used to start a new plan for another student.')}</div>
    </>}
  </>
}

/* ------------------------------------------------------------------ performance */

export function PerformancePanel({ d }) {
  const perf = studentPerformance(d)
  const top = Math.max(1, ...perf.weeks.map(x => x.volume))
  return <>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Sessions a week')}</div><div className="v" style={{ fontSize: '.95rem' }}>{perf.perWeek}{perf.planned ? <span className="dim"> {t('of {0} planned', perf.planned)}</span> : null}</div></div>
      <div className="tile"><div className="l">{t('Adherence')}</div><div className="v" style={{ fontSize: '.95rem' }}>{perf.adherence == null ? '–' : perf.adherence + '%'}</div></div>
    </div>
    {perf.planned == null && <div className="adm-hint">{t('Adherence needs a plan with days set.')}</div>}
    <div className="adm-lead" style={{ margin: '10px 0 4px' }}>{t('Volume per week, last 8 weeks')}</div>
    <div role="img" aria-label={t('Volume per week, last 8 weeks')} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 54 }}>
      {perf.weeks.map((wk, i) => <div key={i} title={fmtVol(wk.volume, d.unit) + ' · ' + wk.count} style={{ flex: 1, height: Math.max(3, Math.round(wk.volume / top * 54)), background: wk.count ? 'var(--acc)' : 'var(--sep)', borderRadius: 3, opacity: i === perf.weeks.length - 1 ? 1 : .7 }} />)}
    </div>
    {perf.strength.length > 0 && <>
      <div className="adm-lead" style={{ margin: '12px 0 2px' }}>{t('Estimated 1RM, last 120 days')}</div>
      {perf.strength.map(x => <div key={x.id} className="row between" style={{ padding: '6px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <span className="small">{exerciseNameText(exOr(x.id))}</span>
        <span className="small muted">{x.first} → {x.last} {d.unit} <b style={{ color: x.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>{x.delta > 0 ? '+' : ''}{x.pct}%</b></span>
      </div>)}
    </>}
  </>
}

/* ------------------------------------------------------------------ workouts */

export function WorkoutsPanel({ d, canDelete, act }) {
  const toast = useUI(s => s.toast)
  const [showArchived, setShowArchived] = useState(false)
  const [picked, setPicked] = useState(null)     // ids chosen for archive, delete or download; null = not selecting
  const u = d.user
  // Straight off the user's state file: an entry without sets has nothing to show and is skipped.
  const workouts = (d.workouts || []).filter(w => w && Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets)))
  const archivedCount = workouts.filter(w => w.archived).length
  const rows = workouts.filter(w => showArchived || !w.archived)
  const done = () => setPicked(null)

  const archive = (ids, archived) => act('/api/admin/user/workouts/archive', { workouts: ids, archived },
    r => { done(); toast(archived ? t('{0} archived', r.changed) : t('{0} restored', r.changed)) })
  const remove = ids => confirmSheet({
    title: t('Delete {0} workout(s)?', ids.length),
    message: t('They are removed from {0}’s own record too, on their phone as well, and this cannot be undone. Archive them instead to keep them.', u.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => act('/api/admin/user/workouts/delete', { workouts: ids }, r => { done(); toast(t('{0} deleted', r.removed)) })
  })
  const download = (ids, format) => {
    const f = workoutExport(d, ids, format)
    // A workout nobody ticked a set in has nothing to put in a spreadsheet; the JSON still has it.
    if (format === 'csv' && f.rows === 0) { toast(t('Those workouts have no completed sets, so the spreadsheet would be empty. The JSON still has them.')); return Promise.resolve() }
    return saveText(f).then(() => toast(t('File saved'))).catch(() => { /* share sheet dismissed */ })
  }
  const downloadMenu = ids => menuSheet({
    title: ids ? t('Download {0} workout(s)', ids.length) : t('Download all workouts'),
    subtitle: t('This is the workout history, not a plan. To copy a plan, use Plans.'),
    items: [
      { icon: 'download', label: t('Spreadsheet (CSV)'), sub: t('One row per set, opens in Excel or Sheets'), onClick: () => download(ids, 'csv') },
      { icon: 'download', label: 'JSON', sub: t('Everything as stored'), onClick: () => download(ids, 'json') }
    ]
  })
  const rowMenu = w => menuSheet({
    title: w.name,
    items: [
      { icon: 'download', label: t('Download'), onClick: () => downloadMenu([String(w.id)]) },
      { icon: w.archived ? 'reset' : 'folder', label: w.archived ? t('Restore') : t('Archive'), sub: w.archived ? t('Counts in the numbers again') : t('Keeps it, leaves it out of the numbers'), onClick: () => archive([String(w.id)], !w.archived) },
      canDelete && { icon: 'trash', label: t('Delete'), danger: true, onClick: () => remove([String(w.id)]) }
    ]
  })
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  if (!workouts.length) return <div className="adm-empty">{t('No workouts logged.')}</div>
  return <>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      <button className="btn" style={{ padding: '4px 10px' }} onClick={() => setPicked(picked ? null : [])}>{picked ? t('Done') : t('Select')}</button>
      <button className="btn" style={{ padding: '4px 10px' }} onClick={() => downloadMenu(null)}>{t('Download all')}</button>
      {archivedCount > 0 && <button className="chip" aria-pressed={showArchived} onClick={() => setShowArchived(v => !v)}>{showArchived ? t('Hide archived') : t('Show archived ({0})', archivedCount)}</button>}
    </div>
    {picked && <div className="row" style={{ gap: 6, margin: '0 0 8px', flexWrap: 'wrap' }}>
      <button className="btn" onClick={() => setPicked(rows.map(w => String(w.id)))}>{t('Select all')}</button>
      <button className="btn" disabled={!picked.length} onClick={() => downloadMenu(picked)}>{t('Download')} ({picked.length})</button>
      <button className="btn" disabled={!picked.length} onClick={() => archive(picked, true)}>{t('Archive')} ({picked.length})</button>
      {canDelete && <button className="btn danger" disabled={!picked.length} onClick={() => remove(picked)}>{t('Delete')} ({picked.length})</button>}
    </div>}
    {!rows.length ? <div className="adm-empty">{t('Everything is archived.')}</div> : <div className="list" style={{ gap: 0 }}>
      {rows.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', opacity: w.archived ? .55 : 1 }}
        onClick={picked ? () => toggle(String(w.id)) : undefined}>
        {picked && <input type="checkbox" readOnly checked={picked.includes(String(w.id))} aria-label={w.name} style={{ marginInlineEnd: 10 }} />}
        <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{w.name}{w.archived && <span className="adm-pill" style={{ marginInlineStart: 6 }}>{t('archived')}</span>}</div>
          <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
        {!picked && <button className="iconbtn adm-iconbtn" onClick={() => rowMenu(w)} aria-label={t('Workout options')}><Icon name="more" /></button>}
      </div>)}
    </div>}
    {rows.length > 60 && <div className="adm-hint">{t('Showing the latest 60. “Download all” has every workout.')}</div>}
  </>
}
