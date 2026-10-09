// Strava: upload finished workouts as activities (api/strava.js). Upload only — nothing comes
// back from Strava. Both pieces stay invisible unless the server has Strava configured.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, appBase } from '../lib/api.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { Section, Row, Switch, Button } from './ui.jsx'

// One status request per page load, shared by the Settings card and every workout sheet.
let statusP = null
const loadStatus = (fresh = false) => {
  if (fresh || !statusP) statusP = Promise.resolve().then(() => api('/api/strava/status')).then(s => s || { configured: false }, () => ({ configured: false }))
  return statusP
}

function useStravaStatus(enabled) {
  const [st, setSt] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let gone = false
    loadStatus().then(s => { if (!gone) setSt(s) })
    return () => { gone = true }
  }, [enabled])
  const refresh = () => loadStatus(true).then(setSt)
  return [st, refresh]
}

const RETURN_TOAST = {
  connected: 'Strava connected — new workouts upload automatically',
  denied: 'Strava connection cancelled',
  scope: 'Strava needs permission to upload activities — tick the box and try again',
  off: 'Strava is not set up on this server',
  error: 'Could not connect Strava — try again',
}

export function StravaCard() {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const [st, refresh] = useStravaStatus(!!user && !MOBILE)
  const [busy, setBusy] = useState(false)

  // Back from Strava's consent screen: #/settings?strava=<outcome>. Read off the hash once on
  // mount rather than through the router, which the Settings tests stub down to useNavigate.
  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash || ''
    const q = new URLSearchParams(hash.split('?')[1] || '').get('strava')
    if (!q) return
    if (RETURN_TOAST[q]) toast(t(RETURN_TOAST[q]))
    refresh()
    nav('/settings', { replace: true })
  }, [])

  if (!user || MOBILE || !st?.configured) return null

  const connect = () => { window.location.href = appBase().replace(/\/$/, '') + '/api/strava/connect' }
  const setAuto = async v => {
    setBusy(true)
    try { await api('/api/strava/settings', { method: 'POST', body: JSON.stringify({ auto: v }) }); await refresh() }
    catch (e) { toast(e.message || t('Could not save')) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await api('/api/strava/disconnect', { method: 'POST', body: '{}' }); await refresh(); toast(t('Strava disconnected')) }
    catch (e) { toast(e.message || t('Could not disconnect')) }
    setBusy(false)
  }

  if (!st.connected) return <Section title="Strava" footer={t('Finished workouts are posted to Strava as Weight Training activities. Nothing is read from Strava.')}>
    <Row icon="upload" iconTint="var(--orange)" title={t('Connect Strava')} accessory="chevron" onClick={connect} />
  </Section>

  return <Section title="Strava"
    footer={st.needsReconnect
      ? t('Strava stopped accepting this connection. Reconnect to resume uploads.')
      : t('{0} workouts uploaded. Disconnecting only forgets the connection here; it does not touch other apps on your Strava account.', st.uploads || 0)}>
    <Row icon="personCircle" iconTint="var(--orange)" title={st.athlete?.name || t('Connected')} subtitle={t('Strava account')} />
    {st.needsReconnect && <Row icon="warning" iconTint="var(--red)" title={t('Reconnect Strava')} accessory="chevron" onClick={connect} />}
    <Row icon="upload" iconTint="var(--orange)" title={t('Upload new workouts automatically')}>
      <Switch checked={!!st.auto} disabled={busy} onChange={setAuto} />
    </Row>
    <Row icon="signOut" iconTint="var(--grey)" title={t('Disconnect Strava')} onClick={busy ? undefined : disconnect} danger />
  </Section>
}

export function StravaUploadButton({ w }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [st] = useStravaStatus(!!user && !!w?.id)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  if (!st?.connected) return null
  const upload = async () => {
    setBusy(true)
    try {
      const r = await api('/api/strava/upload', { method: 'POST', body: JSON.stringify({ id: w.id }), timeout: 30000 })
      setSent(true)
      toast(r.already ? t('Already on Strava') : t('Uploaded to Strava'))
    } catch (e) { toast(e.message || t('Upload failed')) }
    setBusy(false)
  }
  return <>
    <Button icon="upload" disabled={busy || sent} onClick={upload}>{sent ? t('On Strava') : busy ? t('Uploading…') : t('Upload to Strava')}</Button>
    <div style={{ height: 8 }} />
  </>
}
