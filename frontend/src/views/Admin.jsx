import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { auditCat, auditLine, fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { pathBefore } from '../lib/nav.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import { Button } from '../components/ui.jsx'
import AdminCoach from './AdminCoach.jsx'
import AdminCommunity from './AdminCommunity.jsx'
import AdminOidc from '../components/AdminOidc.jsx'
import '../admin.css'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Deliberately English-only — it isn't part of the translated end-user surface, so it stays
// out of the per-language string packs.
//
// One page of cards, each opening with a sentence that says what it is for. An operator who
// looks at this twice a year should not have to remember what "synced 3d ago" or an invite
// code means.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  return Math.floor(s / 86400) + ' d ago'
}
const fmtBytes = b => (b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB')
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min' }

// The one time the reset code is visible. Locked, so a tap beside the sheet cannot lose it
// before it has been copied or written down.
function ResetCodeSheet({ name, email, code, expires, close }) {
  const toast = useUI(s => s.toast)
  const copy = () => { navigator.clipboard?.writeText(code).catch(() => {}); toast('Copied') }
  return <>
    <h3>Reset code for {name}</h3>
    <div className="adm-lead">Give them this code. They choose “Sign in with password” → “Have a reset code from your admin?”, enter their name <b>{name}</b>{email && <> (or their sign-in e-mail <b>{email}</b>)</>}, the code and a new password. It works once, until {new Date(expires).toLocaleString()}, and will not be shown again.</div>
    <button className="adm-code" style={{ fontSize: 'var(--fs-title2)', width: '100%', padding: '14px 0' }} onClick={copy} aria-label="copy code">{code}</button>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>Done</Button>
  </>
}

// The one time a recovery code (#584) is visible. Locked like the reset code's sheet.
function RecoveryCodeSheet({ name, code, expires, close }) {
  const toast = useUI(s => s.toast)
  const copy = () => { navigator.clipboard?.writeText(code).catch(() => {}); toast('Copied') }
  return <>
    <h3>Recovery code for {name}</h3>
    <div className="adm-lead">Give them this code. On the sign-in screen they tap “Lost access?” → “I have a code” (or “Use a code from your other device”) and enter it; the device they use gets a new passkey for <b>{name}</b> and is signed in. In the phone app they do this in a browser first, then pair the app again. It works once, until {new Date(expires).toLocaleString()}, and will not be shown again.</div>
    <button className="adm-code" style={{ fontSize: 'var(--fs-title2)', width: '100%', padding: '14px 0' }} onClick={copy} aria-label="copy code">{code}</button>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>Done</Button>
  </>
}

function UserDetail({ id, viewerOwner, onChanged, close }) {
  const me = useStore(s => s.user)
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  const u = d.user
  // The document comes straight off the user's state file. PUT /api/data drops null and
  // shapeless entries now, but a file written before it did still answers with them, and this
  // sheet renders outside the route's ErrorBoundary: one throw here blanked the whole app and
  // left exactly this account un-disableable. setsDone/workoutVolume walk entries and sets, so
  // an entry that lacks either has nothing to show and is skipped rather than drawn.
  const workouts = (d.workouts || []).filter(w => w && Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets)))
  // Without ADMIN_DATA_VIEW the server sends counts only (data_view false): no history to list or download.
  const view = d.data_view !== false
  const n = d.counts || { workouts: workouts.length, bodyweight: (d.bodyweight || []).length, measurements: (d.measurements || []).length, routines: (d.routines || []).length }
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
      .then(() => { toast('Account deleted'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? 'User disabled' : 'User enabled'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  // One owner, any number of admins: only the owner appoints, removes or hands the role on.
  const setRole = admin => api('/api/admin/user/role', { method: 'POST', body: JSON.stringify({ id: u.id, admin }) })
    .then(() => { toast(admin ? u.name + ' is an admin now' : u.name + ' is no longer an admin'); onChanged(); close() })
    .catch(e => toast(e.message))
  const makeOwner = () => confirmSheet({
    title: 'Make ' + u.name + ' the owner?',
    message: 'They get everything you can do here, including removing admins and clearing the activity log. You stay an admin, but only they can change that.',
    confirmText: 'Hand it over', danger: true,
    onConfirm: () => api('/api/admin/owner', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(() => { toast(u.name + ' owns this instance now'); onChanged(); close() })
      .catch(e => toast(e.message)),
  })
  // Password sign-in (#118): the server only sends `password` when the instance offers it. The
  // code comes back once, is shown once, and is never stored anywhere but as a hash.
  const pwInstance = typeof u.password === 'boolean'
  const resetPassword = () => confirmSheet({
    title: 'Reset ' + u.name + '’s password?',
    message: 'You get a one-time code to hand them. Their current password stops working now and they are signed out everywhere; their passkeys keep working. They set a new password with the code under “Sign in with password”. It is shown once and is valid for 24 hours.',
    confirmText: 'Create reset code',
    danger: true,
    onConfirm: () => api('/api/admin/user/password-reset', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(r => { onChanged(); close(); openSheet(done => <ResetCodeSheet name={r.name} email={u.email} code={r.code} expires={r.expires} close={done} />, { locked: true }) })
      .catch(e => toast(e.message)),
  })
  // A recovery code (#584): any admin for a profile that is not an admin, the owner for an admin;
  // the owner's own comes from the server command (recover.js). Not for oneself.
  const canRecover = !u.owner && !u.disabled && u.id !== me?.id && (!u.admin || viewerOwner)
  const makeRecovery = () => confirmSheet({
    title: 'Recovery code for ' + u.name + '?',
    message: 'For someone who lost every way in: their devices and passkey are gone, and they have no password. You get a one-time code to hand them; the device they enter it on gets a new passkey. They are signed out everywhere now. Their passkeys and password stay. It is shown once and is valid for 24 hours.',
    confirmText: 'Create recovery code',
    danger: true,
    onConfirm: () => api('/api/admin/user/recovery', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(r => { onChanged(); close(); openSheet(done => <RecoveryCodeSheet name={r.name} code={r.code} expires={r.expires} close={done} />, { locked: true }) })
      .catch(e => toast(e.message)),
  })
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.owner ? <span className="adm-pill acc">owner</span> : u.admin && <span className="adm-pill acc">admin</span>}
      {u.disabled && <span className="adm-pill bad">disabled</span>}
      {u.invitedBy && <span className="adm-pill">invite {u.invitedBy}</span>}
      {u.password && <span className="adm-pill">password</span>}
      {/* The sign-in e-mail (password instances only): shown to admins and nobody else. */}
      {u.email && <span className="adm-pill" title="sign-in e-mail">{u.email}</span>}
      {u.resetUntil && <span className="adm-pill acc">reset code until {new Date(u.resetUntil).toLocaleString()}</span>}
      {u.recoveryUntil && <span className="adm-pill acc">recovery code until {new Date(u.recoveryUntil).toLocaleString()}</span>}
      <span className="adm-pill">joined {u.created ? fmtDate(u.created.slice(0, 10)) : '–'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">Workouts</div><div className="v v-sm">{view ? workouts.length : n.workouts}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v v-sm">{n.bodyweight}</div></div>
      <div className="tile"><div className="l">Measurements</div><div className="v v-sm">{n.measurements}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v v-sm">{n.routines}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: 'var(--fs-subhead)' }}>{rel(d.lastSync)}</div></div>
      {typeof d.bytes === 'number' && <div className="tile"><div className="l">On disk</div><div className="v" style={{ fontSize: 'var(--fs-subhead)' }}>{fmtBytes(d.bytes)}</div></div>}
    </div>
    {d.roles && <TrainerRoles id={u.id} name={u.name} roles={d.roles} grants={d.grants} onChanged={onChanged} close={close} />}
    {viewerOwner && !u.owner && !u.disabled && <>
      <button className="btn" style={{ margin: '12px 0 4px' }}
        onClick={() => u.admin
          ? confirmSheet({ title: 'Remove ' + u.name + ' as admin?', message: 'They keep their account and data, but lose this page.', confirmText: 'Remove admin', danger: true, onConfirm: () => setRole(false) })
          : confirmSheet({ title: 'Make ' + u.name + ' an admin?', message: 'They can see everyone on this instance, disable accounts, hand out invites and set up the Coach. Only you can add or remove admins.', confirmText: 'Make admin', onConfirm: () => setRole(true) })}>
        {u.admin ? 'Remove admin' : 'Make admin'}</button>
      <div className="adm-hint">{u.admin ? 'Admins run the instance with you. Remove the role to delete or disable their account.' : 'Admins help run the instance. You stay the owner.'}</div>
      {u.admin && <>
        <button className="btn" style={{ margin: '14px 0 4px' }} onClick={makeOwner}>Make owner</button>
        <div className="adm-hint">There is one owner. Handing it over makes you a regular admin.</div>
      </>}
    </>}
    {!u.admin && <>
      <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
        onClick={() => u.disabled ? setDisabled(false)
          : confirmSheet({ title: 'Disable ' + u.name + '?', message: 'They are signed out everywhere and can no longer sync or log in until re-enabled. Their data stays.', confirmText: 'Disable', danger: true, onConfirm: () => setDisabled(true) })}>
        {u.disabled ? 'Enable account' : 'Disable account'}</button>
      <div className="adm-hint">{u.disabled ? 'Enabling lets them sign in and sync again.' : 'Disabling signs them out everywhere and blocks sign-in. Nothing is deleted.'}</div>
      {/* The one destructive action in the app (issue #107), so it asks twice and offers the
          export first — that history is theirs. The second step names the account again, because
          the first sheet can be dismissed by anyone who was not reading. */}
      <button className="btn danger" style={{ margin: '14px 0 4px' }}
        onClick={() => confirmSheet({
          title: 'Delete ' + u.name + '?',
          message: 'Everything goes: their workouts, weigh-ins, routines, passkeys, notifications and sharing. This cannot be undone, and the invite code they joined with stays used. ' + (view ? 'Download their data first if they might want it.' : 'If they might want their history, ask them to export a backup first.'),
          confirmText: 'Continue',
          danger: true,
          onConfirm: () => confirmSheet({
            title: 'Delete ' + u.name + ' for good?',
            message: 'Last chance. There’s no undo and no backup of this on the server.',
            confirmText: 'Delete account',
            danger: true,
            onConfirm: doDelete,
          }),
        })}>Delete account</button>
      {view && <button className="btn" style={{ marginBottom: 4 }} onClick={exportUser}>Download their data</button>}
      <div className="adm-hint">Deleting removes the account and every trace of its training history from this server.</div>
      {pwInstance && <>
        <button className="btn" style={{ margin: '14px 0 4px' }} onClick={resetPassword}>Reset password</button>
        <div className="adm-hint">{u.password
          ? 'For a forgotten password: a one-time code lets them choose a new one. Their current password stops working at once.'
          : 'No password yet. A one-time code lets them set one. That’s the way back in after losing their only passkey.'}</div>
      </>}
    </>}
    {canRecover && <>
      <button className="btn" style={{ margin: '14px 0 4px' }} onClick={makeRecovery}>Recovery code</button>
      <div className="adm-hint">Lost every device and passkey? A one-time code gives a new device a passkey for this profile. Works with or without password sign-in.</div>
    </>}
    {u.owner && u.id !== me?.id && <div className="adm-hint" style={{ marginTop: 14 }}>A locked-out owner gets a recovery code from the server itself: <code>docker compose exec api node recover.js "{u.name}"</code></div>}
    {!view && <div className="adm-hint" style={{ marginTop: 14 }}>Their training data is theirs: it is readable on disk, not in the app. For support, the numbers above are usually enough. People export their own backup in Settings, Data &amp; backup.</div>}
    {view && <h4 className="sec">Workout history</h4>}
    {!view ? null : workouts.length ? <div className="list" style={{ gap: 0 }}>
      {workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="adm-empty">No workouts logged.</div>}
  </>
}

// Trainers and gyms (TRAINERS=on): the roles a profile has, and the free-trainer switch.
function TrainerRoles({ id, name, roles, grants, onChanged, close }) {
  const toast = useUI(s => s.toast)
  const setFree = free => api('/api/admin/user/trainer', { method: 'POST', body: JSON.stringify({ id, free }) })
    .then(() => { toast(free ? name + ' can train people now' : name + ' is no longer a free trainer'); onChanged(); close() })
    .catch(e => toast(e.message))
  return <>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '12px 0 4px' }}>
      {roles.freeTrainer && <span className="adm-pill acc">free trainer</span>}
      {roles.staff.map(s => <span key={s.gymId + s.role} className="adm-pill">{s.role === 'lead' ? 'gym lead' : 'trainer'}</span>)}
      {roles.memberOf.length > 0 && <span className="adm-pill">member of {roles.memberOf.length} gym{roles.memberOf.length > 1 ? 's' : ''}</span>}
      <span className="adm-pill">shares with {grants || 0}</span>
    </div>
    <button className="btn" style={{ margin: '8px 0 4px' }} onClick={() => roles.freeTrainer
      ? confirmSheet({ title: 'Stop ' + name + ' training freely?', message: 'Their private members are paused at once. Gym trainer roles stay.', confirmText: 'Stop', danger: true, onConfirm: () => setFree(false) })
      : setFree(true)}>{roles.freeTrainer ? 'Remove free trainer' : 'Allow as free trainer'}</button>
    <div className="adm-hint">A free trainer works without a gym, like a personal trainer. People still decide what they share.</div>
  </>
}

// Gyms (TRAINERS=on): create them, give the lead and trainer roles. Names and counts only: an
// admin runs the place, the members decide who sees their training.
function GymsCard({ users, tick }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const load = () => api('/api/admin/gyms').then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [tick])
  const create = () => openSheet(close => <GymNewSheet close={close} done={load} />)
  const assign = (g, role) => openSheet(close => <>
    <h3>{role === 'lead' ? 'Add a gym lead' : 'Add a trainer'} to {g.name}</h3>
    <div className="adm-lead">{role === 'lead'
      ? 'A gym lead sees the trainers and the names of members who joined, and only what each member shares with the lead row.'
      : 'A trainer sees only the members who connected to them, and only what each one shares.'}</div>
    <div className="list">{users.filter(u => !u.disabled && !g.staff.some(s => s.userId === u.id && s.role === role)).map(u =>
      <div key={u.id} className="item" onClick={() => api('/api/admin/gyms/staff', { method: 'POST', body: JSON.stringify({ gymId: g.id, userId: u.id, role }) })
        .then(() => { toast(u.name + ' added'); close(); load() }).catch(e => toast(e.message))}>
        <div className="grow"><div className="tt">{u.name}</div></div><Icon name="plus" className="chev" /></div>)}</div>
  </>)
  const remove = (g, s) => confirmSheet({
    title: 'Take ' + s.name + '’s ' + (s.role === 'lead' ? 'gym lead' : 'trainer') + ' role?',
    message: 'Whatever members shared through this role stops at once. It comes back if you give the role back.',
    confirmText: 'Take it away', danger: true,
    onConfirm: () => api('/api/admin/gyms/staff', { method: 'POST', body: JSON.stringify({ gymId: g.id, userId: s.userId, role: s.role, on: false }) })
      .then(() => { toast('Role removed'); load() }).catch(e => toast(e.message)),
  })
  const toggle = g => confirmSheet({
    title: (g.disabled ? 'Switch ' : 'Pause ') + g.name + '?',
    message: g.disabled ? 'Its lead and trainers see what members share again.' : 'Its lead and trainers see nothing until you switch it back on. Nothing is deleted.',
    confirmText: g.disabled ? 'Switch on' : 'Pause', danger: !g.disabled,
    onConfirm: () => api('/api/admin/gyms/update', { method: 'POST', body: JSON.stringify({ id: g.id, disabled: !g.disabled }) })
      .then(load).catch(e => toast(e.message)),
  })
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Gyms</h2>
      <Button variant="primary" size="sm" onClick={create} icon="plus">New gym</Button></div>
    <div className="adm-lead">Studios on this server, with their leads and trainers. Members connect with a trainer’s code and choose what each side sees; you never see that here.</div>
    {d && !d.gyms.length && <div className="adm-empty">No gyms yet. A gym gives trainers a home and members a gym lead.</div>}
    {(d?.gyms || []).map(g => <div key={g.id} style={{ padding: '10px 0', borderBottom: 'var(--hair) solid var(--sep)', opacity: g.disabled ? 0.6 : 1 }}>
      <div className="row between"><div className="small" style={{ fontWeight: 600 }}>{g.name} {g.disabled && <span className="adm-pill bad">paused</span>}</div>
        <span className="small muted">{g.counts.members} members</span></div>
      {g.contact && <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{g.contact}</div>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
        {g.staff.map(s => <button key={s.userId + s.role} className="adm-pill" onClick={() => remove(g, s)} aria-label={'remove ' + s.name}>{s.name} · {s.role === 'lead' ? 'lead' : 'trainer'} ✕</button>)}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn xs" onClick={() => assign(g, 'lead')}>Add lead</button>
        <button className="btn xs" onClick={() => assign(g, 'trainer')}>Add trainer</button>
        <button className="btn xs" onClick={() => toggle(g)}>{g.disabled ? 'Switch on' : 'Pause'}</button>
      </div>
    </div>)}
    {d?.freeTrainers?.length > 0 && <div className="adm-hint" style={{ marginTop: 10 }}>Free trainers: {d.freeTrainers.map(f => f.name).join(', ')}</div>}
  </div>
}

function GymNewSheet({ close, done }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const save = () => api('/api/admin/gyms/new', { method: 'POST', body: JSON.stringify({ name, contact }) })
    .then(() => { toast(name.trim() + ' created'); close(); done() }).catch(e => toast(e.message))
  return <>
    <h3>New gym</h3>
    <div className="adm-lead">Members see the name and the contact on the screen where they agree to share, so put who is responsible for their data and how to reach them.</div>
    <input className="field" placeholder="Name, e.g. FitBox Bülach" value={name} maxLength={60} onChange={e => setName(e.target.value)} aria-label="gym name" />
    <div style={{ height: 8 }} />
    <input className="field" placeholder="Responsible, e.g. FitBox GmbH, privacy@fitbox.ch" value={contact} maxLength={200} onChange={e => setContact(e.target.value)} aria-label="data protection contact" />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={!name.trim()} onClick={save}>Create gym</Button>
  </>
}

function InvitesCard({ invites, reload, inviteOnly }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast('Code ' + invite.code + ' created & copied'); reload() })
    .catch(e => toast(e.message))
  const revoke = code => confirmSheet({
    title: 'Revoke code ' + code + '?', message: 'Anyone who has it can no longer use it. People who already signed up with it are not affected.',
    confirmText: 'Revoke', danger: true,
    onConfirm: () => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => { toast('Code revoked'); reload() }).catch(e => toast(e.message))
  })
  const copy = code => { navigator.clipboard?.writeText(code).catch(() => {}); toast('Copied ' + code) }
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Invite codes</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">New code</Button></div>
    <div className="adm-lead">
      {inviteOnly
        ? 'Sign-up is invite-only: someone needs one of these codes to create a profile. Each code works once.'
        : 'Sign-up is open, so codes are optional here. They only record who invited whom.'}
    </div>
    {open.length ? <>
      <div className="adm-group-t">Unused · tap to copy</div>
      {open.map(i => <div key={i.code} className="row between" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <button className="adm-code" onClick={() => copy(i.code)} aria-label={'copy ' + i.code}>{i.code}</button>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn adm-iconbtn" onClick={() => copy(i.code)} aria-label="copy"><Icon name="copy" /></button>
          <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
        </div>
      </div>)}
    </> : null}
    {used.length ? <>
      <div className="adm-group-t" style={{ marginTop: open.length ? 12 : 0 }}>Already used</div>
      {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '6px 0', fontSize: 'var(--fs-footnote)' }}>
        <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', letterSpacing: '.06em' }}>{i.code}</span><span>→ {i.usedByName || 'used'}</span>
      </div>)}
    </> : null}
    {!open.length && !used.length && <div className="adm-empty">No codes yet. "New code" makes one and copies it to your clipboard.</div>}
  </div>
}

// Who signed in, who tried and failed, what an admin changed. A card rather than its own route:
// the dashboard is deliberately one page of cards, and the 95 % use of this is a glance at the
// last twenty events. Paging follows Library.jsx's house style — "Show more", not page numbers.
function AuditCard({ tick, owner }) {
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
    title: 'Clear the activity log?',
    message: 'Every recorded event is deleted. The clear itself is logged, so the gap stays visible.',
    confirmText: 'Clear', danger: true,
    onConfirm: () => api('/api/admin/audit/clear', { method: 'POST', body: '{}' })
      .then(() => { toast('Activity log cleared'); pick(cat) }).catch(e => toast(e.message))
  })

  if (meta && !meta.enabled) return null      // AUDIT_LOG=0 — the card isn't there at all

  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Activity log</h2>
      {/* Clearing is the owner's alone: an admin could otherwise erase what they did. */}
      {owner && <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={clear} aria-label="clear log"><Icon name="trash" /></button>}</div>
    <div className="adm-lead">
      Who signed in, what failed, and what an admin changed.
      {meta ? ' ' + fmtNum(meta.total) + ' events'
        + (meta.retention.days ? ', kept for ' + meta.retention.days + ' days' : '')
        + (meta.ip_mode === 'off' ? ', without IP addresses' : '') + '.' : ''}
    </div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {[['', 'All'], ['auth', 'Sign-ins'], ['admin', 'Admin'], ['fail', 'Failed']].map(([v, l]) =>
        <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{l}</button>)}
    </div>
    {rows.map(e => {
      const line = auditLine(e)
      return <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="grow">
          <div className="small" style={{ fontWeight: 600 }}>{line.title}
            {/* a red pill, not a red row: twenty fumbled Face IDs in a row shouldn't read as an incident */}
            {!e.ok && <span className="adm-pill bad" style={{ marginInlineStart: 6 }}>failed</span>}
            {auditCat(e.ev) === 'admin' && <span className="adm-pill acc" style={{ marginInlineStart: 6 }}>admin</span>}</div>
          {line.sub && <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{line.sub}</div>}
        </div>
        <span className="small muted" style={{ flex: 'none', marginInlineStart: 8 }}>{fmtWhen(e.ts, meta?.now)}</span>
      </div>
    })}
    {meta && !rows.length && <div className="adm-empty">Nothing logged yet.</div>}
    {meta?.nextBefore && <div style={{ marginTop: 10 }}>
      <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>Show more</Button></div>}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  // Opened from Settings → AI Coach (the hosted app's way to the Coach, which is the server's):
  // straight to the Coach card rather than the top of the page.
  const toCoach = useLocation().state?.section === 'coach'
  const coachRef = useRef(null)
  useEffect(() => {
    if (!toCoach) return
    const tm = setTimeout(() => coachRef.current?.scrollIntoView({ block: 'start' }), 50)
    return () => clearTimeout(tm)
  }, [toCoach])
  const user = useStore(s => s.user)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [usersErr, setUsersErr] = useState(null)   // why the last load failed, until one succeeds
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [dataView, setDataView] = useState(false)
  const [trainersOn, setTrainersOn] = useState(false)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it

  // A failed load, or an answer without a list, used to leave the page on "Loading…" for good —
  // with a toast every 15 seconds from the poll, or with nothing at all when the answer was
  // someone else's page. It says so where the list would be instead, and the poll (or ↻) keeps
  // trying; a list that did load stays up, marked as the last one that came through.
  const loadUsers = () => api('/api/admin/users')
    .then(d => {
      if (!Array.isArray(d?.users)) throw new Error('The server answered without a list of users.')
      setUsers(d.users); setInviteOnly(!!d.invite_only); setDataView(!!d.data_view); setTrainersOn(!!d.trainers); setUsersErr(null)
    })
    .catch(e => setUsersErr(e.message || 'Failed to load'))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  // From the list rather than the stored session, which may predate a handover.
  const viewerOwner = !!(users || []).find(u => u.id === user.id)?.owner
  const openUser = id => openSheet(close => <UserDetail id={id} viewerOwner={viewerOwner} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  const hasBack = (window.history.state?.idx || 0) > 0
  return <div className="narrow">
    <ScreenHeader hard title="Admin" sub={users ? users.length + ' users · ' + activeCount + ' active this week' : usersErr ? 'Could not load' : 'Loading…'}
      /* Back the way it came, like a Settings page: pushing Settings › Account made that page's own back land here again. */
      left={<button className="iconbtn" data-back={(hasBack ? pathBefore() : null) || '/settings/account'}
        onClick={() => hasBack ? nav(-1) : nav('/settings/account', { replace: true })} aria-label="Back"><Icon name="chevronLeft" /></button>}
      right={<button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); setTick(n => n + 1) }} aria-label="refresh"><Icon name="reset" /></button>} />
    <div className="adm-intro">
      Everything about running this instance: who uses it, how they get in, the AI Coach, and what has happened on it. {dataView
        ? 'ADMIN_DATA_VIEW is on, so you can open people’s workouts and weigh-ins. Every look lands in the activity log and in their own sharing log, so be the admin you would want.'
        : 'You run this server. Training data belongs to the people who logged it, so here you see counts, not workouts. It is readable on disk, not in the app.'}
    </div>

    {usersErr && <div className="card" role="alert" style={{ borderColor: 'var(--red)' }}>
      <div className="row between"><h2 style={{ margin: 0 }}>{users ? 'The last update failed' : 'Could not load the users'}</h2>
        <Button size="sm" icon="reset" onClick={loadUsers}>Try again</Button></div>
      <div className="adm-lead" style={{ marginBottom: 0 }}>
        {usersErr} {users ? 'The list below is the last one that loaded.' : 'It tries again every 15 seconds.'}
      </div>
    </div>}

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">Users</div><div className="v">{users ? users.length : '–'}</div></div>
      <div className="tile"><div className="l">Training now</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '–'}</div></div>
      <div className="tile"><div className="l">Active 7 days</div><div className="v">{users ? activeCount : '–'}</div></div>
      <div className="tile"><div className="l">Disabled</div><div className="v">{users ? disabledCount : '–'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 2px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />Training now</h2>
      <div className="adm-lead">Sessions running at this moment. Tap a name for details.</div>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{u.live.name ? `${u.live.name} · exercise ${u.live.exIdx} of ${u.live.exTotal} · ${u.live.setsDone}/${u.live.setsTotal} sets` : 'a session is running'}</div></div>
        <span className="adm-pill acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    {/* The Coach setup. Renders nothing at all unless the instance offers the Coach, so an admin
        page on a box that never enabled it is byte-for-byte the page it was before. */}
    <div ref={coachRef} className="adm-coach-anchor"><AdminCoach /></div>

    <InvitesCard invites={invites} reload={loadInvites} inviteOnly={inviteOnly} />

    {/* Sign-in with an identity provider; nothing without OIDC_ISSUER. */}
    <AdminOidc />

    {/* The community library's moderation (AdminCommunity.jsx); nothing without LIBRARY=on. */}
    <AdminCommunity tick={tick} />

    {trainersOn && <GymsCard users={users || []} tick={tick} />}

    <div className="card">
      <h2 style={{ margin: 0 }}>Users</h2>
      <div className="adm-lead">Everyone with a profile on this instance. Tap one to see their activity, to disable the account (nothing is deleted) or to delete it with all their data for good.</div>
      <div className="list">
        {(users || []).map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
          <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginInlineEnd: 5 }} />}{u.name} {u.admin && <span className="adm-pill acc" style={{ marginInlineStart: 4 }}>{u.owner ? 'owner' : 'admin'}</span>}{u.disabled && <span className="adm-pill bad" style={{ marginInlineStart: 4 }}>disabled</span>}</div>
            <div className="ss">{u.live ? 'training now' + (u.live.name ? ' · ' + u.live.name : '') : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout) : '') + ' · last sync ' + rel(u.lastSync)}</div>
            {u.email && <div className="ss" title="sign-in e-mail">{u.email}</div>}</div>
          {u.hasPush && <Icon name="bell" title="push notifications on" style={{ fontSize: 'var(--fs-subhead)', color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
        </div>)}
        {users && !users.length && <div className="adm-empty">No users yet.</div>}
      </div>
    </div>

    <div style={{ marginTop: 14 }}><AuditCard tick={tick} owner={viewerOwner} /></div>
  </div>
}
