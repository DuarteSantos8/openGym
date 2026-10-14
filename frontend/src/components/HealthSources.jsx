import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtAgo } from '../lib/format.js'
import { PROVIDERS } from '../lib/health/providers.js'
import { GROUPS, HEALTH_METRICS } from '../lib/health/metrics.js'
import { countSource } from '../lib/health/records.js'
import { connectSource, disconnectSource, loadSources, onSourcesChange, removeSourceData, syncSource } from '../lib/health/sync.js'
import { Row, Section, Switch } from './ui.jsx'
import { confirmSheet, menuSheet } from '../sheets.jsx'

const getState = () => useStore.getState().S
const update = fn => useStore.getState().update(fn)
const toast = m => useUI.getState().toast(m)

// Settings → Health: one card per source this device can read from (Apple Health on the iPhone
// app). Each source is off until the user connects it here; the permissions it asks for are the
// types it lists, read-only.
export default function HealthSources() {
  const [avail, setAvail] = useState([])
  const [file, setFile] = useState(null)
  useEffect(() => {
    let gone = false
    Promise.all(PROVIDERS.map(p => p.isAvailable().then(ok => (ok ? p : null), () => null)))
      .then(ps => { if (!gone) setAvail(ps.filter(Boolean)) })
    loadSources().then(f => { if (!gone) setFile(f) }, () => {})
    const off = onSourcesChange(f => { if (!gone) setFile(f) })
    return () => { gone = true; off() }
  }, [])
  if (!file || !avail.length) return null
  return avail.map(p => <SourceCard key={p.id} provider={p} st={file.providers[p.id] || {}} />)
}

function SourceCard({ provider, st }) {
  const S = useStore(s => s.S)
  const [busy, setBusy] = useState(false)
  const name = t(provider.label)
  const types = provider.getAvailableDataTypes()
  const imported = countSource(S.health, provider.id)

  const report = r => {
    if (r.ok) toast(r.added || r.updated ? t('{0}: {1} new readings', name, r.added + r.updated) : t('{0}: up to date', name))
    else toast(r.error === 'unavailable' ? t('{0} is not available on this device', name) : t('Could not read from {0}', name))
  }
  const run = fn => async () => {
    setBusy(true)
    try { await fn() } catch { toast(t('Could not read from {0}', name)) }
    setBusy(false)
  }
  const connect = run(async () => report(await connectSource(provider.id, getState, update, types)))
  const syncNow = run(async () => report(await syncSource(provider.id, getState, update)))
  // The system shows its sheet again only for types never asked about; for the rest it is the
  // Health app's own screen (manageHint), which the row's subtitle names.
  const manage = run(async () => { await provider.requestPermissions(types); report(await syncSource(provider.id, getState, update)) })
  // Before anything is asked of the system: what will be read, and that nothing is written.
  const askConnect = () => confirmSheet({
    title: t('Connect {0}?', name),
    message: t('openGym will ask to read: {0}. It writes nothing, and the data stays in your profile on your own server.',
      // By group: a hundred-odd types one by one would be a wall; the system's own sheet lists each.
      [...new Set(types.map(k => HEALTH_METRICS[k]?.group).filter(Boolean))].map(g => t(GROUPS[g].label)).join(', ')),
    confirmText: t('Continue'),
    onConfirm: connect,
  })
  const askOff = () => menuSheet({
    title: t('Disconnect {0}?', name),
    subtitle: t('Readings already imported can stay as your data, or be removed from openGym.'),
    items: [
      { icon: 'check', label: t('Disconnect, keep imported data'), onClick: run(() => disconnectSource(provider.id)) },
      { icon: 'trash', label: t('Disconnect and remove imported data'), danger: true, onClick: run(async () => {
        await disconnectSource(provider.id)
        update(s => removeSourceData(s, provider.id))
      }) },
    ],
  })

  return <Section title={name} footer={st.on ? t(provider.manageHint) : t('Read-only. Nothing is shared until you connect.')}>
    <Row icon="heart" iconTint="var(--red)" title={t('Read from {0}', name)}
      subtitle={st.on ? (st.at ? t('Last read {0}', fmtAgo(st.at)) : t('Connected')) : t('Body composition, activity, heart and sleep')}>
      <Switch checked={!!st.on} disabled={busy} onChange={v => (v ? askConnect() : askOff())} />
    </Row>
    {st.on && st.error && <Row icon="warning" iconTint="var(--orange)" title={t('Could not read from {0}', name)}
      subtitle={t('Tap to try again')} accessory="chevron" onClick={syncNow} />}
    {st.on && <Row icon="repeat" iconTint="var(--blue)" title={t('Read now')} accessory="chevron" onClick={busy ? undefined : syncNow} />}
    {st.on && <Row icon="key" iconTint="var(--grey)" title={t('Manage permissions')} subtitle={t(provider.manageHint)}
      accessory="chevron" onClick={busy ? undefined : manage} />}
    {!st.on && imported > 0 && <Row icon="trash" iconTint="var(--red)" danger title={t('Remove imported data')}
      subtitle={t('{0} readings', imported)} onClick={() => confirmSheet({
        title: t('Remove imported data?'),
        message: t('Removes the {0} readings imported from {1}. Your own entries stay.', imported, name),
        confirmText: t('Remove'), danger: true,
        onConfirm: () => update(s => removeSourceData(s, provider.id)),
      })} />}
  </Section>
}
