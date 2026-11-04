import { useCallback, useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { deriveSignInMethods, canRemovePasskey, canUnlinkGoogle, googleLinkErrorText } from '../lib/signin-methods.js'
import { confirmSheet } from '../sheets.jsx'
import { useFb } from './FirebaseAccount.jsx'
import { Button } from './ui.jsx'

// Settings → Sign-in methods (Firebase mode): the one place an account manages how it
// signs in: link or unlink Google, add a passkey, remove a passkey. Mounted next to
// the Cloud sync card and renders nothing signed out.
//
// Where the state comes from: passkey credentials live in Admin-SDK-only collections,
// so the list is read from the project's own /api/passkey/list (the server derives
// everything from the verified ID token). Linking Google is pure Firebase Auth
// (linkWithRedirect/linkWithPopup in lib/firestore-sync.js) and never changes the uid,
// so the data under users/{uid} is the same account's throughout. The lockout guard,
// never offer removing the last remaining method, is derived in lib/signin-methods.js
// and enforced again by the server on passkey removal.

// "Added 3 Sep": the year only when it is not this one (same shape as Passkeys.jsx).
const when = ts => {
  if (!ts) return ''
  const d = new Date(ts)
  const year = d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}
  try { return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', ...year }) } catch { return '' }
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }

export default function SignInMethods() {
  const toast = useUI(s => s.toast)
  const { mod, auth } = useFb()
  const [data, setData] = useState(null) // { username, providers, passkeys } from the server
  const [loadErr, setLoadErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [askName, setAskName] = useState(false)
  const outcomeTaken = useRef(false)

  const load = useCallback(async () => {
    if (!mod || !auth.user) return
    try { setData(await mod.fbSignInMethods()); setLoadErr('') }
    catch (e) { setLoadErr(e?.message || t('Something went wrong')) }
  }, [mod, auth.user])

  useEffect(() => { load() }, [load])

  // Coming back from a Google link redirect: report how it went, then re-read the list
  // (the link itself already landed on the account while we were away).
  useEffect(() => {
    if (!mod || outcomeTaken.current) return
    outcomeTaken.current = true
    mod.fbLinkOutcome().then(out => {
      if (!out) return
      if (out.error) toast(googleLinkErrorText(out.code) ? t(googleLinkErrorText(out.code)) : (out.message || t('Something went wrong')))
      else { toast(t('Google linked')); load() }
    }).catch(() => {})
  }, [mod, load, toast])

  if (!mod || !auth.user) return null

  const run = async (fn, okMsg, after) => {
    setBusy(true)
    try {
      const out = await fn()
      if (out && out.redirect) return // the page is leaving for Google; nothing to report
      if (okMsg) toast(okMsg)
      if (after) after()
      load()
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return
      const friendly = e?.code ? googleLinkErrorText(e.code) : null
      toast(friendly ? t(friendly) : (e?.message || t('Something went wrong')))
    } finally { setBusy(false) }
  }

  const methods = data ? deriveSignInMethods(data) : null
  const passkeyMeta = c => [c.createdAt && t('Added {0}', when(c.createdAt)), c.backedUp && t('Synced passkey')].filter(Boolean).join(' · ')

  const removePasskey = c => confirmSheet({
    title: t('Remove this passkey?'),
    message: t('You will not be able to sign in with this passkey any more.'),
    confirmText: t('Remove'),
    onConfirm: () => run(() => mod.fbRemovePasskey(c.id), t('Passkey removed')),
  })
  const unlinkGoogle = () => confirmSheet({
    title: t('Unlink Google?'),
    message: t('You will not be able to sign in with Google any more.'),
    confirmText: t('Unlink'),
    onConfirm: () => run(() => mod.fbUnlinkGoogle(), t('Google unlinked')),
  })

  return (
    <div className="card" style={{ padding: 16, marginBottom: 22 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('Sign-in methods')}</div>
      <div className="muted small" style={{ marginBottom: 6 }}>
        {t('The ways you can sign in to this account. Your plan and workouts stay the same whichever you use.')}
      </div>
      {!data && !loadErr && <div className="muted small">{t('Loading…')}</div>}
      {!data && loadErr && <>
        <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{loadErr}</div>
        <Button disabled={busy} onClick={load}>{t('Try again')}</Button>
      </>}
      {data && methods && <>
        {/* Google */}
        <div style={rowStyle}>
          <div className="grow">
            <div>{t('Google')}</div>
            <div className="muted small">{methods.googleLinked ? (auth.user.email || t('Linked')) : t('Not linked')}</div>
          </div>
          {methods.googleLinked
            ? <Button variant="ghost" disabled={busy || !canUnlinkGoogle(methods)} onClick={unlinkGoogle}>{t('Unlink')}</Button>
            : <Button disabled={busy} onClick={() => run(() => mod.fbLinkGoogle(), t('Google linked'))}>{t('Link Google')}</Button>}
        </div>
        {/* Passkeys */}
        {data.passkeys.map(c => (
          <div key={c.id} style={rowStyle}>
            <div className="grow">
              <div>{t('Passkey')}</div>
              {passkeyMeta(c) && <div className="muted small">{passkeyMeta(c)}</div>}
            </div>
            <Button variant="ghost" disabled={busy || !canRemovePasskey(methods)} onClick={() => removePasskey(c)}>{t('Remove')}</Button>
          </div>
        ))}
        {methods.onlyOneMethod && (
          <div className="muted small" style={{ margin: '2px 0 8px' }}>{t('This is your only way in, so it cannot be removed.')}</div>
        )}
        {/* Add a passkey: under the account's username when it has one; a Google-first
            account picks the username now, and the link ceremony claims it. */}
        {data.username || !askName
          ? <Button disabled={busy} onClick={() => (data.username ? run(() => mod.fbAddPasskeyLinked(), t('Passkey added')) : setAskName(true))}>{t('Add a passkey')}</Button>
          : <>
            <input className="input" placeholder={t('Username')} maxLength={40} value={name}
              onChange={e => setName(e.target.value)} autoComplete="username" />
            <div className="muted small" style={{ margin: '8px 0 10px' }}>
              {t('Choose a username for your passkey. You will sign in with this name when you use the passkey.')}
            </div>
            <Button disabled={busy || !name.trim()} onClick={() => run(() => mod.fbAddPasskeyLinked(name), t('Passkey added'), () => setAskName(false))}>{t('Add a passkey')}</Button>
          </>}
      </>}
    </div>
  )
}
