import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, bio } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { MOBILE } from '../lib/mobile.js'
import { oidcStartUrl, oidcPending, oidcConfirm, SENTENCE_TOAST_MS } from '../lib/oidc.js'
import { oidcErrorKey } from '../lib/oidc-errors.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { passwordOn, PasswordRegisterForm, openPasswordSignIn } from '../components/PasswordAuth.jsx'
import { openDeviceLinkRedeem } from '../components/Passkeys.jsx'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const inviteOnly = !!config?.invite_only
  // A password is offered only where the instance allows it (#118), and is the only choice in a
  // browser that cannot make a passkey. Where both work, the passkey stays the first one.
  const pwOn = passwordOn(config)
  const [how, setHow] = useState(webauthnOK() ? 'passkey' : 'password')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  // Boot already fetched this; retry here only if that attempt failed, so the invite field still
  // appears on an instance whose config arrived late rather than never.
  useEffect(() => { loadConfig() }, [loadConfig])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  const choose = pwOn && webauthnOK() && <>
    <Segmented options={[{ value: 'passkey', label: t('Passkey'), icon: 'person' }, { value: 'password', label: t('Password'), icon: 'key' }]}
      value={how} onChange={setHow} />
    <div style={{ height: 12 }} />
  </>
  if (pwOn && how === 'password') return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name and a password. You sign in with both.')}</div>
    <PasswordRegisterForm close={close} inviteOnly={inviteOnly} name={name} setName={setName} code={code} setCode={setCode} />
  </>
  return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', bio())}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

// The full-screen state a browser lands on after the provider resolves an identity it has never
// seen before. Deliberately not a sheet: a sheet is dismissable by a swipe or a backdrop tap, and
// the decision this screen protects - a NEW, empty profile is about to be created - must not be
// dismissable without being made, one way or the other.
function ConfirmProfileScreen({ seeded, onCancel }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  // A code is asked for here and nowhere earlier in this flow, because this screen is the one
  // that creates a profile - signing in with a profile that already exists never reaches it.
  const inviteOnly = !!config?.invite_only
  const [name, setName] = useState(seeded || '')
  const [code, setCode] = useState('')
  // Same retry RegisterSheet performs, and for a sharper reason: this screen renders on a fresh
  // load straight after a redirect, so a config request that failed would hide the invite field
  // on an invite-only instance and leave the only way in refusing every submission.
  useEffect(() => { loadConfig() }, [loadConfig])
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await oidcConfirm(n, code)
      setUser(u)
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { useUI.getState().toast(t(oidcErrorKey(e.data?.code || e.code)), SENTENCE_TOAST_MS) }
  }
  return (
    <div className="narrow" style={wrap}>
      {head}
      <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.021em', margin: '10px 0 4px' }}>{t('Confirm your name')}</h3>
      <div className="muted" style={{ marginBottom: 14 }}>
        {t("You're creating a NEW, empty profile. If you already have a profile here, go back and sign in with your passkey instead.")}
      </div>
      <input className="input" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
      {inviteOnly && <>
        <div style={{ height: 10 }} />
        <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
          onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
        <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
      </>}
      <div style={{ height: 12 }} />
      <Button variant="primary" onClick={go}>{t('Create profile')}</Button>
      <div style={{ height: 10 }} />
      <Button variant="ghost" className="dim" onClick={onCancel}>{t("This isn't me - go back")}</Button>
    </div>
  )
}

export default function Login() {
  const { setUser, adoptProfile, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const pwOn = passwordOn(config)
  const register = () => useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u, { adopt: true }); await adoptProfile(askAddDeviceData); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Offered only where a provider is configured and the WebView cannot navigate away to it and
  // back the way a browser tab can (the naming screen and the fuller button precedence arrive in
  // the next Login plan).
  const provider = (!MOBILE && config?.oidc) || null
  const goProvider = () => { window.location.href = oidcStartUrl() }
  const [confirming, setConfirming] = useState(false)
  const [seededName, setSeededName] = useState('')

  // The provider redirects back here carrying either a short failure code or a marker that an
  // unknown identity is waiting to be named, both in the URL fragment so neither one reaches a
  // server log or a Referer header. Read with the plain DOM API rather than the router: this
  // screen renders outside <Routes> while unauthenticated, and replaceState here does not fire
  // hashchange, so it never triggers a spurious route recompute.
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#err=')) {
      useUI.getState().toast(t(oidcErrorKey(hash.slice('#err='.length))), SENTENCE_TOAST_MS)
      history.replaceState(null, '', window.location.pathname)
    } else if (hash === '#oidc=confirm') {
      oidcPending()
        .then(res => { setSeededName(res.name); setConfirming(true) })
        .catch(e => {
          useUI.getState().toast(t(oidcErrorKey(e.data?.code || e.code)), SENTENCE_TOAST_MS)
          history.replaceState(null, '', window.location.pathname)
        })
    }
  }, [])

  // Abandons the in-memory identity without telling the server; its own TTL expires it regardless.
  const cancelConfirm = () => {
    setConfirming(false)
    history.replaceState(null, '', window.location.pathname)
  }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'start', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  if (confirming) return <ConfirmProfileScreen seeded={seededName} onCancel={cancelConfirm} />

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {provider && <>
        <Button variant="primary" icon="person" onClick={goProvider}>{t('Sign in with {0}', provider.name)}</Button>
        <div style={{ height: 10 }} />
      </>}
      {webauthnOK() ? <>
        {/* One loud button per screen state: whenever the provider button above already claims
            the primary slot, passkey (and password, below) step back to plain - a newcomer
            should never have to guess which of two loud buttons the operator actually intends. */}
        <Button variant={provider ? undefined : 'primary'} icon="person" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        {pwOn && <><Button icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button><div style={{ height: 10 }} /></>}
        <Button icon="sparkles" onClick={register}>{t('Create new profile')}</Button>
        {/* Already signed in on another device: a code from there gives this one a passkey of
            its own (#95), instead of a new, empty profile. */}
        <div style={{ height: 10 }} />
        <Button variant="ghost" className="dim" icon="qr" onClick={openDeviceLinkRedeem}>{t('Use a code from your other device')}</Button>
        {canGuest && <div style={{ height: 4 }} />}
      </> : pwOn ? <>
        {/* Plain http on a LAN address, or a browser without passkey support: the password is
            the way in, and the only way to create a profile from here - unless a provider button
            is already visible above, in which case there is a second way in too, and the card
            must say so rather than sound like password is the only door. */}
        <div className="card small muted" style={{ textAlign: 'start', marginBottom: 14 }}>{provider
          ? t("This browser doesn't support passkeys - sign in with {0} above, or with your name and password below.", provider.name)
          : t("This browser doesn't support passkeys — sign in with your name and password instead.")}</div>
        <Button variant={provider ? undefined : 'primary'} icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="sparkles" onClick={register}>{t('Create new profile')}</Button>
        {canGuest && <div style={{ height: 10 }} />}
      </> : <div className="card small muted" style={{ textAlign: 'start' }}>{provider
        ? t("This browser doesn't support passkeys - sign in with {0} above, or try a browser or device with passkey support.", provider.name)
        : canGuest
          ? t("This browser doesn't support passkeys — you can still use openGym locally on this device.")
          // Without passkeys, without the guest entrance and without a provider there is no way
          // in from this browser, so say that plainly instead of offering a profile that cannot
          // be created.
          : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</div>}
      {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{pwOn ? t('Passkeys use {0}. A password works too, where passkeys do not.', bio()) : t('Passkeys use {0} — no passwords.', bio())}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
