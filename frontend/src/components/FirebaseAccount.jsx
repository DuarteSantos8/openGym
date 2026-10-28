import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { bio } from '../lib/api.js'
import { Button } from './ui.jsx'

// Firebase mode (Phase 2): passkey sign-in + Firestore sync controls. The sync engine and
// the Firebase SDK live in lib/firestore-sync.js and are imported lazily, these components
// render nothing until it loads, and they only mount when lib/firebase-config says Firebase
// mode is on, so a local/demo build is untouched by them.

function useFb() {
  const [mod, setMod] = useState(null)
  const [auth, setAuth] = useState({ user: null, ready: false })
  useEffect(() => {
    let off = null
    import('../lib/firestore-sync.js').then(m => { setMod(m); off = m.onFbAuthChange(setAuth) }).catch(() => {})
    return () => { if (off) off() }
  }, [])
  return { mod, auth }
}

/** The sign-in / create-account form. `onSignedIn` fires after a successful ceremony,
 *  the Login screen uses it to step into the app (the store stays in local/guest mode;
 *  Firebase Auth is what carries the session, and the sync engine keys off it). */
export function FirebaseSignIn({ onSignedIn } = {}) {
  const toast = useUI(s => s.toast)
  const { mod, auth } = useFb()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  if (!mod) return null
  const run = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(); if (okMsg) toast(okMsg); if (onSignedIn) onSignedIn() }
    catch (e) { if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast(e?.message || t('Something went wrong')) }
    finally { setBusy(false) }
  }
  if (auth.user) return (
    <div className="muted small">{t('Signed in as {0}.', auth.user.username || t('you'))}</div>
  )
  return <>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Sign in with {0}, no password. First time here, create the account with your first passkey.', bio())}
    </div>
    <input className="input" placeholder={t('Username')} maxLength={40} value={name}
      onChange={e => setName(e.target.value)} autoComplete="username" />
    <div style={{ height: 10 }} />
    <Button variant="primary" disabled={busy || !name.trim()} onClick={() => run(() => mod.fbLogin(name), t('Welcome back'))}>{t('Sign in with passkey')}</Button>
    <div style={{ height: 10 }} />
    <Button disabled={busy || !name.trim()} onClick={() => run(() => mod.fbRegister(name), t('Account created'))}>{t('Create account with passkey')}</Button>
  </>
}

/** Settings → Account block for Firebase mode: status, add-a-passkey, sign out. */
export default function FirebaseAccount() {
  const toast = useUI(s => s.toast)
  const { mod, auth } = useFb()
  const [busy, setBusy] = useState(false)
  if (!mod) return null
  const run = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(); if (okMsg) toast(okMsg) }
    catch (e) { if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast(e?.message || t('Something went wrong')) }
    finally { setBusy(false) }
  }
  return (
    <div className="card" style={{ padding: 16, marginBottom: 22 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('Cloud sync (passkey)')}</div>
      {auth.user ? <>
        <div className="muted small" style={{ marginBottom: 12 }}>
          {t('Signed in as {0}. Your plan, workouts and weigh-ins sync across your devices.', auth.user.username || t('you'))}
        </div>
        <Button disabled={busy} onClick={() => run(() => mod.fbAddPasskey(), t('Passkey added'))}>{t('Add a passkey on this device')}</Button>
        <div style={{ height: 10 }} />
        <Button variant="ghost" disabled={busy} onClick={() => run(() => mod.fbSignOut(), t('Signed out'))}>{t('Sign out')}</Button>
      </> : <FirebaseSignIn />}
    </div>
  )
}
