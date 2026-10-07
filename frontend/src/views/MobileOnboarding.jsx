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

// `again`: a phone whose server stopped accepting it (components/ServerSync.jsx pairAgain) — the
// address it had is filled in when it still has one, so only the new code is left to type, and
// the sheet says that what the phone kept is merged, not replaced.
export function ConnectSheet({ close, initialUrl = '', again = false }) {
  const { connectToServer } = useStore()
  const [url, setUrl] = useState(initialUrl)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // Why the last try failed, under the fields: a toast is gone in two seconds, too soon to read
  // "the server was reached but refused the app's request" and act on it (#329).
  const [error, setError] = useState('')
  const ref = useRef(null)
  const codeRef = useRef(null)
  useEffect(() => { setTimeout(() => (initialUrl ? codeRef : ref).current?.focus(), 250) }, [])
  const go = async () => {
    if (!url.trim() || !code.trim()) { useUI.getState().toast(t('Enter your server address and the code')); return }
    setBusy(true)
    setError('')
    try { await connectToServer(url.trim(), code.trim(), askAddDeviceData); close(); useUI.getState().toast(t('Connected')) }
    catch (e) { setError(e.message || t('Could not connect')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{again ? t('Pair again') : t('Connect to my server')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {again
        ? t('Open Settings → Account → “Pair the mobile app” on your openGym site in a browser and enter the new code shown there. What this phone kept is merged into your account.')
        : t('Open Settings → Account → “Pair the mobile app” on the openGym site you’re already signed into, then enter its address and the code shown there.')}
    </div>
    <input ref={ref} className="input" placeholder={t('Server address (e.g. gym.example.com)')} value={url}
      onChange={e => setUrl(e.target.value)} autoCapitalize="none" autoCorrect="off" inputMode="url" />
    <div style={{ height: 10 }} />
    <input ref={codeRef} className="input" placeholder={t('Pairing code')} maxLength={8} value={code}
      onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
    {error && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 10, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{error}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Connecting…') : t('Connect')}</Button>
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
      <Button icon="cloud" onClick={() => useUI.getState().openSheet(close => <ConnectSheet close={close} />)}>{t('Connect to my server')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>
        {t('Local keeps everything on this phone. Connecting syncs to your own openGym server instead. You can switch later in Settings.')}
      </div>
    </div>
  )
}
