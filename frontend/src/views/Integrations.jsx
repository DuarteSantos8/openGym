import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { fmtAgo } from '../lib/format.js'
import { copyText } from '../lib/clipboard.js'
import { platformNow } from '../lib/platform-now.js'
import { coachAvailable } from '../lib/coach.js'
import { healthStatus, loadHealth, onHealthChange, disableHealth, disableRead } from '../lib/health-sync.js'
import { directory, cardState, CARD, PILL, WORKS_WITH, WEBHOOK_EVENTS, webhookUrlProblem } from '../lib/integrations.js'
import { importFromApp, importFromHevy, confirmSheet, menuSheet } from '../sheets.jsx'
import { csvExportSheet } from '../components/CsvExportSheet.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Switch, Button, TextField } from '../components/ui.jsx'

/* Settings → Integrations (v1.4.4): one directory of what openGym can talk to, grouped, each card
   with what it is, whether it is on, and the one thing to do next. The cards are thin on purpose:
   Apple Health and Health Connect keep their switches on their own page, the imports and the CSV
   export open the sheets Data & backup has always opened, the Coach its own setup. Only the
   webhooks are new, and they live on the server (api/integrations). lib/integrations.js decides
   which card shows where; this file only draws them. */

export const MCP_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/mcp/README.md'
export const INTEGRATIONS_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/INTEGRATIONS.md'

const sheet = render => useUI.getState().openSheet(render)
const nameOf = card => (card.translate ? t(card.name) : card.name)
const ACTION = { connect: 'Connect', manage: 'Manage', import: 'Import', export: 'Export', open: 'Open' }

/** The server's integrations for this profile, or null where there is no server to ask. */
export function useServerIntegrations(on) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const load = useCallback(() => {
    if (!on) return Promise.resolve(null)
    return api('/api/integrations').then(d => { setData(d && Array.isArray(d.connections) ? d : { providers: [], connections: [] }); setError(false); return d })
      .catch(() => { setError(true); return null })
  }, [on])
  useEffect(() => { load() }, [load])
  return { data, error, load, setData }
}

function useHealth() {
  const [h, setH] = useState(null)
  useEffect(() => {
    if (!MOBILE) return
    let gone = false
    Promise.all([healthStatus(), loadHealth()]).then(([s, f]) => { if (!gone) setH({ ...f, status: s?.status, platform: s?.platform }) }).catch(() => {})
    const off = onHealthChange(f => { if (!gone) setH(prev => ({ ...(prev || {}), ...f })) })
    return () => { gone = true; off() }
  }, [])
  return h
}

function Pill({ status }) {
  if (!status) return null
  return <span className={'intg-pill ' + status}>{t(PILL[status])}</span>
}

function Card({ card, onOpen, onAction }) {
  const { status, action } = card.state
  const name = nameOf(card)
  return <div className="lrow intg-card" data-card={card.id}>
    <button className="intg-open" onClick={onOpen} aria-label={status ? name + ', ' + t(PILL[status]) : name}>
      <span className="lrow-i" style={{ '--tint': card.tint }}><Icon name={card.icon} /></span>
      <span className="lrow-m">
        <span className="lrow-t">{name}</span>
        <span className="lrow-s">{t(card.desc)}</span>
        <Pill status={status} />
      </span>
    </button>
    {action && <button className={'btn xs intg-act' + (action === 'connect' ? ' tinted' : ' plain')} onClick={onAction}
      aria-label={t(ACTION[action]) + ': ' + name}>{t(ACTION[action])}</button>}
  </div>
}

export default function IntegrationsPage({ android = false, ios = false }) {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachLocal = useStore(s => s.coachLocal)
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const offered = config?.integrations?.providers || []
  const server = useServerIntegrations(!!user && !DEMO && offered.length > 0)
  const health = useHealth()
  const platform = MOBILE ? (ios ? 'ios' : android ? 'android' : health?.platform || platformNow()) : null
  const ctx = {
    mobile: MOBILE, platform, user, demo: DEMO, admin: !!user?.admin, health, server: server.data, offered,
    coach: coachAvailable(config, user, { demo: DEMO }), coachMode: coachLocal?.mode === 'server' || coachLocal?.mode === 'byok' ? coachLocal.mode : null,
  }
  const dir = directory(ctx)

  const webhookCtx = { server, lan: !!config?.integrations?.lan, toast }
  const act = card => {
    const { action, status } = card.state
    switch (card.id) {
      case 'apple-health': case 'health-connect':
        if (status === 'device') return infoSheet(card, t('This one lives in the openGym phone app: Apple Health on iPhone, Health Connect on Android.'))
        return nav('/settings/' + card.id)
      case 'hevy': return importFromHevy()
      case 'files': return fileRef.current?.click()
      case 'csv': return csvExportSheet()
      case 'webhook':
        if (status === 'server') return infoSheet(card, t('Webhooks are sent by your own openGym server, so they need one. Connect this device to it in Account.'))
        if (action === 'open') return infoSheet(card, t('Webhooks are off on this server. Add INTEGRATIONS=webhook to its .env and restart it.'), INTEGRATIONS_DOCS)
        if (action === 'connect') return addWebhookSheet(webhookCtx)
        return webhookListSheet(webhookCtx)
      case 'coach': return nav(MOBILE ? '/coach/setup' : '/coach')
      case 'mcp':
        if (status === 'server') return infoSheet(card, t('The MCP server runs next to your own openGym server and reads your data there.'), MCP_DOCS)
        return window.open(MCP_DOCS, '_blank', 'noopener')
      default:
    }
  }
  const open = card => {
    // The health stores and the webhooks have more to say than a card holds.
    if (card.state.status === 'device' || card.state.status === 'server' || card.state.action === 'open' && card.id === 'webhook') return act(card)
    if (card.id === 'webhook') return card.state.action === 'connect' ? detailSheet(card, { act: () => act(card) }) : webhookListSheet(webhookCtx)
    if (card.id === 'apple-health' || card.id === 'health-connect') {
      return detailSheet(card, { act: () => act(card), health, onDisconnect: healthOn(health) ? () => disconnectHealth(card, toast) : null, retry: () => nav('/settings/' + card.id) })
    }
    detailSheet(card, { act: () => act(card) })
  }

  return <>
    <p className="sect-f intg-intro">{t('Only what you switch on talks to anything. The rest stays out of your way.')}</p>
    {server.error && <Section><Row icon="warning" iconTint="var(--orange)" title={t('Could not reach your server')} subtitle={t('Tap to try again')} onClick={() => server.load()} /></Section>}
    {dir.map(cat => <div key={cat.id}>
      <Section title={t(cat.title)}>
        {cat.cards.map(card => <Card key={card.id} card={card} onOpen={() => open(card)} onAction={() => act(card)} />)}
      </Section>
      {cat.id === 'health' && <WorksWith platform={platform} nav={nav} />}
    </div>)}
    <input ref={fileRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />
  </>
}

const healthOn = h => !!(h && (h.on || h.readHr || h.readWeight))

function disconnectHealth(card, toast) {
  const where = card.name
  menuSheet({
    title: t('Disconnect {0}?', where),
    subtitle: t('openGym stops writing and reading. What it already wrote can stay there as your data, or go.'),
    items: [
      { icon: 'check', label: t('Stop, keep what it wrote'), onClick: () => offAll(false, toast) },
      { icon: 'trash', label: t('Stop and remove what it wrote'), danger: true, onClick: () => offAll(true, toast) },
    ],
  })
}
async function offAll(removeWritten, toast) {
  try {
    await disableHealth({ removeWritten })
    await disableRead('hr')
    await disableRead('weight')
  } catch { toast?.(t('Something went wrong')) }
}

/* ---------------- "works with" ---------------- */

function WorksWith({ platform, nav }) {
  const store = platform === 'ios' ? 'Apple Health' : platform === 'android' ? 'Health Connect' : null
  return <Section title={t('Works with')} footer={store
    ? t('No extra connection needed: they write to {0}, and openGym reads from there.', store)
    : t('No extra connection needed: they write to Apple Health or Health Connect, and the openGym phone app reads from there.')}>
    <div className="intg-chips">
      {WORKS_WITH.map(w => <button key={w.name} className="btn xs intg-chip" onClick={() => worksWithSheet(w, platform, nav)}>
        <Icon name={w.glyph} />{w.name}
      </button>)}
    </div>
  </Section>
}

const READS = {
  hr: 'Heart rate during your workouts',
  weight: 'Your weigh-ins',
  both: 'Heart rate during your workouts, and your weigh-ins',
}

function worksWithSheet(w, platform, nav) {
  const store = platform === 'ios' ? 'apple-health' : platform === 'android' ? 'health-connect' : null
  sheet(close => <>
    <h3 className="intg-h"><Icon name={w.glyph} /> {w.name}</h3>
    <div className="muted small intg-lead">{t('{0} has no direct line to openGym, and it does not need one.', w.name)}</div>
    <Section>
      <Row icon="heart" iconTint="var(--red)" title={t('How it gets here')}
        subtitle={t('{0} saves to Apple Health on iPhone or Health Connect on Android. openGym reads from there.', w.name)} />
      <Row icon="check" iconTint="var(--green)" title={t('What openGym reads')} subtitle={t(READS[w.reads])} />
      <Row icon="info" iconTint="var(--grey)" title={t('What it does not do')} subtitle={t('Workouts logged in openGym go to the health store, not back into {0} itself.', w.name)} />
    </Section>
    {store
      ? <Button variant="primary" onClick={() => { close(); nav('/settings/' + store) }}>{t('Set up {0}', CARD[store].name)}</Button>
      : <div className="dim small intg-note">{t('Install the openGym app on your phone to use this.')}</div>}
  </>)
}

/* ---------------- detail and info sheets ---------------- */

function infoSheet(card, message, link) {
  sheet(close => <>
    <h3 className="intg-h"><Icon name={card.icon} /> {nameOf(card)}</h3>
    <div className="muted small intg-lead">{message}</div>
    {link && <Button variant="tinted" onClick={() => window.open(link, '_blank', 'noopener')}>{t('How to set it up')}</Button>}
    <div style={{ height: 8 }} />
    <Button variant="plain" onClick={close}>{t('Done')}</Button>
  </>)
}

function detailSheet(card, { act, health, onDisconnect, retry }) {
  const st = card.state
  sheet(close => {
    const go = f => () => { close(); f?.() }
    const trouble = st.status === 'attention'
    return <>
      <h3 className="intg-h"><Icon name={card.icon} /> {nameOf(card)}</h3>
      <div className="intg-sheet-pill"><Pill status={st.status} /></div>
      <Section title={t('What it does')}>
        {card.syncs.map(line => <Row key={line} icon="check" iconTint="var(--green)" title={<span className="intg-line">{t(line)}</span>} />)}
      </Section>
      {health && <Section>
        <Row icon="clock" iconTint="var(--blue)" title={t('Last sync')} value={health.at ? fmtAgo(health.at) : t('Not yet')} />
        {trouble && <Row icon="warning" iconTint="var(--orange)" title={t('Permission withdrawn')} subtitle={t('openGym can no longer reach it.')}>
          <button className="btn xs tinted" onClick={go(retry)}>{t('Retry')}</button>
        </Row>}
      </Section>}
      {st.action && <Button variant="primary" onClick={go(act)}>{t(ACTION[st.action])}</Button>}
      {onDisconnect && <><div style={{ height: 8 }} /><Button variant="danger" onClick={go(onDisconnect)}>{t('Disconnect')}</Button></>}
      <div style={{ height: 8 }} />
    </>
  })
}

/* ---------------- webhooks ---------------- */

const statusOf = c => (c.status === 'attention' ? 'attention' : c.paused ? 'off' : 'connected')
const errText = (e, fallback) => (e && e.message && !/^HTTP \d+$/.test(e.message) ? e.message : fallback)

function webhookListSheet(ctx) {
  sheet(close => <WebhookList close={close} {...ctx} />)
}

function WebhookList({ close, server, lan, toast }) {
  const [data, setData] = useState(server.data)
  const reload = () => server.load().then(d => { if (d) setData(d) })
  const list = (data?.connections || []).filter(c => c.provider === 'webhook')
  const max = (data?.providers || []).find(p => p.id === 'webhook')?.max || 10
  return <>
    <h3 className="intg-h"><Icon name="webhook" /> {t('Webhooks')}</h3>
    <div className="muted small intg-lead">{t('Your server sends a signed message to each of these when something happens.')}</div>
    {list.length > 0 && <Section>
      {list.map(c => <Row key={c.id} icon="webhook" iconTint="var(--indigo)" title={c.label}
        subtitle={<><span className="intg-url">{c.info?.url}</span><Pill status={statusOf(c)} /></>} accessory="chevron"
        onClick={() => { close(); webhookSheet(c, { server, lan, toast }) }} />)}
    </Section>}
    {list.length < max && <Button variant={list.length ? 'tinted' : 'primary'} icon="plus" onClick={() => { close(); addWebhookSheet({ server, lan, toast }) }}>{t('Add a webhook')}</Button>}
    <div style={{ height: 8 }} />
    <Button variant="plain" onClick={() => window.open(INTEGRATIONS_DOCS, '_blank', 'noopener')}>{t('What gets sent')}</Button>
    {/* refresh hook for the tests and for a sheet that outlives a change */}
    <span hidden data-reload onClick={reload} />
  </>
}

export function addWebhookSheet(ctx) {
  sheet(close => <AddWebhook close={close} {...ctx} />)
}

function EventSwitches({ events, onToggle, disabled }) {
  return WEBHOOK_EVENTS.map(ev => <Row key={ev.id} icon={ev.id === 'workout.pr' ? 'trophy' : ev.id === 'weighin.logged' ? 'scale' : 'flag'}
    iconTint={ev.id === 'workout.pr' ? 'var(--orange)' : ev.id === 'weighin.logged' ? 'var(--teal)' : 'var(--green)'} title={t(ev.label)}>
    <Switch aria-label={t(ev.label)} checked={events.includes(ev.id)} disabled={disabled} onChange={v => onToggle(ev.id, v)} />
  </Row>)
}

function AddWebhook({ close, server, lan, toast }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [events, setEvents] = useState(['workout.finished'])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [secret, setSecret] = useState(null)
  const toggle = (id, v) => setEvents(cur => (v ? [...new Set([...cur, id])] : cur.filter(x => x !== id)))
  const add = async () => {
    const p = webhookUrlProblem(url, { lan })
    if (p) { setProblem(t(p)); return }
    if (!events.length) { setProblem(t('Pick at least one thing to send.')); return }
    setBusy(true); setProblem(null)
    try {
      const r = await api('/api/integrations/connect', { method: 'POST', body: JSON.stringify({ provider: 'webhook', url: url.trim(), label: label.trim(), events }) })
      setSecret(r?.reveal?.secret || '')
      server.load()
    } catch (e) {
      setProblem(e?.code === 'url' || e?.status === 400 ? t('Your server said no to that URL: {0}', errText(e, t('it is not one it calls.'))) : errText(e, t('Something went wrong')))
    }
    setBusy(false)
  }
  if (secret != null) return <>
    <h3 className="intg-h"><Icon name="checkCircle" /> {t('Webhook added')}</h3>
    <div className="muted small intg-lead">{t('This is its signing secret. You will see it only now, so paste it into your tool if it checks signatures.')}</div>
    <div className="intg-secret" aria-label={t('Signing secret')}>{secret}</div>
    <Button variant="tinted" icon="copy" onClick={async () => { if (await copyText(secret)) toast?.(t('Copied')) }}>{t('Copy secret')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
  return <>
    <h3 className="intg-h"><Icon name="webhook" /> {t('Add a webhook')}</h3>
    <div className="muted small intg-lead">{lan
      ? t('Paste the URL from Home Assistant, n8n, ntfy or similar. Your home network works too.')
      : t('Paste the HTTPS URL from Home Assistant, n8n, ntfy or similar.')}</div>
    <TextField placeholder="https://…" value={url} onChange={e => { setUrl(e.target.value); setProblem(null) }} inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
      aria-label={t('Webhook URL')} maxLength={2048} />
    <div style={{ height: 10 }} />
    <TextField placeholder={t('Name (optional)')} value={label} onChange={e => setLabel(e.target.value)} maxLength={60} aria-label={t('Name')} />
    {problem && <div className="intg-problem" role="alert">{problem}</div>}
    <div style={{ height: 14 }} />
    <Section title={t('Send when')}>
      <EventSwitches events={events} onToggle={toggle} disabled={busy} />
    </Section>
    <Button variant="primary" disabled={busy} onClick={add}>{busy ? t('Adding…') : t('Add webhook')}</Button>
    <div style={{ height: 8 }} />
  </>
}

export function webhookSheet(conn, ctx) {
  sheet(close => <WebhookDetail close={close} conn={conn} {...ctx} />)
}

function WebhookDetail({ close, conn: initial, server, toast }) {
  const [c, setC] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState(null)
  const call = async (path, body, after) => {
    setBusy(true)
    try {
      const r = await api(path, { method: 'POST', body: JSON.stringify({ id: c.id, ...body }) })
      if (r?.connection) setC(r.connection)
      after?.(r)
      server.load()
      if (log) loadLog()
    } catch (e) { toast?.(errText(e, t('Something went wrong'))) }
    setBusy(false)
  }
  const loadLog = () => api('/api/integrations/log?id=' + encodeURIComponent(c.id)).then(r => setLog(r?.log || [])).catch(() => setLog([]))
  const toggle = (id, v) => {
    const next = v ? [...new Set([...c.events, id])] : c.events.filter(x => x !== id)
    if (!next.length) { toast?.(t('Pick at least one thing to send.')); return }
    call('/api/integrations/update', { events: next })
  }
  const test = () => call('/api/integrations/test', {}, r => toast?.(r?.ok ? t('Test event delivered') : t('Test failed: {0}', r?.msg || '')))
  const retry = () => call('/api/integrations/retry', {}, r => toast?.(r?.requeued ? t('Sending again') : t('Nothing waiting to send')))
  const disconnect = () => confirmSheet({
    title: t('Disconnect this webhook?'),
    message: t('Your server forgets the URL and its secret, and stops sending. Nothing changes on the other side.'),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => call('/api/integrations/disconnect', {}, () => { close(); toast?.(t('Webhook removed')) }),
  })
  const trouble = c.status === 'attention'
  return <>
    <h3 className="intg-h"><Icon name="webhook" /> {c.label}</h3>
    <div className="intg-url intg-lead">{c.info?.url}</div>
    <div className="intg-sheet-pill"><Pill status={statusOf(c)} /></div>
    <Section title={t('Send when')}>
      <EventSwitches events={c.events} onToggle={toggle} disabled={busy} />
    </Section>
    <Section>
      <Row icon="play" iconTint="var(--green)" title={t('Sending')} subtitle={c.paused ? t('Paused. Nothing is sent until you switch it back on.') : null}>
        <Switch aria-label={t('Sending')} checked={!c.paused} disabled={busy} onChange={v => call('/api/integrations/update', { paused: !v })} />
      </Row>
      <Row icon="clock" iconTint="var(--blue)" title={t('Last sync')} value={c.lastOk ? fmtAgo(c.lastOk) : t('Not yet')} />
      {c.lastError && <Row icon="warning" iconTint={trouble ? 'var(--orange)' : 'var(--grey)'} title={<span className="intg-line">{c.lastError.msg}</span>}
        subtitle={c.lastError.at ? fmtAgo(c.lastError.at) : null}>
        {(trouble || c.failed > 0) && <button className="btn xs tinted" disabled={busy} onClick={retry}>{t('Retry')}</button>}
      </Row>}
    </Section>
    <Button variant="tinted" icon="bolt" disabled={busy} onClick={test}>{t('Send test event')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="plain" onClick={() => (log ? setLog(null) : loadLog())}>{log ? t('Hide activity') : t('Show activity')}</Button>
    {log && <Section title={t('Activity')}>
      {log.length ? log.slice(0, 50).map((e, i) => <Row key={i} icon={e.ok ? 'checkCircle' : 'warning'} iconTint={e.ok ? 'var(--green)' : 'var(--orange)'}
        title={<span className="intg-line">{eventName(e.ev)}{e.status ? ' · ' + e.status : ''}</span>} subtitle={[fmtAgo(e.at), e.msg].filter(Boolean).join(' · ')} />)
        : <Row title={<span className="intg-line">{t('Nothing yet')}</span>} />}
    </Section>}
    <div style={{ height: 8 }} />
    <Button variant="danger" disabled={busy} onClick={disconnect}>{t('Disconnect')}</Button>
    <div style={{ height: 8 }} />
  </>
}

function eventName(ev) {
  const known = WEBHOOK_EVENTS.find(e => e.id === ev)
  if (known) return t(known.label)
  if (ev === 'test') return t('Test event')
  if (ev === 'connected') return t('Added')
  return ev
}

// For the Settings search and tests: the card's state here, without drawing the page.
export { cardState }
