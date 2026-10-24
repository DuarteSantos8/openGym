// Settings → Account → "Delete my account" (App Store rule 5.1.1(v): an app you can sign up in
// lets you leave it from inside the app). The server removes the profile and everything in it
// (POST /api/account/delete, the same clean-up as the admin's delete); the store then leaves this
// device where a sign-out does (useStore deleteAccount). Two steps: the sheet offers the backup
// export first (the very one Data & backup has, handed in by Settings) and asks for the
// account's name typed back; then the owner's proof, the same step the other changes to a way in
// ask (ProveOwner): a passkey, or the current password where it counts. The proof carries the
// delete. The phone app holds no passkey for the server, so there a profile without a password is
// proved by the pairing (the server's rule), after the phone's own screen lock says it is its
// owner (DeviceConfirm). Shown only while signed in to or paired with a server: a phone in
// local-only mode has no account, and "Reset everything" is how it wipes its data.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { MOBILE } from '../lib/mobile.js'
import { deviceLock, confirmDeviceOwner } from '../lib/device-auth.js'
import { passwordError, ProveOwner } from './PasswordAuth.jsx'
import { Row, Button } from './ui.jsx'

const errStyle = { color: 'var(--red)', marginTop: 10 }

// The server's answer in the UI language, by its `code` (api/openapi.yaml, /api/account/delete).
// The proof's refusals (a wrong password, a passkey that did not verify, a pause) are worded the
// way the other proved changes word them; a passkey prompt that failed on this device says so.
export function deleteAccountError(e) {
  switch (e?.data?.code) {
    case 'confirm-name': return t('That is not your account name.')
    case 'last-admin': return t('You’re the only admin here, and other profiles still use this server. Make someone else an admin first.')
  }
  if (e?.data?.code || e?.status === 429) return passwordError(e)
  if (e?.status == null && e?.name && e.name !== 'TypeError' && e.name !== 'Error') return t('Your passkey could not be confirmed.')
  return t('Couldn’t delete the account. Nothing was removed.')
}

export function DeleteAccountSheet({ close, exportBackup, exportBackupZip, hasMedia, done }) {
  const user = useStore(s => s.user)
  const [typed, setTyped] = useState('')
  const [step, setStep] = useState('name')   // 'name' | 'confirm'
  const [proofs, setProofs] = useState(null)   // GET /api/account/passkeys: what can prove it is them
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  const name = user?.name || ''
  const match = !!name && typed.trim() === name
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  // Read as the sheet opens, so the proof step is ready by the time the name is typed.
  useEffect(() => { api('/api/account/passkeys').then(setProofs).catch(e => setErr(deleteAccountError(e))) }, [])
  const next = ev => {
    ev.preventDefault()
    if (!match) return
    setStep('confirm')
  }
  const remove = async proof => {
    await useStore.getState().deleteAccount(typed.trim(), proof)
    close()
    useUI.getState().toast(t('Your account is gone. Thanks for every rep.'))
    done?.()
  }
  // The phone app cannot hold a passkey for your server (its own origin is not the server's), so
  // there the password says it is you, or, with none, the pairing and the phone's own lock.
  const passkey = !MOBILE && (proofs?.passkeys?.length || 0) > 0
  const password = !!proofs?.password
  // The server already knows the delete would be refused (the only admin, with others on the
  // server): said up front, so nobody types their name and answers a passkey prompt for nothing.
  const blocked = proofs?.deleteBlocked === 'last-admin' ? deleteAccountError({ data: { code: 'last-admin' } }) : null
  return <>
    <h3>{t('Delete your account?')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Your profile, workouts, body weight, photos and videos are deleted from this server for good. There is no undo, and not even your admin can bring them back.')}
    </div>
    {step === 'name' ? <>
      <div className="small" style={{ marginBottom: 8 }}>{t('Want a copy first? Export a backup. You can import it into openGym anytime.')}</div>
      {hasMedia && exportBackupZip
        ? <Button icon="share" onClick={exportBackupZip}>{t('Export with photos & videos (.zip)')}</Button>
        : <Button icon="share" onClick={exportBackup}>{t('Export backup (JSON)')}</Button>}
      {blocked ? <div className="small" role="alert" style={errStyle}>{blocked}</div> : <form onSubmit={next} noValidate style={{ marginTop: 18 }}>
        <label className="small" htmlFor="delete-account-name" style={{ display: 'block', marginBottom: 6 }}>{t('Type {0} to confirm.', name)}</label>
        <input ref={ref} id="delete-account-name" className="input" placeholder={t('Account name')} autoComplete="off"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} value={typed} onChange={e => setTyped(e.target.value)} />
        <div style={{ height: 14 }} />
        <button type="submit" className="btn danger" disabled={!match}>{t('Continue')}</button>
      </form>}
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </> : <>
      <div className="dim small" style={{ marginBottom: 14 }}>{t('First confirm that it is you.')}</div>
      {!proofs ? (err ? <div className="small" role="alert" style={errStyle}>{err}</div> : <div className="dim small">{t('Loading…')}</div>)
        : MOBILE && !password ? <DeviceConfirm onConfirmed={() => remove({})} />
        : <ProveOwner passkey={passkey} password={password} explain={deleteAccountError} danger submitText={t('Delete forever')} onProof={remove} />}
      <div style={{ height: 8 }} />
      <Button type="button" variant="ghost" className="dim" onClick={() => setStep('name')}>{t('Back')}</Button>
    </>}
  </>
}

/* A paired phone, for a profile without a password: the phone's screen lock (Face ID, Touch ID,
   a fingerprint or the passcode) is asked, and only once it says yes does the delete go out.
   Backed out or failed, nothing is sent and the sheet stays. A phone with no screen lock at all
   has nothing to ask: the typed name is the only check, and the sheet says so. */
function DeviceConfirm({ onConfirmed }) {
  const [lock, setLock] = useState(null)   // 'set' | 'none' | 'unknown'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { deviceLock().then(setLock) }, [])
  const go = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await confirmDeviceOwner(t('Confirm it’s you to delete your openGym account'))
      if (r !== 'ok' && r !== 'none') { setErr(t('Not confirmed on this phone. Nothing was deleted.')); return }
      await onConfirmed()
    } catch (e) { setErr(deleteAccountError(e)) }
    finally { setBusy(false) }
  }
  return <>
    <div className="dim small" style={{ marginBottom: 14 }}>{lock === 'none'
      ? t('This phone has no screen lock, so the name you typed is the only check.')
      : t('Your phone checks that it’s you (face, fingerprint or passcode), then the account is deleted.')}</div>
    <button type="button" className="btn danger" disabled={busy || !lock} onClick={go}>{t('Delete forever')}</button>
    {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
  </>
}

// The row on the Account page. `done` runs once the account is gone (Settings goes home).
export function DeleteAccountRow(props) {
  const open = () => useUI.getState().openSheet(close => <DeleteAccountSheet {...props} close={close} />)
  return <Row icon="trash" iconTint="var(--red)" title={t('Delete my account')} subtitle={t('Removes your profile and everything in it from this server.')} danger onClick={open} />
}
