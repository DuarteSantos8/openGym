import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { filterStudents, filterCounts, hubSummary, quietDays } from '../lib/student-filter.js'
import { everyoneExport, saveText } from '../lib/admin-export.js'
import { menuSheet } from '../sheets.jsx'
import StudentPlanSheet from '../components/StudentPlanSheet.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import '../admin.css'

// The teacher's own screen: every student in one list, who needs a word, a plan for each, and a
// way to bring someone in. Opened from Home and Settings; the Admin dashboard stays for running
// the server (accounts, invites, the Coach). A teacher only ever gets their own students from the
// server, the owner gets everyone.

// Who is listed. A teacher: their students (and the owner, if the owner picked them as a teacher).
// The owner: everyone, the other teachers included, since a teacher's own plans and workouts are
// the owner's to look after too.
const isListed = (u, me, owner) => u.id !== me && (owner || !u.admin || u.owner)
const isStudent = (u, me, owner) => u.id !== me && (!u.admin || (u.owner && !owner))

export default function Students() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [err, setErr] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('recent')

  const load = () => api('/api/admin/users')
    .then(d => { if (!Array.isArray(d?.users)) throw new Error(t('The server answered without a list of users.')); setUsers(d.users); setErr(null) })
    .catch(e => setErr(e.message || t('Failed to load')))
  useEffect(() => { if (!user?.admin) return; load(); const iv = setInterval(load, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const owner = !!(users || []).find(u => u.id === user.id)?.owner
  const listed = (users || []).filter(u => isListed(u, user.id, owner))
  const students = listed.filter(u => isStudent(u, user.id, owner))
  const sum = hubSummary(users || [], user.id)
  const counts = filterCounts(listed, user.id)
  const shown = filterStudents(listed, { query, filter, sort, me: user.id })
  const filters = [['all', t('All')], ['live', t('Training now')], ['quiet', t('Inactive 7+ days')], ['noplan', t('No plan yet')], ['mine', t('My students')], ['staff', t('Teachers')]]
    .filter(([id]) => id === 'all' || id === filter || counts[id] > 0)

  const invite = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite: i }) => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(t('Code {0} created and copied. Whoever joins with it becomes your student.', i.code)) })
    .catch(e => toast(e.message))

  // The owner's: every profile's workouts in one file. One request per profile, so a big server
  // takes a moment; the toast says it started.
  const exportEveryone = format => {
    toast(t('Preparing the file…'))
    api('/api/admin/users')
      .then(async r => {
        const docs = []
        for (const row of r.users) docs.push(await api('/api/admin/user?id=' + encodeURIComponent(row.id)).then(d => ({ user: d.user, unit: d.unit, workouts: d.workouts })))
        await saveText(everyoneExport(docs, format))
        toast(t('File saved'))
      }).catch(e => toast(e.message))
  }
  const exportMenu = () => menuSheet({
    title: t('Download everyone’s workouts'),
    items: [
      { icon: 'download', label: t('Spreadsheet (CSV)'), sub: t('One row per set, with the person’s name'), onClick: () => exportEveryone('csv') },
      { icon: 'download', label: 'JSON', sub: t('Everything as stored'), onClick: () => exportEveryone('json') }
    ]
  })

  const pill = u => {
    if (u.disabled) return <span className="adm-pill bad">{t('disabled')}</span>
    if (u.live) return <span className="adm-pill acc">{t('training now')}</span>
    const d = quietDays(u)
    if (d == null) return <span className="adm-pill">{t('never synced')}</span>
    return d >= 7 ? <span className="adm-pill">{t('{0} days away', d)}</span> : null
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>{t('Students')}</h1>
        <div className="sub">{users ? t('{0} students', sum.students) : err ? t('Could not load') : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={load} aria-label={t('Refresh')}>↻</button>
    </div>
    <div className="adm-intro">{t('Everyone you train in one place. Open a student to see their plans, how they are doing and their workouts, and to build a plan for them.')}</div>

    {err && <div className="card" role="alert" style={{ borderColor: 'var(--red)' }}>
      <div className="row between"><h2 style={{ margin: 0 }}>{t('Could not load the students')}</h2><Button size="sm" icon="reset" onClick={load}>{t('Try again')}</Button></div>
      <div className="adm-lead" style={{ marginBottom: 0 }}>{err}</div>
    </div>}

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Students')}</div><div className="v">{users ? sum.students : '–'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: sum.live ? 'var(--acc)' : undefined }}>{users ? sum.live : '–'}</div></div>
      <div className="tile"><div className="l">{t('Inactive 7+ days')}</div><div className="v">{users ? sum.quiet : '–'}</div></div>
      <div className="tile"><div className="l">{t('No plan yet')}</div><div className="v">{users ? sum.noplan : '–'}</div></div>
    </div>

    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>{t('Your students')}</h2>
        <Button variant="primary" size="sm" icon="plus" onClick={invite}>{t('Invite a student')}</Button></div>
      <div className="adm-lead">{t('An invite code is single use. Whoever joins with it becomes your student automatically.')}</div>
      <div className="search-row" style={{ marginBottom: 8 }}><div className={'search' + (query ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input className="input" type="search" placeholder={t('Search by name or e-mail…')} aria-label={t('Search by name or e-mail…')} value={query} onChange={e => setQuery(e.target.value)} />
        {query && <button className="clear" onClick={() => setQuery('')} aria-label={t('Clear')}><Icon name="xmark" /></button>}</div></div>
      <div className="chips" style={{ marginBottom: 6 }}>
        {filters.map(([id, l]) => <button key={id} className={'chip' + (filter === id ? ' on' : '')} onClick={() => setFilter(id)}>{l} · {counts[id]}</button>)}
      </div>
      <div className="chips" style={{ marginBottom: 10 }} role="group" aria-label={t('Sort by')}>
        {[['recent', t('Recent')], ['name', t('A–Z')], ['quiet', t('Inactive first')]].map(([id, l]) => <button key={id} className={'chip' + (sort === id ? ' on' : '')} onClick={() => setSort(id)}>{l}</button>)}
      </div>
      <div className="list">
        {shown.map(u => <div key={u.id} className="item" onClick={() => nav('/students/' + encodeURIComponent(u.id))} style={u.disabled ? { opacity: .55 } : null}>
          <div className="grow">
            <div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginInlineEnd: 5 }} />}{u.name} {u.admin && <span className="adm-pill acc" style={{ marginInlineStart: 4 }}>{u.owner ? t('owner') : t('teacher')}</span>} {pill(u)}
              {!u.admin && u.routines === 0 && !u.pending && !u.disabled && <span className="adm-pill" style={{ marginInlineStart: 4 }}>{t('No plan yet')}</span>}
              {u.pending > 0 && <span className="adm-pill acc" style={{ marginInlineStart: 4 }}>{t('plan on its way')}</span>}</div>
            <div className="ss">{u.live ? t('training now') + ' · ' + u.live.name : t('{0} workouts', u.workouts) + (u.lastWorkout ? ' · ' + t('last {0}', fmtDate(u.lastWorkout)) : '') + ' · ' + t('{0} plans', u.routines || 0)}</div>
            {owner && u.teacherName && <div className="ss">{t('Teacher: {0}', u.teacherName)}</div>}
          </div>
          {!u.disabled && !u.admin && <button className="iconbtn adm-iconbtn" onClick={e => { e.stopPropagation(); openSheet(done => <StudentPlanSheet student={u} onSent={load} close={done} />, { locked: true }) }}
            aria-label={t('New plan for {0}', u.name)} title={t('New plan for {0}', u.name)}><Icon name="clipboard" /></button>}
          <Icon name="chevronRight" className="chev" />
        </div>)}
        {users && !listed.length && <div className="adm-empty">{t('No students yet. “Invite a student” makes a code to give them.')}</div>}
        {users && listed.length > 0 && !shown.length && <div className="adm-empty">{t('No one matches. Try another name or filter.')}</div>}
      </div>
    </div>

    {owner && <div className="card">
      <h2 style={{ margin: 0 }}>{t('Download everyone’s workouts')}</h2>
      <div className="adm-lead">{t('As the owner you can download the workouts of any profile on this server, in one file.')}</div>
      <Button icon="download" onClick={exportMenu}>{t('Download')}</Button>
    </div>}
  </div>
}
