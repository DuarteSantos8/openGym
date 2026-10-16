import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, passkeyError, bio } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { BRAND } from '../brand.js'
import BrandMark from '../components/BrandMark.jsx'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { useState, useRef, useEffect } from 'react'
import { Button, Segmented } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { passwordOn, PasswordRegisterForm, openPasswordSignIn } from '../components/PasswordAuth.jsx'
import { openDeviceLinkRedeem } from '../components/Passkeys.jsx'
import { Spacer, Stack } from '../components/layout.jsx'
import { Card } from '../components/blocks.jsx'
import { SheetHeader } from '../components/sheet-layout.jsx'

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
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created, and this device’s data moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Registration failed'))) }
  }
  const choose = pwOn && webauthnOK() && <>
    <Segmented options={[{ value: 'passkey', label: t('Passkey'), icon: 'fingerprint' }, { value: 'password', label: t('Password'), icon: 'key' }]}
      value={how} onChange={setHow} />
    <Spacer size={6} />
  </>
  if (pwOn && how === 'password') return <>
    <SheetHeader title={t('Create your profile')} />
    {choose}
    <div className="muted small mb-7">{t('Pick a name and a password. You sign in with both.')}</div>
    <PasswordRegisterForm close={close} inviteOnly={inviteOnly} name={name} setName={setName} code={code} setCode={setCode} />
  </>
  return <>
    <SheetHeader title={t('Create your profile')} />
    {choose}
    <div className="muted small mb-7">{t('Pick a name, then confirm with {0}. The passkey lives on your device, so no password needed.', bio())}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <Spacer size={5} />
      <input className="input ls-14 fw-semibold ta-center" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} />
      <div className="dim small mt-3">{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    <Spacer size={6} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

export default function Login() {
  const { setUser, adoptProfile, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const pwOn = passwordOn(config)
  const register = () => useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u, { adopt: true }); await adoptProfile(askAddDeviceData); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Sign-in failed'))) }
  }
  const head = <>
    <div className="gate-logo"><BrandMark /></div>
    <h1 className="gate-title fs-large fw-bold">{BRAND.name}</h1>
  </>

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <Stack className="gate-wrap ta-center">
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo. Everything stays in this browser.')}</div>
      <Button variant="primary" icon="play" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <Card className="small muted ta-start mt-8">
        {t('This demo runs entirely in your browser on example data. Nothing is sent anywhere. Passkey sign-in and sync across your devices come with the Gains server, which you get by self-hosting it.')}
      </Card>
      <div className="dim small mt-10 lh-160">
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </Stack>
  )

  return (
    <Stack className="gate-wrap ta-center">
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {webauthnOK() ? <>
        <Button variant="primary" icon="fingerprint" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <Spacer size={5} />
        {pwOn && <><Button icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button><Spacer size={5} /></>}
        <Button icon="plusCircle" onClick={register}>{t('Create new profile')}</Button>
        {/* Already signed in on another device: a code from there gives this one a passkey of
            its own (#95), instead of a new, empty profile. */}
        <Spacer size={5} />
        <Button variant="ghost" className="dim" icon="qr" onClick={openDeviceLinkRedeem}>{t('Use a code from your other device')}</Button>
        {canGuest && <Spacer size={2} />}
      </> : pwOn ? <>
        {/* Plain http on a LAN address, or a browser without passkey support: the password is
            the way in, and the only way to create a profile from here. */}
        <Card className="small muted ta-start mb-7">{t("This browser doesn't support passkeys. Sign in with your name and password instead.")}</Card>
        <Button variant="primary" icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button>
        <Spacer size={5} />
        <Button icon="plusCircle" onClick={register}>{t('Create new profile')}</Button>
        {canGuest && <Spacer size={5} />}
      </> : <Card className="small muted ta-start">{canGuest
        ? t("This browser doesn't do passkeys, but you can still use Gains locally on this device.")
        // Without passkeys and without the guest entrance there is no way in from this browser,
        // so say that plainly instead of offering a local profile that cannot be created.
        : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</Card>}
      {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
      <div className="dim small lh-150" style={{ marginTop: 26 }}>{pwOn ? t('Passkeys use {0}. A password works too, where passkeys do not.', bio()) : t('Passkeys use {0}. No passwords to remember.', bio())}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </Stack>
  )
}
