import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtVol } from '../lib/format.js'
import { studentProgress } from '../lib/student-progress.js'
import { useStudentDoc, FichasPanel, PerformancePanel, WorkoutsPanel } from '../components/StudentPanels.jsx'
import Icon from '../components/Icon.jsx'
import { Segmented } from '../components/ui.jsx'
import '../admin.css'

// One student, in three parts: their plans, how they are doing, their workouts. The page says
// whose it is at the top and on the plan button, so a plan is never made in the wrong profile.

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0} min ago', Math.floor(s / 60))
  if (s < 86400) return t('{0} h ago', Math.floor(s / 3600))
  return t('{0} d ago', Math.floor(s / 86400))
}

export default function Student() {
  const nav = useNavigate()
  const { id } = useParams()
  const me = useStore(s => s.user)
  const { d, load, act } = useStudentDoc(id)
  const [tab, setTab] = useState('plans')
  const [viewerOwner, setViewerOwner] = useState(false)
  useEffect(() => {
    if (!me?.admin) return
    api('/api/admin/users').then(r => setViewerOwner(!!r.users.find(u => u.id === me.id)?.owner)).catch(() => {})
  }, [])
  if (!me?.admin) return null

  const back = <button className="iconbtn" data-back="/students" onClick={() => nav('/students')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
  if (!d) return <div className="narrow"><div className="hdr">{back}<div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>{t('Students')}</h1></div></div><div className="muted small">{t('Loading…')}</div></div>

  const u = d.user
  const canDelete = viewerOwner || !u.admin
  const prog = studentProgress(d)
  const delta = (x, unit) => x?.delta == null ? '' : ' (' + (x.delta > 0 ? '+' : '') + x.delta + unit + ')'
  const self = u.id === me.id

  return <div className="narrow">
    <div className="hdr">
      {back}
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }} className="capitalize">{u.name}</h1>
        <div className="sub">{self ? t('This is you') : t('Student') + (u.teacherName ? ' · ' + t('Teacher: {0}', u.teacherName) : '')} · {t('last sync {0}', rel(d.lastSync))}</div></div>
      <button className="iconbtn" onClick={load} aria-label={t('Refresh')}>↻</button>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '0 0 8px' }}>
      {u.owner ? <span className="adm-pill acc">{t('owner')}</span> : u.admin && <span className="adm-pill acc">{t('admin')}</span>}
      {u.disabled && <span className="adm-pill bad">{t('disabled')}</span>}
      <span className="adm-pill">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '–')}</span>
    </div>
    <div className="adm-intro">{self ? t('Your own record, as a teacher sees it.') : t('You are looking at {0}. Plans made here are for {0}; your own plan is in the Plan tab.', u.name)}</div>

    <div className="tiles" style={{ textAlign: 'start', marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Weight')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.weight ? prog.weight.last + ' ' + d.unit + delta(prog.weight, '') : '–'}</div></div>
      <div className="tile"><div className="l">{t('Body fat')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.bodyFat ? prog.bodyFat.last + '%' + delta(prog.bodyFat, ' pts') : '–'}</div></div>
      <div className="tile"><div className="l">{t('Workouts, 30 days')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.last30.count} <span className="dim">{t('vs {0} before', prog.prev30.count)}</span></div></div>
      <div className="tile"><div className="l">{t('Volume, 30 days')}</div><div className="v" style={{ fontSize: '.95rem' }}>{fmtVol(prog.last30.volume, d.unit)}</div></div>
      <div className="tile"><div className="l">{t('PRs, 30 days')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.last30.prs}</div></div>
    </div>

    <Segmented value={tab} onChange={setTab}
      options={[{ value: 'plans', label: t('Plans') }, { value: 'performance', label: t('Performance') }, { value: 'workouts', label: t('Workouts') }]} />
    <div className="card" style={{ marginTop: 12 }}>
      {tab === 'plans' && <FichasPanel d={d} canDelete={canDelete} act={act} reload={load} />}
      {tab === 'performance' && <PerformancePanel d={d} />}
      {tab === 'workouts' && <WorkoutsPanel d={d} canDelete={canDelete} act={act} />}
    </div>

    {!self && <button className="btn" style={{ marginTop: 12 }} onClick={() => nav('/admin', { state: { openUser: u.id } })}>{t('Account and access')}</button>}
  </div>
}
