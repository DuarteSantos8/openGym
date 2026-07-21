import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ } from '../lib/format.js'
import { webauthnOK, passkeyLogin, passkeyRegister, IS_ANDROID } from '../lib/api.js'
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { t, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { loadStarterPlan, confirmSheet } from '../sheets.jsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update, replaceState, setUser, pullState, pushState, signOut } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)

  const doExport = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'opengym-backup-' + todayISO() + '.json'; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported ✓'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not an openGym backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), data), true); toast(t('Backup imported ✓')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0} 💪', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)

  return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/home')}>‹</button><div style={{ flex: 1, marginLeft: 12 }}><h1>{t('Settings')}</h1></div></div>

    <div className="card">
      <h2>{t('Account')}</h2>
      {user ? <>
        <div className="row between">
        <div><b>{user.name}</b><div className="small muted">{t('Signed in with passkey — data syncs to this profile.')}</div></div>
        <button className="btn sm danger" onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })}>{t('Sign out')}</button>
        </div>
        {user.admin && <><div style={{ height: 10 }} /><button className="btn sm" onClick={() => nav('/admin')}>🛠️ {t('Admin dashboard')}</button></>}
      </> : <>
        <div className="small muted" style={{ marginBottom: 10 }}>{t('Guest mode — data lives only in this browser. Create a passkey profile to keep it safe and separate per person.')}</div>
        {webauthnOK() ? <>
          <button className="btn primary" onClick={registerHere}>✨ {t('Create passkey profile')}</button>
          <div style={{ height: 8 }} /><button className="btn" onClick={signInHere}>👤 {t('Sign in with passkey')}</button>
        </> : <div className="small dim">{t('Passkeys not supported in this browser.')}</div>}
      </>}
    </div>

    <div className="card">
      <h2>{t('Appearance')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('synced with your profile')}</span></h2>
      <div className="row between" style={{ padding: '8px 0' }}>
        <span>{t('Language')}</span>
        <select className="input" style={{ width: 150 }} value={S.lang || 'en'} onChange={e => update(s => { s.lang = e.target.value })}>
          {Object.entries(LANGS).map(([k, name]) => <option key={k} value={k}>{name}</option>)}
        </select>
      </div>
      {!INSTR_LANGS.includes(S.lang || 'en') && <div className="small dim" style={{ marginBottom: 6 }}>{t("Exercise instructions aren't available in this language yet — they stay in English.")}</div>}
      <div className="row between" style={{ padding: '8px 0' }}>
        <span>{t('Theme')}</span>
        <div className="chips">
          <button className={'chip' + (S.theme !== 'light' ? ' on' : '')} onClick={() => update(s => { s.theme = 'dark' })}>🌙 {t('Dark')}</button>
          <button className={'chip' + (S.theme === 'light' ? ' on' : '')} onClick={() => update(s => { s.theme = 'light' })}>☀️ {t('Light')}</button>
        </div>
      </div>
      <div style={{ padding: '8px 0' }}>
        <div style={{ marginBottom: 10 }}>{t('Accent color')}</div>
        <div className="swatches">{Object.entries(ACCENTS).map(([k, c]) => <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')} style={{ background: c }} onClick={() => update(s => { s.accent = k })} />)}</div>
      </div>
    </div>

    <div className="card">
      <h2>{t('Units & timer')}</h2>
      <div className="row between" style={{ padding: '8px 0' }}><span>{t('Weight unit')}</span>
        <div className="chips"><button className={'chip' + (S.unit === 'kg' ? ' on' : '')} onClick={() => update(s => { s.unit = 'kg' })}>kg</button>
          <button className={'chip' + (S.unit === 'lb' ? ' on' : '')} onClick={() => update(s => { s.unit = 'lb' })}>lb</button></div></div>
      <div className="row between" style={{ padding: '8px 0' }}><span>{t('Rest timer')}</span>
        <select className="input" style={{ width: 120 }} value={S.restSec} onChange={e => update(s => { s.restSec = +e.target.value })}>
          {[60, 90, 120, 150, 180].map(v => <option key={v} value={v}>{v}s</option>)}</select></div>
      <div className="row between" style={{ padding: '8px 0' }}><span>{t('Sounds')}</span>
        <button className={'chip' + (S.sound ? ' on' : '')} onClick={() => update(s => { s.sound = !s.sound })}>{S.sound ? t('On 🔔') : t('Off 🔕')}</button></div>
      <div className="small dim" style={{ marginTop: 6 }}>{t('Note: switching units only changes the label — logged numbers are not converted.')}</div>
    </div>

    {user && <NotificationsCard S={S} update={update} toast={toast} />}

    <div className="card">
      <h2>{t('Data')}</h2>
      <button className="btn" onClick={doExport}>⬇️ {t('Export backup (JSON)')}</button>
      <div style={{ height: 8 }} /><button className="btn" onClick={() => fileRef.current.click()}>⬆️ {t('Import backup')}</button>
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
      <div style={{ height: 8 }} /><button className="btn" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</button>
      <div style={{ height: 8 }} /><button className="btn danger" onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })}>{t('Reset everything')}</button>
    </div>

    <div className="card"><h2>{t('Tip')}</h2>
      <div className="small muted" style={{ lineHeight: 1.5 }}>📱 {IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')} {t('to install openGym as a full-screen app.')} {user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!')}</div></div>
    <div className="dim small" style={{ textAlign: 'center', marginTop: 8, lineHeight: 1.6 }}>
      openGym · {t('free & open source (AGPL v3)')}<br />
      <a href="https://github.com/DuarteSantos8/openGym" target="_blank" rel="noopener">source code</a> · exercise data: hasaneyldrm/exercises-dataset (CC)
    </div>
  </div>
}

function NotificationsCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async () => {
    setBusy(true)
    try {
      if (on) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on 🔔')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  return <div className="card">
    <h2>{t('Notifications')}</h2>
    {!supported ? <div className="small dim">{t('Not supported in this browser.')}</div> : <>
      <div className="row between" style={{ padding: '8px 0' }}>
        <div><span>{t('Push notifications')}</span><div className="small muted">{t('Rest-timer alerts, even if openGym is closed.')}</div></div>
        <button className={'chip' + (on ? ' on' : '')} disabled={busy} onClick={toggle}>{on ? t('On 🔔') : t('Off 🔕')}</button>
      </div>
      {on && <>
        <div className="row between" style={{ padding: '8px 0' }}>
          <span>{t('Workout day reminder')}</span>
          <button className={'chip' + (S.reminder?.on ? ' on' : '')} onClick={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })}>{S.reminder?.on ? t('On') : t('Off')}</button>
        </div>
        {S.reminder?.on && <div className="row between" style={{ padding: '8px 0' }}>
          <span>{t('Reminder time')}</span>
          <input type="time" className="input" style={{ width: 120 }} value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </div>}
        <div className="small dim" style={{ margin: '6px 0' }}>
          {t("Only sent on days you have a routine planned and haven't logged a workout yet.")}
          {S.reminder?.on && S.reminder?.tz && <> {t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz)}</>}
        </div>
        <button className="btn sm" onClick={test}>{t('Send test notification')}</button>
      </>}
    </>}
  </div>
}

function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    try {
      const u = await passkeyRegister(n); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it ✓')) }
      else { await pullState(); toast(t('Welcome, {0} 💪', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile ✨')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <input ref={nameRef} className="input" placeholder={t('Your name')} maxLength={40} />
    <div style={{ height: 12 }} /><button className="btn primary" onClick={go}>{t('Create passkey')}</button>
  </>
}
