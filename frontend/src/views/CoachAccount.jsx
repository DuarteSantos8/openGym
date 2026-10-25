// "Your account" — where a profile connects the provider account its own Coach runs are paid
// from, on an instance whose admin chose "each profile connects its own" (authMode: profile).
//
// What it will not do: show a credential back. The token goes up once, is stored encrypted in
// this profile's own file on the server, and is read only by this profile's jobs. A profile that
// has not connected one is refused when it asks the Coach for anything, and that refusal points
// here (JOB_ERRORS.account in lib/coach-api.js).

import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { fetchAccount, connectOwn, disconnectOwn, testOwn } from '../lib/coach-account.js'
import { confirmSheet } from '../sheets.jsx'
import { Button, Segmented, TextField } from '../components/ui.jsx'

const typeLabel = type => type === 'cli-token' ? t('Claude Code setup token') : t('API key')

/** The one line that says whose account is spent, for the row in the Coach menu. */
export function accountSubtitle(a) {
  if (!a) return ''
  if (a.connected) return a.account ? t('Connected · {0}', a.account) : t('Connected')
  return t('Not connected. Connect it to use the Coach')
}

export function AccountSheet({ close, onChange }) {
  const toast = useUI(s => s.toast)
  const [a, setA] = useState(null)
  const [kind, setKind] = useState(null)       // 'cli-token' | 'apikey', once the account says which are offered
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState(null)       // the last "Test my connection" outcome, shown where the button is

  const load = async () => {
    try {
      const next = await fetchAccount()
      setA(next)
      setKind(k => k && next?.accepts?.includes(k) ? k : (next?.accepts?.[0] || null))
      return next
    } catch (e) { toast(e.message || t('Could not reach the server')); return null }
  }
  useEffect(() => { load() }, [])

  if (!a) return <div className="chat-menu"><h3>{t('Your account')}</h3><div className="chat-empty">{t('Loading…')}</div></div>

  const offered = a.accepts || []
  const filed = a.connected && !!a.type     // the fixture "connects" with nothing filed
  const connect = async () => {
    setBusy(true)
    try {
      await connectOwn({ type: kind, token, account: label.trim() })
      setToken(''); setLabel(''); setTest(null)
      toast(t('Connected'))
      await load(); onChange && onChange()
    } catch (e) { toast(e.message || t('Could not connect')) }
    setBusy(false)
  }
  const runTest = async () => {
    setBusy(true); setTest({ pending: true })
    try { setTest(await testOwn()) }
    catch (e) { setTest({ ok: false, error: e.message }) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await disconnectOwn(); setTest(null); toast(t('Disconnected')); await load(); onChange && onChange() }
    catch (e) { toast(e.message || t('Could not disconnect')) }
    setBusy(false)
  }

  return <div className="chat-menu">
    <h3>{t('Your account')}</h3>
    <div className="chat-empty" style={{ paddingTop: 0 }}>
      {t('On this instance every person uses their own {0} account for the Coach. Yours is used only for your own Coach runs. It is stored encrypted on the server and never shown again.', a.providerLabel || a.provider)}
    </div>

    {offered.length > 0 && <div className="chat-empty" style={{ paddingTop: 0 }} data-status>
      <b>{filed ? t('Connected') : t('Not connected')}</b>{filed && a.account ? ' · ' + a.account : ''}{filed && a.type ? ' · ' + typeLabel(a.type) : ''}
    </div>}

    {filed ? <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" variant="tinted" icon="check" disabled={busy} onClick={runTest}>{t('Test my connection')}</Button>
        <Button size="sm" danger disabled={busy} onClick={() => confirmSheet({
          title: t('Disconnect your account?'),
          message: t('The Coach stops working for you until you connect an account again. The stored credential cannot be recovered.'),
          confirmText: t('Disconnect'), danger: true, onConfirm: disconnect
        })}>{t('Disconnect')}</Button>
      </div>
    </> : offered.length ? <>
      {offered.length > 1 && <Segmented value={kind} onChange={setKind}
        options={offered.map(o => ({ value: o, label: typeLabel(o) }))} />}
      <div className="chat-empty">
        {kind === 'cli-token'
          ? t('On a trusted computer where you use Claude Code, run “claude setup-token”, then paste the token it prints here.')
          : t('Paste an API key from your account with the provider.')}
      </div>
      <TextField value={token} type="password" autoCapitalize="none" autoCorrect="off"
        placeholder={kind === 'cli-token' ? t('Paste the setup token') : (a.keyPlaceholder || t('Paste the API key'))}
        onChange={e => setToken(e.target.value)} />
      <div style={{ height: 8 }} />
      <TextField value={label} placeholder={t('Whose account is this? (optional)')} onChange={e => setLabel(e.target.value)} />
      <div style={{ height: 12 }} />
      <Button variant="primary" icon="key" disabled={busy || !token.trim() || !kind} onClick={connect}>{t('Connect')}</Button>
    </> : <div className="chat-empty">{t('This instance’s provider needs no account of your own.')}</div>}

    {test && <div className="chat-empty" role="status">
      {test.pending ? t('Asking the provider…')
        : test.ok ? t('The connection works.')
          : <>{t('The test failed.')} {test.error || ''}</>}
    </div>}
    <div style={{ height: 10 }} />
  </div>
}

/** Open the sheet. `onChange` runs after a connect or disconnect so the screen can re-read. */
export const openAccountSheet = (openSheet, onChange) => openSheet(close => <AccountSheet close={close} onChange={onChange} />)
