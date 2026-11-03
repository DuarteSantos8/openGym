import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { buildPlanBundle } from '../lib/plan-share.js'
import { studentProgress, studentPerformance } from '../lib/student-progress.js'
import { filterStudents, filterCounts, quietDays } from '../lib/student-filter.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, exerciseNameText } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { auditCat, auditLine, fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import StudentPlanSheet from '../components/StudentPlanSheet.jsx'
import { Button } from '../components/ui.jsx'
import AdminCoach from './AdminCoach.jsx'
import '../admin.css'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Mostly English-only — it isn't part of the translated end-user surface. The teacher side (finding
// a student, picking a teacher, sending a plan, following progress) is the exception: a teacher
// and their students may not read English, so those strings go through t() and the packs.
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

// The owner picks which admin (teacher) a student belongs to; that teacher then sees them, and only
// them. The owner can also pick one for themself (`self`): a teacher then follows their training.
function TeacherSheet({ student, self, onChanged, close }) {
  const toast = useUI(s => s.toast)
  const [admins, setAdmins] = useState(null)
  useEffect(() => { api('/api/admin/users').then(r => setAdmins(r.users.filter(x => x.admin && !x.disabled && x.id !== student.id))).catch(e => toast(e.message)) }, [])
  const set = (a, msg) => api('/api/admin/user/teacher', { method: 'POST', body: JSON.stringify({ id: student.id, teacher: a ? a.id : null }) })
    .then(() => { toast(msg); onChanged(); close() }).catch(e => toast(e.message))
  return <>
    <h3>{self ? t('My teacher') : t('Teacher for {0}', student.name)}</h3>
    <div className="adm-lead">{self
      ? t('Only this teacher can see your training and send you a plan.')
      : t('Only this teacher (and you) can see {0}’s training and send them a plan.', student.name)}</div>
    {!admins ? <div className="muted small">{t('Loading…')}</div> : admins.map(a => <button key={a.id} className={'btn' + (student.teacher === a.id ? ' primary' : '')} style={{ marginBottom: 8 }}
      onClick={() => set(a, self ? t('You are now a student of {0}', a.name) : t('{0} now belongs to {1}', student.name, a.name))}>{a.name}{a.owner ? ' ' + t('(you)') : ''}</button>)}
    {admins && !admins.length && <div className="adm-empty">{t('There is no other teacher yet. Make someone an admin first.')}</div>}
    {self && student.teacher && <button className="btn" style={{ marginBottom: 8 }} onClick={() => set(null, t('You no longer have a teacher'))}>{t('No teacher')}</button>}
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

function UserDetail({ id, viewerOwner, onChanged, close }) {
  const me = useStore(s => s.user)
  const [d, setD] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [picked, setPicked] = useState(null)     // ids chosen for archive / delete; null = not selecting
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="muted small">Loading…</div>
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
  // The teacher's own routines and weekly schedule, as the plan file carries them, into the
  // student's inbox: they accept it on their phone (sheets.jsx checkPlanInbox).
  const sendPlan = () => {
    const bundle = buildPlanBundle(useStore.getState().S, t('Plan from {0}', me?.name || t('your teacher')))
    if (!bundle.routines.some(r => r.ex.length)) return toast(t('Build the plan in your own Plan tab first, then send it from here.'))
    confirmSheet({
      title: t('Send your plan to {0}?', u.name),
      message: t('{0} routine(s) and your weekly schedule. They choose whether to add it. Nothing of theirs is changed until they do.', bundle.routines.length),
      confirmText: t('Send plan'),
      onConfirm: () => api('/api/admin/user/plan', { method: 'POST', body: JSON.stringify({ id: u.id, bundle }) })
        .then(r => toast(t('Sent. {0} waiting for {1}.', r.pending, u.name))).catch(e => toast(e.message))
    })
  }
  // Workouts: archive keeps them (out of the numbers, one tap to bring back); delete removes them
  // from the student's own record too. The owner may delete anyone's, a teacher a student's.
  const canDeleteWorkouts = viewerOwner || !u.admin
  const act = (path, body, done) => api(path, { method: 'POST', body: JSON.stringify({ id: u.id, ...body }) })
    .then(r => { done(r); setPicked(null); load(); onChanged() }).catch(e => toast(e.message))
  const archive = (ids, archived) => act('/api/admin/user/workouts/archive', { workouts: ids, archived },
    r => toast(archived ? t('{0} archived', r.changed) : t('{0} restored', r.changed)))
  const removeWorkouts = ids => confirmSheet({
    title: t('Delete {0} workout(s)?', ids.length),
    message: t('They are removed from {0}’s own record too, on their phone as well, and this cannot be undone. Archive them instead to keep them.', u.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => act('/api/admin/user/workouts/delete', { workouts: ids }, r => toast(t('{0} deleted', r.removed)))
  })
  const rowMenu = w => menuSheet({
    title: w.name,
    items: [
      { icon: w.archived ? 'reset' : 'folder', label: w.archived ? t('Restore') : t('Archive'), sub: w.archived ? t('Counts in the numbers again') : t('Keeps it, leaves it out of the numbers'), onClick: () => archive([String(w.id)], !w.archived) },
      canDeleteWorkouts && { icon: 'trash', label: t('Delete'), danger: true, onClick: () => removeWorkouts([String(w.id)]) }
    ]
  })
  // The same two actions for a plan (a ficha): archive marks it for the teacher, delete removes it
  // from the student's own plan, and the weekdays that held it, on their phone too.
  const archiveRoutine = (r, archived) => act('/api/admin/user/routines/archive', { routines: [String(r.id)], archived },
    x => toast(archived ? t('{0} archived', x.changed) : t('{0} restored', x.changed)))
  const removeRoutine = r => confirmSheet({
    title: t('Delete “{0}”?', r.name),
    message: t('The plan is removed from {0}’s own plan too, on their phone as well, and this cannot be undone. Archive it instead to keep it.', u.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => act('/api/admin/user/routines/delete', { routines: [String(r.id)] }, x => toast(t('{0} deleted', x.removed)))
  })
  const routineMenu = r => menuSheet({
    title: r.name,
    items: [
      { icon: r.archived ? 'reset' : 'folder', label: r.archived ? t('Restore') : t('Archive'), sub: r.archived ? t('Not archived any more') : t('Marks it as archived for you; the student keeps it'), onClick: () => archiveRoutine(r, !r.archived) },
      canDeleteWorkouts && { icon: 'trash', label: t('Delete'), danger: true, onClick: () => removeRoutine(r) }
    ]
  })
  const prog = studentProgress(d)
  const perf = studentPerformance(d)
  const delta = (x, unit) => x?.delta == null ? '' : ' (' + (x.delta > 0 ? '+' : '') + x.delta + unit + ')'
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
      <div className="tile"><div className="l">Workouts</div><div className="v v-sm">{workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v v-sm">{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Measurements</div><div className="v v-sm">{(d.measurements || []).length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v v-sm">{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: 'var(--fs-subhead)' }}>{rel(d.lastSync)}</div></div>
    </div>
    <h4 className="sec">{t('Progress')}</h4>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Weight')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.weight ? prog.weight.last + ' ' + d.unit + delta(prog.weight, '') : '–'}</div></div>
      <div className="tile"><div className="l">{t('Body fat')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.bodyFat ? prog.bodyFat.last + '%' + delta(prog.bodyFat, ' pts') : '–'}</div></div>
      <div className="tile"><div className="l">{t('Workouts, 30 days')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.last30.count} <span className="dim">{t('vs {0} before', prog.prev30.count)}</span></div></div>
      <div className="tile"><div className="l">{t('Volume, 30 days')}</div><div className="v" style={{ fontSize: '.95rem' }}>{fmtVol(prog.last30.volume, d.unit)}</div></div>
      <div className="tile"><div className="l">{t('PRs, 30 days')}</div><div className="v" style={{ fontSize: '.95rem' }}>{prog.last30.prs}</div></div>
    </div>
    <h4 className="sec">{t('Performance')}</h4>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Sessions a week')}</div><div className="v" style={{ fontSize: '.95rem' }}>{perf.perWeek}{perf.planned ? <span className="dim"> {t('of {0} planned', perf.planned)}</span> : null}</div></div>
      <div className="tile"><div className="l">{t('Adherence')}</div><div className="v" style={{ fontSize: '.95rem' }}>{perf.adherence == null ? '–' : perf.adherence + '%'}</div></div>
    </div>
    {perf.planned == null && <div className="adm-hint">{t('Adherence needs a plan with days set.')}</div>}
    <div className="adm-lead" style={{ margin: '10px 0 4px' }}>{t('Volume per week, last 8 weeks')}</div>
    <div role="img" aria-label={t('Volume per week, last 8 weeks')} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 54 }}>
      {perf.weeks.map((wk, i) => { const top = Math.max(1, ...perf.weeks.map(x => x.volume)); return <div key={i} title={fmtVol(wk.volume, d.unit) + ' · ' + wk.count} style={{ flex: 1, height: Math.max(3, Math.round(wk.volume / top * 54)), background: wk.count ? 'var(--acc)' : 'var(--sep)', borderRadius: 3, opacity: i === perf.weeks.length - 1 ? 1 : .7 }} /> })}
    </div>
    {perf.strength.length > 0 && <>
      <div className="adm-lead" style={{ margin: '12px 0 2px' }}>{t('Estimated 1RM, last 120 days')}</div>
      {perf.strength.map(x => <div key={x.id} className="row between" style={{ padding: '6px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <span className="small">{exerciseNameText(exOr(x.id))}</span>
        <span className="small muted">{x.first} → {x.last} {d.unit} <b style={{ color: x.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>{x.delta > 0 ? '+' : ''}{x.pct}%</b></span>
      </div>)}
    </>}
    <button className="btn primary" style={{ margin: '12px 0 4px' }} onClick={() => openSheet(done => <StudentPlanSheet student={u} close={done} />)}>{t('Create plan for {0}', u.name)}</button>
    <div className="adm-hint">{t('Build the routines right here. They go to {0}’s inbox and they add them with one tap.', u.name)}</div>
    <button className="btn" style={{ margin: '12px 0 4px' }} onClick={sendPlan}>{t('Send my plan')}</button>
    <div className="adm-hint">{t('Sends your routines and weekly schedule to {0}. They add it with one tap.', u.name)}</div>
    {viewerOwner && (!u.admin || u.owner) && <>
      <button className="btn" style={{ margin: '12px 0 4px' }} onClick={() => openSheet(done => <TeacherSheet student={u} self={u.owner} onChanged={onChanged} close={done} />)}>{t('Teacher: {0}', u.teacherName || t('none'))}</button>
      <div className="adm-hint">{t('Teachers see only their own students. A student who joins with a teacher’s invite code is theirs automatically.')}</div>
    </>}
    {viewerOwner && !u.owner && !u.disabled && <>
      <button className="btn" style={{ margin: '12px 0 4px' }}
        onClick={() => u.admin
          ? confirmSheet({ title: 'Remove ' + u.name + ' as admin?', message: 'They keep their account and data, but lose this page.', confirmText: 'Remove admin', danger: true, onConfirm: () => setRole(false) })
          : confirmSheet({ title: 'Make ' + u.name + ' an admin?', message: 'They become a teacher: they see only the students you assign to them or who join with their invite codes. They also set up the Coach. Only you can add or remove admins.', confirmText: 'Make admin', onConfirm: () => setRole(true) })}>
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
          message: 'Everything goes: their workouts, weigh-ins, routines, passkeys and notifications. This cannot be undone, and the invite code they joined with stays used. Download their data first if they might want it.',
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
      <button className="btn" style={{ marginBottom: 4 }} onClick={exportUser}>Download their data</button>
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
    <h4 className="sec">{t('Plans')}</h4>
    {d.routines.length ? <div className="list" style={{ gap: 0 }}>
      {d.routines.map(r => <div key={r.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', opacity: r.archived ? .55 : 1 }}>
        <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{r.emoji ? r.emoji + ' ' : ''}{r.name}{r.archived && <span className="adm-pill" style={{ marginInlineStart: 6 }}>{t('archived')}</span>}</div>
          <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{t('{0} exercises', r.count)}</div></div>
        <button className="iconbtn adm-iconbtn" onClick={() => routineMenu(r)} aria-label={t('Plan options')}><Icon name="more" /></button>
      </div>)}
    </div> : <div className="adm-empty">{t('No plans yet.')}</div>}
    <div className="row between"><h4 className="sec" style={{ margin: 0 }}>Workout history</h4>
      {workouts.length > 0 && <button className="btn" style={{ padding: '4px 10px' }} onClick={() => setPicked(picked ? null : [])}>{picked ? t('Done') : t('Select')}</button>}</div>
    {perf.archived > 0 && <button className="chip" style={{ margin: '8px 0' }} aria-pressed={showArchived} onClick={() => setShowArchived(v => !v)}>{showArchived ? t('Hide archived') : t('Show archived ({0})', perf.archived)}</button>}
    {(() => {
      const rows = workouts.filter(w => showArchived || !w.archived)
      if (!rows.length) return <div className="adm-empty">{workouts.length ? t('Everything is archived.') : 'No workouts logged.'}</div>
      return <>
        {picked && <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setPicked(rows.map(w => String(w.id)))}>{t('Select all')}</button>
          <button className="btn" disabled={!picked.length} onClick={() => archive(picked, true)}>{t('Archive')} ({picked.length})</button>
          {canDeleteWorkouts && <button className="btn danger" disabled={!picked.length} onClick={() => removeWorkouts(picked)}>{t('Delete')} ({picked.length})</button>}
        </div>}
        <div className="list" style={{ gap: 0 }}>
          {rows.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', opacity: w.archived ? .55 : 1 }}
            onClick={picked ? () => setPicked(p => (p.includes(String(w.id)) ? p.filter(x => x !== String(w.id)) : [...p, String(w.id)])) : undefined}>
            {picked && <input type="checkbox" readOnly checked={picked.includes(String(w.id))} aria-label={w.name} style={{ marginInlineEnd: 10 }} />}
            <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{w.name}{w.archived && <span className="adm-pill" style={{ marginInlineStart: 6 }}>{t('archived')}</span>}</div>
              <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
            <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
            {!picked && <button className="iconbtn adm-iconbtn" onClick={() => rowMenu(w)} aria-label={t('Workout options')}><Icon name="more" /></button>}
          </div>)}
        </div>
      </>
    })()}
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

// A nudge on the row of someone a teacher has not heard from in a week (or ever).
const quietPill = u => {
  if (u.disabled || u.live || u.admin) return null
  const d = quietDays(u)
  if (d != null && d < 7) return null
  return <span className="adm-pill" style={{ marginInlineStart: 4 }}>{d == null ? t('never synced') : t('{0} days away', d)}</span>
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
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('recent')

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

  // From the list rather than the stored session, which may predate a handover.
  const viewerOwner = !!(users || []).find(u => u.id === user.id)?.owner
  const openUser = id => openSheet(close => <UserDetail id={id} viewerOwner={viewerOwner} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length
  const counts = filterCounts(users || [], user.id)
  const shown = filterStudents(users || [], { query, filter, sort, me: user.id })
  const meRow = (users || []).find(u => u.id === user.id)
  // Everyone but the owner is somebody's student, so "My students" only means something to a teacher
  // who has any; the owner always gets it, to see who they teach.
  const filters = [['all', t('All')], ['live', t('Training now')], ['quiet', t('Inactive 7+ days')], ['mine', t('My students')], ['disabled', t('Disabled')]]
    .filter(([id]) => id === 'all' || id === filter || counts[id] > 0)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/settings/account" onClick={() => nav('/settings/account')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>Admin</h1>
        <div className="sub">{users ? users.length + ' users · ' + activeCount + ' active this week' : usersErr ? 'Could not load' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); setTick(n => n + 1) }} aria-label="refresh">↻</button>
    </div>
    <div className="adm-intro">
      Everything about running this instance: who uses it, how they get in, the AI Coach, and what has happened on it. Nothing here shows anyone's training data beyond counts.
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
          <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{u.live.name} · exercise {u.live.exIdx} of {u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} sets</div></div>
        <span className="adm-pill acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    {/* The Coach setup. Renders nothing at all unless the instance offers the Coach, so an admin
        page on a box that never enabled it is byte-for-byte the page it was before. */}
    <div ref={coachRef} className="adm-coach-anchor"><AdminCoach /></div>

    <InvitesCard invites={invites} reload={loadInvites} inviteOnly={inviteOnly} />

    {viewerOwner && meRow && <div className="card">
      <h2 style={{ margin: 0 }}>{t('My teacher')}</h2>
      <div className="adm-lead">{t('You can be a student too. Pick a teacher and they will see your training and can send you a plan. Nobody else can.')}</div>
      <button className="btn" onClick={() => openSheet(done => <TeacherSheet student={meRow} self onChanged={loadUsers} close={done} />)}>{meRow.teacherName ? t('Teacher: {0}', meRow.teacherName) : t('Pick a teacher')}</button>
    </div>}

    <div className="card">
      <h2 style={{ margin: 0 }}>Users</h2>
      <div className="adm-lead">Everyone with a profile on this instance. Tap one to see their activity, to disable the account (nothing is deleted) or to delete it with all their data for good.</div>
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
        {shown.map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
          <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginInlineEnd: 5 }} />}{u.name} {u.admin && <span className="adm-pill acc" style={{ marginInlineStart: 4 }}>{u.owner ? 'owner' : 'admin'}</span>}{u.disabled && <span className="adm-pill bad" style={{ marginInlineStart: 4 }}>disabled</span>}{quietPill(u)}</div>
            <div className="ss">{u.live ? 'training now · ' + u.live.name : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout) : '') + ' · last sync ' + rel(u.lastSync)}</div>
            {viewerOwner && u.teacherName && u.teacher !== user.id && <div className="ss">{t('Teacher: {0}', u.teacherName)}</div>}
            {u.email && <div className="ss" title="sign-in e-mail">{u.email}</div>}</div>
          {!u.admin && !u.disabled && <button className="iconbtn adm-iconbtn" onClick={e => { e.stopPropagation(); openSheet(done => <StudentPlanSheet student={u} close={done} />) }} aria-label={t('Create plan for {0}', u.name)} title={t('Create plan for {0}', u.name)}><Icon name="clipboard" /></button>}
          {u.hasPush && <Icon name="bell" title="push notifications on" style={{ fontSize: 'var(--fs-subhead)', color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
        </div>)}
        {users && !users.length && <div className="adm-empty">No users yet.</div>}
        {users && users.length > 0 && !shown.length && <div className="adm-empty">{t('No one matches. Try another name or filter.')}</div>}
      </div>
    </div>

    {viewerOwner && <div style={{ marginTop: 14 }}><AuditCard tick={tick} owner={viewerOwner} /></div>}
  </div>
}
