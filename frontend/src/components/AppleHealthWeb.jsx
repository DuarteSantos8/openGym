import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { appBase } from '../lib/app-base.js'
import { fmtAgo, fmtDate } from '../lib/format.js'
import { copyText } from '../lib/clipboard.js'
import { HEALTH_METRICS } from '../lib/health/metrics.js'
import { normalizeHealthState } from '../lib/health/records.js'
import { applyReadings } from '../lib/health/sync.js'
import { readAppleHealthExport } from '../lib/health/apple-export.js'
import { Button, Row, Section } from './ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)
const openSheet = r => useUI.getState().openSheet(r)

// Settings → Health on the web app and the PWA, where no website may read Apple Health: Health's
// own export, read here (lib/health/apple-export.js), and an iPhone Shortcut that sends the
// readings to this server every day (POST /api/health/samples, api/health/fold.js).
export default function AppleHealthWeb() {
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const [key, setKey] = useState(null)
  const refreshKey = () => api('/api/health/key').then(setKey, () => setKey(null))
  useEffect(() => { if (user) refreshKey() }, [user?.id])

  const pick = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) openSheet(close => <ExportImport file={file} close={close} />)
  }

  return <Section title={t('Apple Health')}
    footer={t('A website cannot read Apple Health. Bring it in with the Health app’s export, or let a Shortcut send it every day.')}>
    <Row icon="download" iconTint="var(--teal)" title={t('Import a Health export')}
      subtitle={t('export.zip from the Health app: your profile → Export All Health Data')} accessory="chevron"
      onClick={() => fileRef.current?.click()} />
    {user && <Row icon="repeat" iconTint="var(--red)" title={t('Sync with a Shortcut')}
      subtitle={key?.exists ? (key.used ? t('Last sent {0}', fmtAgo(key.used)) : t('Key ready, nothing sent yet')) : t('Every day, by itself: a Shortcut or Health Auto Export')}
      accessory="chevron" onClick={() => openSheet(close => <ShortcutSetup close={close} onChange={refreshKey} />)} />}
    <input ref={fileRef} type="file" accept=".zip,.xml,application/zip,text/xml" style={{ display: 'none' }} onChange={pick} />
  </Section>
}

/* ---------- the export ---------- */

const ERRORS = {
  'no-export': () => t('There is no Apple Health export in that file.'),
  zip64: () => t('That export is too big to read packed. Unzip it and pick the export.xml inside.'),
  unsupported: () => t('This browser cannot unpack the export. Unzip it and pick the export.xml inside.'),
}

function ExportImport({ file, close }) {
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let gone = false
    readAppleHealthExport(file, { onProgress: f => { if (!gone) setProgress(f) } })
      .then(r => { if (!gone) setResult(r) }, e => { if (!gone) setError((ERRORS[e?.message] || (() => t('Could not read that file')))()) })
    return () => { gone = true }
  }, [file])

  const counts = {}
  let from = '', to = ''
  for (const r of result?.readings || []) {
    counts[r.type] = (counts[r.type] || 0) + 1
    if (!from || r.d < from) from = r.d
    if (!to || r.d > to) to = r.d
  }
  const doImport = () => {
    let n = { added: 0, updated: 0 }
    useStore.getState().update(s => { n = applyReadings(s, result.readings); normalizeHealthState(s) })
    close()
    toast(n.added || n.updated ? t('{0}: {1} new readings', t('Apple Health'), n.added + n.updated) : t('{0}: up to date', t('Apple Health')))
  }

  return <>
    <h3>{t('Import a Health export')}</h3>
    {error ? <div className="muted small">{error}</div>
      : !result ? <>
        <div className="muted small" style={{ marginBottom: 10 }}>{t('Reading {0}…', file.name)}</div>
        <div className="bar" style={{ height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--surface-2)' }}>
          <i style={{ display: 'block', height: '100%', width: Math.round(progress * 100) + '%', background: 'var(--acc)' }} />
        </div>
        <div className="small dim" style={{ marginTop: 6 }}>{Math.round(progress * 100)}%</div>
      </> : !result.readings.length ? <div className="muted small">{t('Nothing to import from that file')}</div> : <>
        <div className="muted small" style={{ marginBottom: 10 }}>{t('{0} to {1}', fmtDate(from, true), fmtDate(to, true))}</div>
        {Object.entries(counts).map(([type, n]) => <div className="mrow" key={type}>
          <span className="nm">{t(HEALTH_METRICS[type]?.label || type)}</span><span className="v">{n}</span>
        </div>)}
        <div style={{ height: 14 }} />
        <Button variant="primary" onClick={doImport}>{t('Import')}</Button>
      </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ---------- the Shortcut ---------- */

function ShortcutSetup({ close, onChange }) {
  const [state, setState] = useState(null)
  const [key, setKey] = useState(null)        // the key itself, only right after it was made
  const [busy, setBusy] = useState(false)
  const load = () => api('/api/health/key').then(setState, () => setState({ exists: false }))
  useEffect(() => { load() }, [])
  const endpoint = location.origin + appBase() + 'api/health/samples'

  const make = async () => {
    setBusy(true)
    try { const r = await api('/api/health/key', { method: 'POST', body: '{}' }); setKey(r.key); await load(); onChange?.() }
    catch { toast(t('Could not make a key')) }
    setBusy(false)
  }
  const askNew = () => confirmSheet({
    title: t('Make a new key?'), message: t('The Shortcut stops working until you paste the new key into it.'),
    confirmText: t('New key'), onConfirm: make,
  })
  const revoke = () => confirmSheet({
    title: t('Revoke the key?'), message: t('The Shortcut can no longer send anything. Readings already sent stay.'),
    confirmText: t('Revoke'), danger: true,
    onConfirm: async () => { try { await api('/api/health/key', { method: 'DELETE' }); setKey(null); await load(); onChange?.() } catch { toast(t('Could not revoke the key')) } },
  })
  const copy = async text => toast(await copyText(text) ? t('Copied') : t('Could not copy'))

  return <>
    <h3>{t('Sync with a Shortcut')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('The Shortcuts app on your iPhone can read Apple Health and send it here. Set it to run every day and your readings arrive by themselves.')}</div>

    {key && <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{t('Your key, shown only now')}</div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, wordBreak: 'break-all', userSelect: 'all' }}>{key}</div>
      <div style={{ height: 8 }} /><Button size="sm" icon="copy" onClick={() => copy(key)}>{t('Copy key')}</Button>
    </div>}
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{t('Address')}</div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, wordBreak: 'break-all', userSelect: 'all' }}>{endpoint}</div>
      <div style={{ height: 8 }} /><Button size="sm" icon="copy" onClick={() => copy(endpoint)}>{t('Copy address')}</Button>
    </div>

    {!state ? null : state.exists
      ? <div className="small dim" style={{ marginBottom: 10 }}>{t('Key made {0}', fmtAgo(state.created))}{state.used ? ' · ' + t('Last sent {0}', fmtAgo(state.used)) : ''}</div>
      : null}
    {state && (state.exists
      ? <div className="row" style={{ gap: 8 }}>
        <Button size="sm" onClick={askNew} disabled={busy}>{t('New key')}</Button>
        <Button size="sm" className="dim" style={{ color: 'var(--red)' }} onClick={revoke} disabled={busy}>{t('Revoke')}</Button>
      </div>
      : <Button variant="primary" onClick={make} disabled={busy}>{t('Make a key')}</Button>)}

    {/* A ready-made Shortcut this instance shares (HEALTH_SHORTCUT_URL): installed with a tap,
        it asks for the address and the key above. Building one by hand stays below. */}
    {state?.shortcut && <div className="card" style={{ background: 'var(--surface-2)', marginTop: 14 }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{t('Ready-made Shortcut')}</div>
      <div className="small muted" style={{ marginBottom: 10 }}>{t('Install it, then paste the address and the key when it asks. The key shows only when it is made: without it, make a new one.')}</div>
      <Button variant="primary" icon="download" onClick={() => window.open(state.shortcut, '_blank', 'noopener')}>{t('Install the Shortcut')}</Button>
    </div>}

    <h4 className="sec" style={{ marginTop: 18 }}>{t('How to set up the Shortcut')}</h4>
    <ol className="small" style={{ paddingInlineStart: 20, lineHeight: 1.5, margin: '6px 0 0' }}>
      <li>{t('In Shortcuts, make a new shortcut and add “Find Health Samples” for each thing to send, from the last 7 days: Weight, Body Fat Percentage, Lean Body Mass, Body Mass Index, Height, Resting Heart Rate and Sleep; Steps, Walking + Running Distance, Active Energy and Resting Energy with Group By: Day; Heart Rate with Group By: Hour.')}</li>
      <li>{t('Add “Get Contents of URL” with the address above, method POST, a header Authorization with the value Bearer followed by a space and your key, and a JSON body.')}</li>
      <li>{t('In the body, add a dictionary “metrics”; in it one dictionary per thing (weight, bodyFat, leanMass, bmi, height, steps, distance, activeEnergy, restingEnergy, heartRate, restingHeartRate) with “values” = the samples’ Value, “dates” = their Start Date in ISO 8601 and “unit” = their Unit.')}</li>
      <li>{t('For sleep, a dictionary “sleep” with “starts” = Start Date, “ends” = End Date (both ISO 8601) and “values” = Value.')}</li>
      <li>{t('In Automation, add a daily one at a time you like that runs the shortcut without asking.')}</li>
    </ol>

    {/* The same address and key take what the Health Auto Export app posts (api/health/fold.js). */}
    <h4 className="sec" style={{ marginTop: 18 }}>{t('Or with Health Auto Export')}</h4>
    <div className="small muted" style={{ marginTop: 6 }}>{t('Health Auto Export, an app on the App Store, sends the same readings by itself, without building a Shortcut. It uses the address and key above.')}</div>
    <ol className="small" style={{ paddingInlineStart: 20, lineHeight: 1.5, margin: '6px 0 0' }}>
      <li>{t('In Health Auto Export, open Automations, add a new one of type REST API and paste the address above as its URL.')}</li>
      <li>{t('Under Headers, add Authorization with the value Bearer followed by a space and your key.')}</li>
      <li>{t('Export Format JSON, Data Type Health Metrics, then choose what to send: Weight & Body Mass, Body Fat Percentage, Lean Body Mass, Body Mass Index, Height, Step Count, Walking + Running Distance, Active Energy, Basal Energy Burned, Heart Rate, Resting Heart Rate, Sleep Analysis.')}</li>
      <li>{t('Date Range Previous 7 Days, Summarize Data on with Time Grouping by days, and a daily Sync Cadence.')}</li>
    </ol>
    <div className="small dim" style={{ marginTop: 8 }}>{t('Sending the same days twice adds nothing. Readings you delete here are not sent back.')}</div>
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
