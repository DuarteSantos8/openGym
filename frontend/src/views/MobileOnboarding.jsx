// Mobile build only, first launch: the choice useStore.boot() couldn't make on its own — keep
// everything on this device, or connect to a self-hosted openGym server instead. See
// lib/remote.js for the pairing flow this hands off to.
import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { serverConfig } from '../lib/api.js'
import { normalizeServerUrl } from '../lib/remote.js'
import { startProviderSignIn, useAttemptUnfinished } from '../components/AppSignIn.jsx'

// How long the address field sits still before this sheet asks that server what it offers - a
// lookup on every keystroke would fire one request per character typed.
const CONFIG_LOOKUP_DEBOUNCE_MS = 400

// `again`: a phone whose server stopped accepting it (components/ServerSync.jsx pairAgain) — the
// address it had is filled in when it still has one, so only the new code is left to type, and
// the sheet says that what the phone kept is merged, not replaced.
export function ConnectSheet({ close, initialUrl = '', again = false }) {
  const { connectToServer } = useStore()
  const [url, setUrl] = useState(initialUrl)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // What the typed address's server offers (GET /api/config, unauthenticated), once it settles -
  // null until an address resolves and answers, so a server without a provider (or an address
  // still being typed) renders exactly as this screen always has.
  const [oidc, setOidc] = useState(null)
  const [unfinished, clearUnfinished] = useAttemptUnfinished('signIn')
  const ref = useRef(null)
  const codeRef = useRef(null)
  useEffect(() => { setTimeout(() => (initialUrl ? codeRef : ref).current?.focus(), 250) }, [])

  // Debounced, and fired once at mount for an address already filled in (the `again` case) - an
  // answer for an address no longer in the field when it arrives is dropped, checked against what
  // normalizeServerUrl(url) resolves to at that moment, not at the moment the request was sent.
  useEffect(() => {
    const base = normalizeServerUrl(url)
    if (!base) { setOidc(null); return }
    const timer = setTimeout(() => {
      serverConfig(base).then(cfg => { if (normalizeServerUrl(url) === base) setOidc(cfg.oidc || null) }).catch(() => {})
    }, CONFIG_LOOKUP_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [url])

  const go = async () => {
    if (!url.trim() || !code.trim()) { useUI.getState().toast(t('Enter your server address and the code')); return }
    setBusy(true)
    try { await connectToServer(url.trim(), code.trim(), askAddDeviceData); close(); useUI.getState().toast(t('Connected')) }
    catch (e) { useUI.getState().toast(e.message || t('Could not connect')) }
    finally { setBusy(false) }
  }
  // A ref, not state: two taps in the same event-handling pass would both still read a stale
  // `busy` before either render flushes, and both would depart - each with its own verifier,
  // overwriting the single attempt record the other tap's return needs. `busy` still drives the
  // disabled buttons (the visible half of the guard); the ref is what makes the guard correct
  // regardless of when React gets around to re-rendering.
  const providerInFlight = useRef(false)
  const signInWithProvider = async () => {
    if (busy || providerInFlight.current) return
    const base = normalizeServerUrl(url)
    if (!base) return
    providerInFlight.current = true
    clearUnfinished()
    setBusy(true)
    try { await startProviderSignIn(base) }
    finally { providerInFlight.current = false; setBusy(false) }
  }
  return <>
    <h3>{again ? t('Pair again') : t('Connect to my server')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {again
        ? t('Open Settings → “Pair the mobile app” on your openGym site in a browser and enter the new code shown there. What this phone kept is merged into your account.')
        : t('Open Settings → “Pair the mobile app” on the openGym site you’re already signed into, then enter its address and the code shown there.')}
    </div>
    <input ref={ref} className="input" placeholder={t('Server address (e.g. gym.example.com)')} value={url}
      onChange={e => setUrl(e.target.value)} autoCapitalize="none" autoCorrect="off" inputMode="url" />
    {oidc ? <>
      <div style={{ height: 10 }} />
      <Button variant="primary" icon="person" disabled={busy} onClick={signInWithProvider}>
        {again ? t('Sign in again with {0}', oidc.name) : t('Sign in with {0}', oidc.name)}
      </Button>
      {unfinished && <div className="dim small" style={{ marginTop: 8 }}>{t('Sign-in was not finished')}</div>}
      <div className="dim small" style={{ margin: '14px 0 8px', textAlign: 'center' }}>{t('or pair with a code')}</div>
    </> : <div style={{ height: 10 }} />}
    <input ref={codeRef} className="input" placeholder={t('Pairing code')} maxLength={8} value={code}
      onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
    <div style={{ height: 12 }} />
    <Button variant={oidc ? undefined : 'primary'} onClick={go} disabled={busy}>{busy ? t('Connecting…') : t('Connect')}</Button>
  </>
}

export default function MobileOnboarding() {
  const { chooseLocalMode } = useStore()
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }
  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('How do you want to use openGym?')}</div>
      <Button variant="primary" icon="lock" onClick={() => chooseLocalMode()}>{t('Use on this device')}</Button>
      <div style={{ height: 10 }} />
      <Button icon="rocket" onClick={() => useUI.getState().openSheet(close => <ConnectSheet close={close} />)}>{t('Connect to my server')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>
        {t('Local keeps everything on this phone. Connecting syncs to your own openGym server instead — you can switch later in Settings.')}
      </div>
    </div>
  )
}
