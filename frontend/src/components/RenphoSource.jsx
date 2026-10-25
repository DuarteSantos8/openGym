import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { metricOf } from '../lib/health/metrics.js'
import { Section, Row, Button, TextField, Switch } from './ui.jsx'

// Settings → Health → RENPHO Health. The server holds the connection (api/providers/renpho): it
// signs in to RENPHO, keeps the sign-in sealed, and syncs the scale's readings into the profile on
// its own every few hours. This card connects, says how the last sync went, syncs now and
// disconnects. The password goes to the server once and is never kept on the device.
//
// RENPHO keeps one sign-in per account, so the account the RENPHO app uses, signed in here, signs
// the app out. "Second account" signs in with another RENPHO account instead, a friend of the main
// one in the RENPHO app, and the server reads the main account's daily values through it.
//
// Nothing shows where there is no server to hold it: a guest, the phone in local mode.

const ERRORS = {
  auth: () => t('RENPHO did not accept the e-mail and password. Connect again.'),
  rejected: () => t('RENPHO refused the request. Try again, or connect again.'),
  network: () => t('RENPHO could not be reached. Try again later.'),
  format: () => t('RENPHO answered in a way this version does not understand. An update may be needed.'),
  failed: () => t('The sync failed. Try again later.'),
  busy: () => t('Too many attempts. Try again in a while.'),
  missing: () => t('Enter the e-mail and password of your RENPHO account.'),
  'no-friend': () => t('This RENPHO account has no friends yet. In the RENPHO app, add it as a friend of your main account, then connect again.'),
  'friend-choice': () => t('This RENPHO account has more than one friend. Enter the e-mail of your main account.'),
}
// The profile's time zone, which RENPHO groups the friend's values into days by.
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } }
// RENPHO's own code and words, when it gave any ("50012: …"), after ours: what to look up or tell.
const errorText = (code, reason) => (ERRORS[code] || ERRORS.failed)() + (reason ? ' — RENPHO: ' + reason : '')
const ago = ms => {
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return t('just now')
  if (min < 60) return t('{0} min ago', min)
  const h = Math.round(min / 60)
  if (h < 48) return t('{0} h ago', h)
  return new Date(ms).toLocaleDateString()
}

export default function RenphoSource() {
  const user = useStore(s => s.user)
  const pullState = useStore(s => s.pullState)
  const toast = m => useUI.getState().toast(m)
  const [st, setSt] = useState(null)
  const [form, setForm] = useState({ email: '', password: '', areaCode: 'US', friend: false, friendEmail: '' })
  const [busy, setBusy] = useState(false)
  const [again, setAgain] = useState(false)
  const timer = useRef(null)
  const wasSyncing = useRef(false)

  const load = () => api('/api/renpho').then(s => {
    setSt(s)
    clearTimeout(timer.current)
    if (s.syncing) timer.current = setTimeout(load, 2000)
    // A sync that just ended: bring its readings into this device's copy now.
    if (wasSyncing.current && !s.syncing && typeof pullState === 'function') Promise.resolve().then(pullState).catch(() => {})
    wasSyncing.current = !!s.syncing
  }).catch(() => setSt(false))
  useEffect(() => { load(); return () => clearTimeout(timer.current) }, [])

  if (!user || st === false || st === null) return null

  const connect = async () => {
    if (!form.email.trim() || !form.password) { toast(errorText('missing')); return }
    setBusy(true)
    try {
      const { friend, friendEmail, ...sign } = form
      const body = { ...sign, areaCode: form.areaCode.trim().toUpperCase() || 'US', zone: zone(), ...(friend ? { mode: 'friend', friendEmail: friendEmail.trim() } : {}) }
      const s = await api('/api/renpho/connect', { method: 'POST', body: JSON.stringify(body), timeout: 45000 })
      setForm(f => ({ ...f, password: '' }))
      setAgain(false)
      setSt(s); wasSyncing.current = true
      timer.current = setTimeout(load, 1500)
      toast(t('RENPHO connected. Importing your measurements…'))
    } catch (e) {
      setForm(f => ({ ...f, password: '' }))
      toast(errorText(e.data?.code, e.data?.reason))
    } finally { setBusy(false) }
  }
  const syncNow = async () => {
    try { setSt(await api('/api/renpho/sync', { method: 'POST', body: '{}' })); wasSyncing.current = true; timer.current = setTimeout(load, 1500) }
    catch (e) { toast(errorText(e.data?.code)) }
  }
  const disconnect = async () => {
    try { await api('/api/renpho', { method: 'DELETE' }); setSt({ connected: false }); toast(t('RENPHO disconnected')) }
    catch (e) { toast(errorText(e.data?.code)) }
  }
  const downloadRaw = async () => {
    try {
      const raw = await api('/api/renpho/raw')
      const json = JSON.stringify(raw, null, 2)
      if (MOBILE) await shareExport(json, 'renpho-raw.json')
      else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        a.download = 'renpho-raw.json'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }
    } catch (e) { toast(errorText(e.data?.code)) }
  }

  const showForm = !st.connected || again
  const fields = (st.fields || []).filter(f => metricOf(f) && !metricOf(f).seg).map(f => t(metricOf(f).label))
  return <Section title="RENPHO Health" footer={!showForm
    ? t('Your scale’s readings come in every few hours on their own, next to the ones you log yourself.')
    : form.friend
      ? t('Sign in with a second RENPHO account that is your friend in the RENPHO app. The server reads your values through it, so the RENPHO app stays signed in on your phone: one value per day, the day’s last weigh-in, without segmental values.')
      : t('Sign in with your RENPHO Health account. The server keeps the sign-in encrypted and imports every reading of your scale, also the ones RENPHO does not pass to Apple Health. RENPHO has no public API: this uses the one its app uses, and may stop working if RENPHO changes it.')}>
    {st.connected && <>
      <Row icon="checkCircle" iconTint="var(--green)" title={t('Connected')} subtitle={st.email} />
      {st.mode === 'friend' && <Row icon="personCircle" iconTint="var(--blue)" title={t('Through a second account')}
        subtitle={st.friend ? t('Readings of {0}', st.friend) : null} />}
      <Row icon="history" iconTint="var(--blue)" title={t('Last sync')}
        value={st.syncing ? t('Syncing…') : st.lastSync ? ago(st.lastSync) : t('Not yet')}
        subtitle={st.lastResult && !st.syncing ? t('{0} measurements · {1} new · {2} updated', st.lastResult.measurements, st.lastResult.added, st.lastResult.updated) : null} />
      {st.error && <Row icon="warning" iconTint="var(--orange)" title={t('Last sync failed')} subtitle={errorText(st.error.code, st.error.reason)} />}
      {fields.length > 0 && <Row icon="scale" iconTint="var(--teal)" title={t('Values received')} subtitle={fields.join(', ')}
        value={st.segmental ? t('Segmental too') : null} />}
      <Row icon="reset" iconTint="var(--green)" title={t('Sync now')}>
        <Button size="sm" variant="primary" disabled={st.syncing} onClick={syncNow}>{st.syncing ? t('Syncing…') : t('Sync')}</Button>
      </Row>
      <Row icon="download" iconTint="var(--grey)" title={t('RENPHO’s raw data')} subtitle={t('Every field RENPHO sent, as JSON')}>
        <Button size="sm" onClick={downloadRaw}>{t('Download')}</Button>
      </Row>
      {/* Signed in with the app's own account, a second account is one step away. */}
      {!again && (st.error?.code === 'auth' || st.mode !== 'friend') && <Row icon="link" iconTint="var(--orange)" title={t('Connect again')}
        subtitle={st.mode !== 'friend' ? t('With a second account, the RENPHO app stays signed in on your phone.') : null}>
        <Button size="sm" onClick={() => { setForm(f => ({ ...f, friend: true })); setAgain(true) }}>{t('Connect')}</Button>
      </Row>}
      <Row icon="xmark" iconTint="var(--red)" title={t('Disconnect RENPHO')} subtitle={t('The readings already imported stay.')}>
        <Button size="sm" onClick={disconnect}>{t('Disconnect')}</Button>
      </Row>
    </>}
    {showForm && <>
      <Row icon="link" iconTint="var(--teal)" title={t('Second account')}
        subtitle={form.friend ? null : t('Your own account here signs the RENPHO app out on your phone.')}>
        <Switch checked={form.friend} aria-label={t('Second account')} onChange={v => setForm(f => ({ ...f, friend: v }))} />
      </Row>
      <Row icon="personCircle" iconTint="var(--blue)" title={t('E-mail')}>
        <TextField type="email" autoComplete="username" autoCapitalize="off" value={form.email} aria-label={t('E-mail')}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ maxWidth: 200 }} />
      </Row>
      <Row icon="lock" iconTint="var(--grey)" title={t('Password')}>
        <TextField type="password" autoComplete="current-password" value={form.password} aria-label={t('Password')}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ maxWidth: 200 }} />
      </Row>
      {form.friend && <Row icon="personCircle" iconTint="var(--green)" title={t('Main account')}
        subtitle={t('Its e-mail; needed only if the second account has more than one friend.')}>
        <TextField type="email" autoCapitalize="off" value={form.friendEmail} aria-label={t('Main account')}
          onChange={e => setForm(f => ({ ...f, friendEmail: e.target.value }))} style={{ maxWidth: 200 }} />
      </Row>}
      <Row icon="globe" iconTint="var(--teal)" title={t('Region')} subtitle={t('Two letters; leave US unless signing in fails.')}>
        <TextField value={form.areaCode} maxLength={2} autoCapitalize="characters" aria-label={t('Region')}
          onChange={e => setForm(f => ({ ...f, areaCode: e.target.value.replace(/[^a-zA-Z]/g, '') }))} style={{ maxWidth: 60 }} />
      </Row>
      <Row icon="link" iconTint="var(--green)" title={t('Connect RENPHO')}>
        <Button size="sm" variant="primary" disabled={busy} onClick={connect}>{busy ? t('Connecting…') : t('Connect')}</Button>
      </Row>
    </>}
  </Section>
}
