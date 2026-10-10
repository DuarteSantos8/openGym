import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { auditCat, auditLine, fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { dateLocale, useLang } from '../lib/i18n.js'
import { adminT } from '../lib/admin-i18n.js'
import AdminCoach from './AdminCoach.jsx'
import '../admin.css'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
//
// One page of cards, each opening with a sentence that says what it is for. An operator who
// looks at this twice a year should not have to remember what "synced 3d ago" or an invite
// code means.

const rel = ts => {
  if (!ts) return adminT('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return adminT('just now')
  if (s < 3600) return adminT('{0} min ago', Math.floor(s / 60))
  if (s < 86400) return adminT('{0} h ago', Math.floor(s / 3600))
  return adminT('{0} d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? adminT('{0} min', m) : adminT('{0} h {1} min', Math.floor(m / 60), m % 60) }

// The one time the reset code is visible. Locked, so a tap beside the sheet cannot lose it
// before it has been copied or written down.
function ResetCodeSheet({ name, email, code, expires, close }) {
  useLang()
  const toast = useUI(s => s.toast)
  const copy = () => { navigator.clipboard?.writeText(code).catch(() => {}); toast(adminT('Copied')) }
  return <>
    <h3>{adminT('Reset code for {0}', name)}</h3>
    <div className="adm-lead">{adminT('Give them this code. They choose “Sign in with password” → “Have a reset code from your admin?”, enter their name')} <b>{name}</b>{email && <> ({adminT('or their')} {adminT('sign-in e-mail')} <b>{email}</b>)</>}, {adminT('the code and a new password. It works once, until {0}, and will not be shown again.', new Date(expires).toLocaleString(dateLocale()))}</div>
    <button className="adm-code" style={{ fontSize: 22, width: '100%', padding: '14px 0' }} onClick={copy} aria-label={adminT('copy code')}>{code}</button>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>{adminT('Done')}</Button>
  </>
}

function UserDetail({ id, onChanged, close }) {
  useLang()
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">{adminT('Loading…')}</div>
  const u = d.user
  // The document comes straight off the user's state file. PUT /api/data drops null and
  // shapeless entries now, but a file written before it did still answers with them, and this
  // sheet renders outside the route's ErrorBoundary: one throw here blanked the whole app and
  // left exactly this account un-disableable. setsDone/workoutVolume walk entries and sets, so
  // an entry that lacks either has nothing to show and is skipped rather than drawn.
  const workouts = (d.workouts || []).filter(w => w && Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets)))
  // Their whole record as the admin API already returns it — the export the delete sheet offers.
  const exportUser = () => {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `opengym-${u.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}-${u.id}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const doDelete = () => {
    api('/api/admin/user/delete', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(() => { toast(adminT('Account deleted')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(adminT(disabled ? 'User disabled' : 'User enabled')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  // Password sign-in (#118): the server only sends `password` when the instance offers it. The
  // code comes back once, is shown once, and is never stored anywhere but as a hash.
  const pwInstance = typeof u.password === 'boolean'
  const resetPassword = () => confirmSheet({
    title: adminT('Reset {0}’s password?', u.name),
    message: adminT('You get a one-time code to hand them. Their current password stops working now and they are signed out everywhere; their passkeys keep working. They set a new password with the code under “Sign in with password”. It is shown once and is valid for 24 hours.'),
    confirmText: adminT('Create reset code'),
    danger: true,
    onConfirm: () => api('/api/admin/user/password-reset', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(r => { onChanged(); close(); openSheet(done => <ResetCodeSheet name={r.name} email={u.email} code={r.code} expires={r.expires} close={done} />, { locked: true }) })
      .catch(e => toast(e.message)),
  })
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="adm-pill acc">{adminT('admin')}</span>}
      {u.disabled && <span className="adm-pill bad">{adminT('disabled')}</span>}
      {u.invitedBy && <span className="adm-pill">{adminT('invite')} {u.invitedBy}</span>}
      {u.password && <span className="adm-pill">{adminT('password')}</span>}
      {/* The sign-in e-mail (password instances only): shown to admins and nobody else. */}
      {u.email && <span className="adm-pill" title={adminT('sign-in e-mail')}>{u.email}</span>}
      {u.resetUntil && <span className="adm-pill acc">{adminT('reset code until')} {new Date(u.resetUntil).toLocaleString(dateLocale())}</span>}
      <span className="adm-pill">{adminT('joined')} {u.created ? fmtDate(u.created.slice(0, 10)) : '–'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{adminT('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{workouts.length}</div></div>
      <div className="tile"><div className="l">{adminT('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{adminT('Measurements')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{(d.measurements || []).length}</div></div>
      <div className="tile"><div className="l">{adminT('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{adminT('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <>
      <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
        onClick={() => u.disabled ? setDisabled(false)
          : confirmSheet({ title: adminT('Disable {0}?', u.name), message: adminT('They are signed out everywhere and can no longer sync or log in until re-enabled. Their data stays.'), confirmText: adminT('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
        {adminT(u.disabled ? 'Enable account' : 'Disable account')}</button>
      <div className="adm-hint">{adminT(u.disabled ? 'Enabling lets them sign in and sync again.' : 'Disabling signs them out everywhere and blocks sign-in. Nothing is deleted.')}</div>
      {/* The one destructive action in the app (issue #107), so it asks twice and offers the
          export first — that history is theirs. The second step names the account again, because
          the first sheet can be dismissed by anyone who was not reading. */}
      <button className="btn danger" style={{ margin: '14px 0 4px' }}
        onClick={() => confirmSheet({
          title: adminT('Delete {0}?', u.name),
          message: adminT('Everything goes: their workouts, weigh-ins, routines, passkeys and notifications. This cannot be undone, and the invite code they joined with stays used. Download their data first if they might want it.'),
          confirmText: adminT('Continue'),
          danger: true,
          onConfirm: () => confirmSheet({
            title: adminT('Delete {0} for good?', u.name),
            message: adminT('Last chance. There’s no undo and no backup of this on the server.'),
            confirmText: adminT('Delete account'),
            danger: true,
            onConfirm: doDelete,
          }),
        })}>{adminT('Delete account')}</button>
      <button className="btn" style={{ marginBottom: 4 }} onClick={exportUser}>{adminT('Download their data')}</button>
      <div className="adm-hint">{adminT('Deleting removes the account and every trace of its training history from this server.')}</div>
      {pwInstance && <>
        <button className="btn" style={{ margin: '14px 0 4px' }} onClick={resetPassword}>{adminT('Reset password')}</button>
        <div className="adm-hint">{u.password
          ? adminT('For a forgotten password: a one-time code lets them choose a new one. Their current password stops working at once.')
          : adminT('No password yet. A one-time code lets them set one. That’s the way back in after losing their only passkey.')}</div>
      </>}
    </>}
    <h4 className="sec">{adminT('Workout history')}</h4>
    {workouts.length ? <div className="list" style={{ gap: 0 }}>
      {workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {adminT('{0} sets', setsDone(w))}{w.prs?.length ? ' · ' + adminT('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="adm-empty">{adminT('No workouts logged.')}</div>}
  </>
}

function InvitesCard({ invites, reload, inviteOnly }) {
  useLang()
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(adminT('Code {0} created & copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => confirmSheet({
    title: adminT('Revoke code {0}?', code), message: adminT('Anyone who has it can no longer use it. People who already signed up with it are not affected.'),
    confirmText: adminT('Revoke'), danger: true,
    onConfirm: () => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => { toast(adminT('Code revoked')); reload() }).catch(e => toast(e.message))
  })
  const copy = code => { navigator.clipboard?.writeText(code).catch(() => {}); toast(adminT('Copied {0}', code)) }
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{adminT('Invite codes')}</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{adminT('New code')}</Button></div>
    <div className="adm-lead">
      {inviteOnly
        ? adminT('Sign-up is invite-only: someone needs one of these codes to create a profile. Each code works once.')
        : adminT('Sign-up is open, so codes are optional here. They only record who invited whom.')}
    </div>
    {open.length ? <>
      <div className="adm-group-t">{adminT('Unused · tap to copy')}</div>
      {open.map(i => <div key={i.code} className="row between" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <button className="adm-code" onClick={() => copy(i.code)} aria-label={adminT('copy {0}', i.code)}>{i.code}</button>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn adm-iconbtn" onClick={() => copy(i.code)} aria-label={adminT('copy')}><Icon name="copy" /></button>
          <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label={adminT('revoke')}><Icon name="trash" /></button>
        </div>
      </div>)}
    </> : null}
    {used.length ? <>
      <div className="adm-group-t" style={{ marginTop: open.length ? 12 : 0 }}>{adminT('Already used')}</div>
      {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '6px 0', fontSize: '.82rem' }}>
        <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', letterSpacing: '.06em' }}>{i.code}</span><span>→ {i.usedByName || adminT('used')}</span>
      </div>)}
    </> : null}
    {!open.length && !used.length && <div className="adm-empty">{adminT('No codes yet. "New code" makes one and copies it to your clipboard.')}</div>}
  </div>
}

// Who signed in, who tried and failed, what an admin changed. A card rather than its own route:
// the dashboard is deliberately one page of cards, and the 95 % use of this is a glance at the
// last twenty events. Paging follows Library.jsx's house style — "Show more", not page numbers.
function AuditCard({ tick }) {
  useLang()
  const toast = useUI(s => s.toast)
  const [meta, setMeta] = useState(null)      // last response minus the rows: total, retention, …
  const [rows, setRows] = useState([])
  const [cat, setCat] = useState('')

  const load = (c, before) => api('/api/admin/audit?limit=50&cat=' + c + (before ? '&before=' + before : ''))
    .then(r => { setMeta(r); setRows(x => (before ? x.concat(r.events) : r.events)) })
    .catch(e => toast(e.message))
  const pick = c => { setCat(c); setRows([]); setMeta(null); load(c) }
  // Reloads on mount and whenever the header's ↻ bumps the tick. Deliberately not on the 15s
  // poll that drives "training now": this is history, not presence.
  useEffect(() => { load(cat) }, [tick])

  const clear = () => confirmSheet({
    title: adminT('Clear the activity log?'),
    message: adminT('Every recorded event is deleted. The clear itself is logged, so the gap stays visible.'),
    confirmText: adminT('Clear'), danger: true,
    onConfirm: () => api('/api/admin/audit/clear', { method: 'POST', body: '{}' })
      .then(() => { toast(adminT('Activity log cleared')); pick(cat) }).catch(e => toast(e.message))
  })

  if (meta && !meta.enabled) return null      // AUDIT_LOG=0 — the card isn't there at all

  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{adminT('Activity log')}</h2>
      <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={clear} aria-label={adminT('clear log')}><Icon name="trash" /></button></div>
    <div className="adm-lead">
      {adminT('Who signed in, what failed, and what an admin changed.')}
      {meta ? ' ' + adminT('{0} events', fmtNum(meta.total))
        + (meta.retention.days ? ', ' + adminT('kept for {0} days', meta.retention.days) : '')
        + (meta.ip_mode === 'off' ? ', ' + adminT('without IP addresses') : '') + '.' : ''}
    </div>
    <div className="chips" style={{ marginBottom: 10 }}>
        {[['', 'All'], ['auth', 'Sign-ins'], ['admin', 'Admin'], ['fail', 'Failed']].map(([v, l]) =>
        <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{adminT(l)}</button>)}
    </div>
    {rows.map(e => {
      const line = auditLine(e)
      return <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="grow">
          <div className="small" style={{ fontWeight: 600 }}>{line.title}
            {/* a red pill, not a red row: twenty fumbled Face IDs in a row shouldn't read as an incident */}
            {!e.ok && <span className="adm-pill bad" style={{ marginInlineStart: 6 }}>{adminT('failed')}</span>}
            {auditCat(e.ev) === 'admin' && <span className="adm-pill acc" style={{ marginInlineStart: 6 }}>{adminT('admin')}</span>}</div>
          {line.sub && <div className="dim" style={{ fontSize: '.72rem' }}>{line.sub}</div>}
        </div>
        <span className="small muted" style={{ flex: 'none', marginInlineStart: 8 }}>{fmtWhen(e.ts, meta?.now)}</span>
      </div>
    })}
    {meta && !rows.length && <div className="adm-empty">{adminT('Nothing logged yet.')}</div>}
    {meta?.nextBefore && <div style={{ marginTop: 10 }}>
      <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>{adminT('Show more')}</Button></div>}
  </div>
}

export default function Admin() {
  useLang()
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [usersErr, setUsersErr] = useState(null)   // why the last load failed, until one succeeds
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it

  // A failed load, or an answer without a list, used to leave the page on "Loading…" for good —
  // with a toast every 15 seconds from the poll, or with nothing at all when the answer was
  // someone else's page. It says so where the list would be instead, and the poll (or ↻) keeps
  // trying; a list that did load stays up, marked as the last one that came through.
  const loadUsers = () => api('/api/admin/users')
    .then(d => {
      if (!Array.isArray(d?.users)) throw new Error('The server answered without a list of users.')
      setUsers(d.users); setInviteOnly(!!d.invite_only); setUsersErr(null)
    })
    .catch(e => setUsersErr(e.message || 'Failed to load'))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings/account')} aria-label={adminT('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 8 }}><h1 style={{ margin: 0 }}>{adminT('Admin')}</h1>
        <div className="sub">{users ? users.length + ' ' + adminT('users') + ' · ' + activeCount + ' ' + adminT('active this week') : usersErr ? adminT('Could not load') : adminT('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); setTick(n => n + 1) }} aria-label={adminT('refresh')}>↻</button>
    </div>
    <div className="adm-intro">
      {adminT('Everything about running this instance: who uses it, how they get in, the AI Coach, and what has happened on it. Nothing here shows anyone’s training data beyond counts.')}
    </div>

    {usersErr && <div className="card" role="alert" style={{ borderColor: 'var(--red)' }}>
      <div className="row between"><h2 style={{ margin: 0 }}>{users ? adminT('The last update failed') : adminT('Could not load the users')}</h2>
        <Button size="sm" icon="reset" onClick={loadUsers}>{adminT('Try again')}</Button></div>
      <div className="adm-lead" style={{ marginBottom: 0 }}>
        {usersErr} {users ? adminT('The list below is the last one that loaded.') : adminT('It tries again every 15 seconds.')}
      </div>
    </div>}

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{adminT('Users')}</div><div className="v">{users ? users.length : '–'}</div></div>
      <div className="tile"><div className="l">{adminT('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '–'}</div></div>
      <div className="tile"><div className="l">{adminT('Active 7 days')}</div><div className="v">{users ? activeCount : '–'}</div></div>
      <div className="tile"><div className="l">{adminT('Disabled')}</div><div className="v">{users ? disabledCount : '–'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 2px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{adminT('Training now')}</h2>
      <div className="adm-lead">{adminT('Sessions running at this moment. Tap a name for details.')}</div>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · {adminT('exercise {0} of {1}', u.live.exIdx, u.live.exTotal)} · {adminT('{0}/{1} sets', u.live.setsDone, u.live.setsTotal)}</div></div>
        <span className="adm-pill acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    {/* The Coach setup. Renders nothing at all unless the instance offers the Coach, so an admin
        page on a box that never enabled it is byte-for-byte the page it was before. */}
    <AdminCoach />

    <InvitesCard invites={invites} reload={loadInvites} inviteOnly={inviteOnly} />

    <div className="card">
      <h2 style={{ margin: 0 }}>{adminT('Users')}</h2>
      <div className="adm-lead">{adminT('Everyone with a profile on this instance.')}</div>
      <div className="list">
        {(users || []).map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
          <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginInlineEnd: 5 }} />}{u.name} {u.admin && <span className="adm-pill acc" style={{ marginInlineStart: 4 }}>{adminT('admin')}</span>}{u.disabled && <span className="adm-pill bad" style={{ marginInlineStart: 4 }}>{adminT('disabled')}</span>}</div>
            <div className="ss">{u.live ? adminT('training now') + ' · ' + u.live.name : adminT('{0} workouts', u.workouts) + (u.lastWorkout ? ' · ' + adminT('last') + ' ' + fmtDate(u.lastWorkout) : '') + ' · ' + adminT('last sync') + ' ' + rel(u.lastSync)}</div>
            {u.email && <div className="ss" title={adminT('sign-in e-mail')}>{u.email}</div>}</div>
          {u.hasPush && <Icon name="bell" title={adminT('push notifications on')} style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
        </div>)}
        {users && !users.length && <div className="adm-empty">{adminT('No users yet.')}</div>}
      </div>
    </div>

    <div style={{ marginTop: 14 }}><AuditCard tick={tick} /></div>
  </div>
}
