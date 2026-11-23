// The Cloud edition's account screen (ADR 0010, 0013): sign in, create an account, reset a
// password, see and change who you are, take your data, delete the account, and approve a
// sign-in to the app's own server. One screen, one panel, a title that always says which step
// this is. Reached only in the cloud edition (App.jsx); the default build does not carry it.
//
// Links in the project's emails come back here as #/account?token_hash=…&type=…, and the hosted
// sign-in server sends people here as #/account?authorization_id=… to approve (ADR 0013).
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import { Button, TextField } from '../../components/ui.jsx'
import { cloud } from '../../lib/cloud/client.js'
import { createPendingReset } from '../../lib/cloud/pending-reset.js'
import { enterApp } from '../../lib/cloud/enter-app.js'
import { useStore } from '../../store/useStore.js'
import './account.css'

export const MIN_PASSWORD = 8

// A reset link has been followed and the new password not yet chosen: kept for the tab
// (lib/cloud/pending-reset.js), not in component state. The app remounts a view when its address
// changes, and taking the link's hash out of the address is such a change; and the page can be
// loaded again while the session the link gave is still there. Either way the person would land
// on their account without ever being asked for the password.
let pending = createPendingReset()
// Why a followed link failed (its code), kept outside the component for the first reason: the
// remount would otherwise wipe the message, and a dead link would show nothing at all. Cleared
// by the next thing done.
let linkFailure = null
/** For tests: what loading the page again does here. Its memory goes; what the tab keeps stays. */
export const forgetLink = () => { pending = createPendingReset(); linkFailure = null }

/** A refusal's code, in words. Anything not listed gets the general line: never the raw code. */
export function wordFor(code) {
  switch (code) {
    case 'invalid_credentials': return t('That email or password is not right.')
    case 'email_not_confirmed': return t('Confirm your email first. The link is in your inbox.')
    case 'user_already_exists': case 'email_exists': return t('That address already has an account. Sign in instead.')
    case 'weak_password': return t('That password is too easy to guess. Try a longer one, or a few random words strung together.')
    case 'email_address_invalid': case 'email_address_not_authorized': case 'validation_failed': return t('That email address is not accepted.')
    case 'over_request_rate_limit': case 'over_email_send_rate_limit': return t('Too many tries. Wait a minute and try again.')
    case 'otp_expired': case 'flow_state_expired': case 'flow_state_not_found': return t('This link has expired. Ask for a new one.')
    case 'user_banned': return t('This account has been disabled.')
    case 'subscription_active': return t('Cancel your subscription first, then delete the account.')
    case 'network': return t('No connection. Check your network and try again.')
    default: return t('Something went wrong. Try again.')
  }
}

const here = () => (typeof location === 'undefined' ? '' : location.origin + location.pathname + '#/account')

function save(name, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function Account({ client = cloud(), go = url => { location.assign(url) }, enter = () => enterApp(useStore.getState()) }) {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const tokenHash = params.get('token_hash'), linkType = params.get('type'), authorizationId = params.get('authorization_id')
  const [session, setSession] = useState(() => client?.auth.session() ?? null)
  const [mode, setModeState] = useState(() => (pending.isFor(client?.auth.session()?.user?.id) ? 'newpass' : 'signin'))   // signin | signup | forgot | sent | newpass
  const setMode = m => { if (m === 'newpass') pending.mark(client?.auth.session()?.user?.id); else pending.clear(); setModeState(m) }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [word, setWord] = useState('')
  const [error, setError] = useState(() => (linkFailure ? wordFor(linkFailure) : ''))
  const [busy, setBusy] = useState(false)
  const [request, setRequest] = useState(null)
  const [sentAfter, setSentAfter] = useState('')     // what led to "check your email": signup | forgot
  const [ready, setReady] = useState(false)          // the profile has loaded: only then may the name be saved
  const title = useRef(null)
  const typedName = useRef(false)   // the name field has been edited: a late profile load must not replace it

  useEffect(() => client?.auth.onChange(setSession), [client])
  // A new step is a new page to someone who cannot see it change: move focus to its title.
  useEffect(() => { title.current?.focus() }, [mode, !!session, !!request])

  /** Runs one action: busy while it does, its refusal in words, never two at once. */
  const run = async fn => {
    if (busy) return
    linkFailure = null
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(wordFor(e?.code)) } finally { setBusy(false) }
  }

  // An emailed link: trade its hash for a session, once, then drop it from the address.
  useEffect(() => {
    if (!client || !tokenHash || !linkType) return
    run(async () => {
      try { await client.auth.verify({ type: linkType, tokenHash }); if (linkType === 'recovery') setMode('newpass') }
      catch (e) { linkFailure = e?.code || 'unknown'; throw e }
      finally { setParams(p => { p.delete('token_hash'); p.delete('type'); return p }, { replace: true }) }
    })
  }, [])

  // Whoever is signed in has changed: nothing typed for the last account carries over to this
  // one. Above all not the word that confirms deleting it.
  useEffect(() => { setWord(''); setName(''); setReady(false) }, [session?.user?.id])
  // Nor a password to choose: that step belongs to the account the link signed in. Signed out,
  // or signed in as someone else, it is over.
  useEffect(() => {
    if (pending.isFor(session?.user?.id)) return
    pending.clear()
    setModeState(m => (m === 'newpass' ? 'signin' : m))
  }, [session?.user?.id])

  useEffect(() => {
    if (!client || !session) return
    let live = true
    typedName.current = false
    client.profiles.get().then(p => { if (!live) return; if (p && !typedName.current) setName(p.display_name || ''); setReady(true) }).catch(() => {})
    return () => { live = false }
  }, [client, session?.user?.id])

  // Someone is being asked to approve a sign-in to the app's own server: find out what for.
  useEffect(() => {
    if (!client || !session || !authorizationId) { setRequest(null); return }
    let live = true
    client.auth.authorization(authorizationId).then(r => { if (live) setRequest(r || {}) }).catch(e => { if (live) setError(wordFor(e?.code)) })
    return () => { live = false }
  }, [client, session?.user?.id, authorizationId])

  if (!client) return <div className="page iv-acct"><h1 className="iv-acct-title">{t('Account')}</h1><p className="iv-acct-lead" role="alert">{t('Something went wrong. Try again.')}</p></div>

  const frame = (heading, lead, body) => <div className="page iv-acct" data-mode={session ? (request ? 'consent' : mode === 'newpass' ? 'newpass' : 'account') : mode}>
    <p className="iv-acct-eyebrow">{t('Account')}</p>
    <h1 className="iv-acct-title" tabIndex={-1} ref={title}>{heading}</h1>
    {lead && <p className="iv-acct-lead">{lead}</p>}
    <section className="iv-acct-panel">
      {error && <p className="iv-acct-error" role="alert">{error}</p>}
      {body}
    </section>
  </div>

  const emailField = <label className="iv-acct-field"><span>{t('E-mail address')}</span>
    <TextField className="input" type="email" name="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={e => setEmail(e.target.value)} /></label>
  const passwordField = (auto, hint, fresh = false) => <label className="iv-acct-field"><span>{fresh ? t('New password') : t('Password')}</span>
    <TextField className="input" type="password" name="password" autoComplete={auto} required minLength={auto === 'new-password' ? MIN_PASSWORD : undefined} value={password} onChange={e => setPassword(e.target.value)} />
    {hint && <small>{t('At least 8 characters')}</small>}</label>
  const swap = (to, label) => <button type="button" className="btn ghost sm" data-go={to} onClick={() => { linkFailure = null; setMode(to); setError(''); setPassword('') }}>{label}</button>

  if (session && request) return frame(t('Allow {0} to sign you in?', request.client?.name || t('Account')), t('Signed in as {0}', session.user.email), <div className="iv-acct-actions">
    <Button variant="primary" disabled={busy} type="button" data-allow="" onClick={() => run(async () => { const { redirectTo } = await client.auth.consent(authorizationId, true); if (redirectTo) go(redirectTo) })}>{t('Allow')}</Button>
    <Button variant="ghost" disabled={busy} type="button" data-deny="" onClick={() => run(async () => { const { redirectTo } = await client.auth.consent(authorizationId, false); if (redirectTo) go(redirectTo) })}>{t('Cancel')}</Button>
  </div>)

  if (session && mode === 'newpass') return frame(t('New password'), null, <form className="iv-acct-form" onSubmit={e => { e.preventDefault(); run(async () => { await client.auth.updatePassword(password); setPassword(''); setMode('signin') }) }}>
    {passwordField('new-password', true, true)}
    <div className="iv-acct-actions"><Button variant="primary" type="submit" disabled={busy || password.length < MIN_PASSWORD}>{t('Save')}</Button></div>
  </form>)

  if (session) return frame(name || session.user.email, null, <>
    <p className="iv-acct-who">{t('Signed in as {0}', session.user.email)}</p>
    <form className="iv-acct-form" onSubmit={e => { e.preventDefault(); if (!ready) return; run(async () => { const p = await client.profiles.update({ display_name: name }); if (p) setName(p.display_name || '') }) }}>
      <label className="iv-acct-field"><span>{t('Name')}</span>
        <TextField className="input" name="name" autoComplete="nickname" maxLength={80} value={name} onChange={e => { typedName.current = true; setName(e.target.value) }} /></label>
      <div className="iv-acct-actions">
        <Button variant="primary" type="submit" disabled={busy || !ready} data-save="">{t('Save')}</Button>
        <Button variant="tinted" disabled={busy} type="button" data-export="" onClick={() => run(async () => {
          const { status, data } = await client.fn('export-account')
          if (status !== 200) throw { code: data?.error }
          save('ironvane-account.json', JSON.stringify(data, null, 2))
        })}>{t('Export')}</Button>
        <Button variant="ghost" disabled={busy} type="button" data-change="" onClick={() => { setError(''); setPassword(''); setMode('newpass') }}>{t('Change password')}</Button>
        {/* The way on: into the app itself. Someone who arrived from an email in a fresh browser
            has no tab bar yet, and without this the account screen would be a dead end. */}
        <Button variant="ghost" disabled={busy} type="button" data-continue="" onClick={() => { enter(); nav('/home') }}>{t('Continue')}</Button>
        <Button variant="ghost" disabled={busy} type="button" data-signout="" onClick={() => { setMode('signin'); setPassword(''); run(() => client.auth.signOut()) }}>{t('Sign out')}</Button>
      </div>
    </form>
    <form className="iv-acct-form iv-acct-danger" onSubmit={e => { e.preventDefault(); run(async () => {
      const { status, data } = await client.fn('delete-account', { confirm: 'delete' })
      if (status !== 200) throw { code: data?.error }
      // the step first, the server after: a slow sign-out must not move someone who has tapped on
      setWord(''); setMode('signin')
      await client.auth.signOut()
    }) }}>
      <label className="iv-acct-field"><span>{t('Delete account')}</span>
        <TextField className="input" name="confirm" autoComplete="off" autoCapitalize="none" spellCheck={false} value={word} onChange={e => setWord(e.target.value)} />
        <small>{t('Type the word delete to confirm. Your account is removed and cannot be brought back.')}</small></label>
      <div className="iv-acct-actions"><Button variant="danger" type="submit" disabled={busy || word.trim().toLowerCase() !== 'delete'} data-delete="">{t('Delete account')}</Button></div>
    </form>
  </>)

  // After a sign-up the server answers the same whether the address is new or already has an
  // account, and for the second it sends nothing, so that nobody can probe which addresses are
  // registered. This screen cannot know either. It says what to do if nothing arrives, the same
  // for everyone, and puts the reset one tap away.
  if (mode === 'sent') return frame(t('Check your email'), t('We sent a link to {0}. Open it on this device to continue.', email), <>
    {sentAfter === 'signup' && <p className="iv-acct-hint">{t('No email after a minute? This address may already have an account: sign in, or reset your password.')}</p>}
    <div className="iv-acct-actions">{swap('signin', t('Sign in'))}{sentAfter === 'signup' && swap('forgot', t('Forgot password?'))}</div>
  </>)

  if (mode === 'forgot') return frame(t('Reset your password'), null, <form className="iv-acct-form" onSubmit={e => { e.preventDefault(); run(async () => { await client.auth.recover(email, { redirectTo: here() }); setSentAfter('forgot'); setMode('sent') }) }}>
    {emailField}
    <div className="iv-acct-actions"><Button variant="primary" type="submit" disabled={busy || !email.trim()}>{t('Send reset link')}</Button>{swap('signin', t('Back'))}</div>
  </form>)

  // Back means back: to the screen they came from (Settings, the first screen), with the account
  // no longer behind them in the history. The router numbers this session's entries; at the first
  // one there is nothing of the app's to go back to (a link, a bookmark), so go to the app.
  const leave = () => { if ((window.history.state?.idx ?? 0) > 0) nav(-1); else nav('/home', { replace: true }) }
  const signup = mode === 'signup'
  return frame(signup ? t('Create account') : t('Sign in'), t('One account for your plan and purchases. Your training stays where it is.'), <>
    <form className="iv-acct-form" onSubmit={e => { e.preventDefault(); run(async () => {
      if (!signup) { await client.auth.signIn(email, password); setPassword(''); return }
      const out = await client.auth.signUp(email, password, { redirectTo: here() })
      setPassword('')
      if (out.needsConfirmation) { setSentAfter('signup'); setMode('sent') }
    }) }}>
      {emailField}
      {passwordField(signup ? 'new-password' : 'current-password', signup)}
      <div className="iv-acct-actions"><Button variant="primary" type="submit" disabled={busy || !email.trim() || password.length < (signup ? MIN_PASSWORD : 1)} data-submit="">{signup ? t('Create account') : t('Sign in')}</Button></div>
    </form>
    <div className="iv-acct-links">
      {swap(signup ? 'signin' : 'signup', signup ? t('Sign in') : t('Create account'))}
      {!signup && swap('forgot', t('Forgot password?'))}
      {/* The way out for someone who will not sign in: an app installed to the home screen has no
          browser back, and the first screen is where "Continue without account" is. */}
      <button type="button" className="btn ghost sm" data-back="" onClick={leave}>{t('Back')}</button>
    </div>
  </>)
}
