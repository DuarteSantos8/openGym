import { offlineBuild } from '../lib/build-caps.js'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { api, appBase } from '../lib/api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { fmtAgo } from '../lib/format.js'
import { copyText } from '../lib/clipboard.js'
import { platformNow } from '../lib/platform-now.js'
import { coachAvailable } from '../lib/coach.js'
import { healthStatus, loadHealth, onHealthChange, disableHealth, disableRead } from '../lib/health-sync.js'
import { directory, cardState, CARD, PILL, WORKS_WITH, WEBHOOK_EVENTS, webhookUrlProblem, normalizeWebhookUrl } from '../lib/integrations.js'
import { importFromApp, importFromHevy, confirmSheet, menuSheet } from '../sheets.jsx'
import { csvExportSheet } from '../components/CsvExportSheet.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { Section, Row, Switch, Button, TextField } from '../components/ui.jsx'
import { isOn } from '../lib/modules.js'
import { tokensOn } from '../lib/api-tokens.js'
import { useWebdavConfig, webdavSheet, restoreFromFolder } from '../components/WebDavBackup.jsx'
import { calendarSheet } from '../components/CalendarFeed.jsx'
import { useNutritionLink, nutritionSheet } from '../components/SisterApps.jsx'
import BackupFolderRow, { useBackupFolder } from '../components/BackupFolderRow.jsx'
import { getCalendar } from '../lib/api-tokens.js'

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

/* A sheet's header: the glyph and the name, with the state beside it on the same line rather than
   on a line of its own (Integrations pass, I4). The pill stays out of the h3, so a screen reader
   hears the heading as the name. */
function SheetHead({ icon, title, status }) {
  return <div className="intg-head">
    <h3 className="intg-h"><Icon name={icon} /><span>{title}</span></h3>
    <Pill status={status} />
  </div>
}

/* The sheets' quiet actions as one grouped list of rows with a bare glyph in the accent ink, the way
   the routine editor groups Copy / Share / Print (P4), instead of a tinted block and a text link. */
function ActRow({ icon, label, onClick, disabled }) {
  return <button type="button" className="lrow tap" onClick={onClick} disabled={disabled}>
    <Icon name={icon} className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{label}</span></span>
  </button>
}

/* The destructive action: last, in a group of its own, a red row (P4, P6). It still asks. */
function DangerRow({ label, onClick, disabled }) {
  return <div className="sect-b intg-end">
    <button type="button" className="lrow tap danger" onClick={onClick} disabled={disabled}>
      <Icon name="trash" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{label}</span></span>
    </button>
  </div>
}

function Card({ card, onOpen, onAction }) {
  const { status, action } = card.state
  const name = nameOf(card)
  return <div className="lrow intg-card" data-card={card.id}>
    <button className="intg-open" onClick={onOpen} aria-label={status ? name + ', ' + t(PILL[status]) : name}>
      <span className="lrow-i" style={{ '--tint': card.tint }}><Icon name={card.icon} /></span>
      <span className="lrow-m">
        <span className="lrow-t">{name}</span>
        <span className="lrow-s">{card.state.detail || t(card.desc)}</span>
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
  const S = useStore(s => s.S)
  const webdav = useWebdavConfig()
  const nutrition = useNutritionLink()
  const [backupFolder] = useBackupFolder(platform === 'ios')
  const tokens = tokensOn(config, user, DEMO) && isOn(S, 'integrations')
  // The calendar feed's state, asked once per visit where the server has tokens.
  const [calendar, setCalendarState] = useState(null)
  useEffect(() => { if (tokens) getCalendar().then(setCalendarState).catch(() => {}) }, [tokens])
  const ctx = {
    offline: offlineBuild(), webdav, tokens, calendar, nutrition, backupFolder, autoBackup: !!S.autoBackup,
    mobile: MOBILE, platform, user, demo: DEMO, admin: !!user?.admin, health, server: server.data, offered,
    mod: id => isOn(S, id),
    coach: coachAvailable(config, user, { demo: DEMO }), coachMode: coachLocal?.mode === 'server' || coachLocal?.mode === 'byok' ? coachLocal.mode : null,
  }
  const dir = directory(ctx)

  const webhookCtx = { server, lan: !!config?.integrations?.lan, toast }
  // Back from Strava's sign-in (api/integrations/routes.js): ?intg=strava&connected=1 or &error=…
  const loc = useLocation()
  useEffect(() => {
    const q = new URLSearchParams(loc.search)
    if (q.get('intg') !== 'strava') return
    toast(q.get('connected') ? t('Strava connected. Your next workout goes up by itself.') : t(STRAVA_ERRORS[q.get('error')] || 'Strava could not be connected. Try again.'))
    server.load()
    nav(loc.pathname, { replace: true })
  }, [loc.search])
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
      case 'strava':
        if (status === 'server') return infoSheet(card, t('Strava uploads come from your own openGym server, so they need one. Connect this device to it in Account.'))
        if (action === 'open') return infoSheet(card, t('Strava is off on this server. Register a Strava API app, then add strava to INTEGRATIONS and its STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to the .env, and restart.'), INTEGRATIONS_DOCS + '#strava')
        if (action === 'connect') return startStrava(card)
        return stravaSheet((server.data?.connections || []).find(c => c.provider === 'strava'), webhookCtx)
      case 'webdav': return webdavSheet()
      case 'icloud': return icloudSheet(card)
      case 'calendar':
        if (status === 'server') return infoSheet(card, t('The calendar link is served by your own openGym server, so it needs one. Connect this device to it in Account.'))
        return calendarSheet(setCalendarState)
      case 'coach': return nav(MOBILE ? '/coach/setup' : '/coach')
      case 'opennutrition': return nutritionSheet()
      case 'mcp':
        if (status === 'server') return infoSheet(card, t('The MCP server runs next to your own openGym server and reads your data there.'), MCP_DOCS)
        // A server with scoped tokens: the token page, where the address and the keys are.
        if (tokens) return nav('/settings/api-tokens')
        return window.open(MCP_DOCS, '_blank', 'noopener')
      default:
    }
  }
  const open = card => {
    // The health stores and the webhooks have more to say than a card holds.
    if (card.state.status === 'device' || card.state.status === 'server' || card.state.action === 'open' && card.id === 'webhook') return act(card)
    if (card.id === 'webhook') return card.state.action === 'connect' ? detailSheet(card, { act: () => act(card) }) : webhookListSheet(webhookCtx)
    if (card.id === 'strava' && card.state.action === 'manage') return act(card)
    if (card.id === 'webdav' && card.state.action === 'manage') return webdavSheet()
    if (card.id === 'icloud') return act(card)
    if (card.id === 'calendar' && card.state.action === 'manage') return calendarSheet(setCalendarState)
    if (card.id === 'opennutrition' && card.state.action === 'manage') return nutritionSheet()
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
      {/* openRunning has no app yet (docs/dev/SISTER_APPS.md): said once, no fake Connect button. */}
      {cat.id === 'sister' && <p className="sect-f intg-intro">{t('openRunning is on its way. Until it lands, runs and matches come in from Apple Health or Health Connect.')}</p>}
    </div>)}
    {tokens && <Section footer={t('For AI assistants over MCP, planners and scripts. Each sees only what you tick.')}>
      <Row icon="key" iconTint="var(--purple)" title={t('API tokens')} accessory="chevron" onClick={() => nav('/settings/api-tokens')} />
    </Section>}
    <input ref={fileRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />
  </>
}

const healthOn = h => !!(h && (h.on || h.readHr || h.readWeight || h.readBody || h.readVitals || h.readSport))

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
    // Every read, not just the first two: body composition and vitals kept reading after a disconnect.
    for (const kind of ['hr', 'weight', 'body', 'vitals', 'sport']) await disableRead(kind)
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
        <Icon name={w.glyph} /><span translate="no">{w.name}</span>
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
    <SheetHead icon={w.glyph} title={w.name} />
    <p className="intg-lead">{t('{0} has no direct line to openGym, and it does not need one.', w.name)}</p>
    {/* Three facts, not three settings: plain rows, no tinted tile on each (Integrations pass, I6). */}
    <Section className="intg-facts">
      <Row title={t('How it gets here')}
        subtitle={t('{0} saves to Apple Health on iPhone or Health Connect on Android. openGym reads from there.', w.name)} />
      <Row title={t('What openGym reads')} subtitle={t(READS[w.reads])} />
      <Row title={t('What it does not do')} subtitle={t('Workouts logged in openGym go to the health store, not back into {0} itself.', w.name)} />
    </Section>
    {store
      ? <Button variant="primary" onClick={() => { close(); nav('/settings/' + store) }}>{t('Set up {0}', CARD[store].name)}</Button>
      : <p className="intg-note">{t('Install the openGym app on your phone to use this.')}</p>}
  </>)
}

/* ---------------- detail and info sheets ---------------- */

function infoSheet(card, message, link) {
  sheet(close => <>
    <SheetHead icon={card.icon} title={nameOf(card)} status={card.state.status} />
    <p className="intg-lead">{message}</p>
    <div className="intg-btns">
      {link && <Button variant="tinted" onClick={() => window.open(link, '_blank', 'noopener')}>{t('How to set it up')}</Button>}
      <Button variant="plain" onClick={close}>{t('Done')}</Button>
    </div>
  </>)
}

function detailSheet(card, { act, health, onDisconnect, retry }) {
  const st = card.state
  sheet(close => {
    const go = f => () => { close(); f?.() }
    const trouble = st.status === 'attention'
    return <>
      <SheetHead icon={card.icon} title={nameOf(card)} status={st.status} />
      {/* What it does, as a short list with a check in the green ink: lines to read, not rows
          to tap, so no tinted tile on each (Integrations pass, I6). */}
      <Section title={t('What it does')}>
        <ul className="intg-does">
          {card.syncs.map(line => <li key={line}><Icon name="check" />{t(line)}</li>)}
        </ul>
      </Section>
      {health && <Section>
        <Row icon="clock" iconTint="var(--blue)" title={t('Last sync')} value={health.at ? fmtAgo(health.at) : t('Not yet')} />
        {trouble && <Row icon="warning" iconTint="var(--orange)" title={t('Permission withdrawn')} subtitle={t('openGym can no longer reach it.')}>
          <button className="btn xs tinted" onClick={go(retry)}>{t('Retry')}</button>
        </Row>}
      </Section>}
      {st.action && <Button variant="primary" onClick={go(act)}>{t(ACTION[st.action])}</Button>}
      {onDisconnect && <DangerRow label={t('Disconnect')} onClick={go(onDisconnect)} />}
    </>
  })
}

/* iCloud Drive (iPhone): the auto-backup folder (#161) picked in Files, so any folder there will do,
   iCloud Drive or a provider's. Says what happens first, then the folder rows, shared with Settings. */
function icloudSheet(card) {
  sheet(close => <ICloudSheet card={card} close={close} />)
}

function ICloudSheet({ card, close }) {
  const on = useStore(s => !!s.S.autoBackup)
  return <>
    <SheetHead icon={card.icon} title={nameOf(card)} />
    <Section title={t('What it does')}>
      <ul className="intg-does">
        {card.syncs.map(line => <li key={line}><Icon name="check" />{t(line)}</li>)}
      </ul>
    </Section>
    {/* The copies are the auto-backup's: with it off the folder would stay empty, so its row waits for the switch, as in Settings. */}
    <Section>
      <Row icon="folder" iconTint="var(--blue)" title={t('Auto-backup on changes')}>
        <Switch checked={on} onChange={v => useStore.getState().update(s => { s.autoBackup = v })} />
      </Row>
      {on && <BackupFolderRow />}
      <Row icon="download" iconTint="var(--teal)" title={t('Restore from a backup')} accessory="chevron" onClick={() => { close(); restoreFromFolder() }} />
    </Section>
  </>
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
  const add = () => { close(); addWebhookSheet({ server, lan, toast }) }
  return <>
    <SheetHead icon="webhook" title={t('Webhooks')} />
    {/* None left (the last one was disconnected): the sentence and the way in together, where the
        list will be (P9), instead of a lone button under a lead. */}
    {list.length === 0
      ? <EmptyState icon="webhook" text={t('Your server sends a signed message to each of these when something happens.')}>
          <Button variant="primary" icon="plus" onClick={add}>{t('Add a webhook')}</Button>
        </EmptyState>
      : <>
        <p className="intg-lead">{t('Your server sends a signed message to each of these when something happens.')}</p>
        <Section>
          {list.map(c => <Row key={c.id} title={c.label} className="intg-hook"
            subtitle={<><span className="intg-url" translate="no">{c.info?.url}</span><Pill status={statusOf(c)} /></>} accessory="chevron"
            onClick={() => { close(); webhookSheet(c, { server, lan, toast }) }} />)}
        </Section>
      </>}
    <div className="sect-b intg-acts">
      {list.length > 0 && list.length < max && <ActRow icon="plus" label={t('Add a webhook')} onClick={add} />}
      <ActRow icon="info" label={t('What gets sent')} onClick={() => window.open(INTEGRATIONS_DOCS, '_blank', 'noopener')} />
    </div>
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
  const urlRef = useRef(null)
  const toggle = (id, v) => setEvents(cur => (v ? [...new Set([...cur, id])] : cur.filter(x => x !== id)))
  const add = async () => {
    // A host pasted without https:// is taken as https (Integrations pass: take the common format
    // instead of telling people it is not a URL).
    const full = normalizeWebhookUrl(url)
    if (full !== url.trim()) setUrl(full)
    const p = webhookUrlProblem(full, { lan })
    // Focus goes to the field the problem is about (WIG: focus the first error on submit).
    if (p) { setProblem(t(p)); urlRef.current?.focus(); return }
    if (!events.length) { setProblem(t('Pick at least one thing to send.')); return }
    setBusy(true); setProblem(null)
    try {
      const r = await api('/api/integrations/connect', { method: 'POST', body: JSON.stringify({ provider: 'webhook', url: full, label: label.trim(), events }) })
      setSecret(r?.reveal?.secret || '')
      server.load()
    } catch (e) {
      setProblem(e?.code === 'url' || e?.status === 400 ? t('Your server said no to that URL: {0}', errText(e, t('it is not one it calls.'))) : errText(e, t('Something went wrong')))
      urlRef.current?.focus()
    }
    setBusy(false)
  }
  if (secret != null) return <>
    <SheetHead icon="checkCircle" title={t('Webhook added')} />
    <p className="intg-lead">{t('This is its signing secret. You will see it only now, so paste it into your tool if it checks signatures.')}</p>
    <div className="intg-secret" role="group" aria-label={t('Signing secret')} translate="no">{secret}</div>
    <div className="intg-btns">
      <Button variant="tinted" icon="copy" onClick={async () => { if (await copyText(secret)) toast?.(t('Copied')) }}>{t('Copy secret')}</Button>
      <Button variant="primary" onClick={close}>{t('Done')}</Button>
    </div>
  </>
  return <>
    <SheetHead icon="webhook" title={t('Add a webhook')} />
    <p className="intg-lead">{lan
      ? t('Paste the URL from Home Assistant, n8n, ntfy or similar. Your home network works too.')
      : t('Paste the HTTPS URL from Home Assistant, n8n, ntfy or similar.')}</p>
    {/* Labels you can see over the fields, and the problem right under the URL it is about, tied
        to it for a screen reader (Integrations pass, I8). It used to sit under the name field. */}
    <div className="intg-field">
      <label className="intg-label" htmlFor="intg-url">{t('Webhook URL')}</label>
      <TextField ref={urlRef} id="intg-url" name="webhook-url" placeholder="https://…" value={url} onChange={e => { setUrl(e.target.value); setProblem(null) }} inputMode="url" type="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
        aria-label={t('Webhook URL')} aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'intg-url-problem' : undefined} maxLength={2048} />
      {problem && <div className="intg-problem" id="intg-url-problem" role="alert">{problem}</div>}
    </div>
    <div className="intg-field">
      <label className="intg-label" htmlFor="intg-name">{t('Name')}</label>
      <TextField id="intg-name" name="webhook-name" autoComplete="off" placeholder={t('Name (optional)')} value={label} onChange={e => setLabel(e.target.value)} maxLength={60} aria-label={t('Name')} />
    </div>
    <Section title={t('Send when')}>
      <EventSwitches events={events} onToggle={toggle} disabled={busy} />
    </Section>
    <Button variant="primary" disabled={busy} onClick={add}>{busy ? t('Adding…') : t('Add webhook')}</Button>
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
    <SheetHead icon="webhook" title={c.label} status={statusOf(c)} />
    <p className="intg-url intg-lead" translate="no">{c.info?.url}</p>
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
    <div className="sect-b intg-acts">
      <ActRow icon="bolt" label={t('Send test event')} disabled={busy} onClick={test} />
      <ActRow icon="list" label={log ? t('Hide activity') : t('Show activity')} onClick={() => (log ? setLog(null) : loadLog())} />
    </div>
    {/* The log reads like a list of what happened: the outcome as a glyph in the status ink, not a
        tinted tile on every line (Integrations pass, I6). */}
    {log && <Section title={t('Activity')} className="intg-log">
      {log.length ? log.slice(0, 50).map((e, i) => <Row key={i} className={e.ok ? 'ok' : 'bad'}
        title={<><Icon name={e.ok ? 'checkCircle' : 'warning'} className="intg-log-i" /><span className="intg-line">{eventName(e.ev)}{e.status ? ' · ' + e.status : ''}</span></>}
        subtitle={[fmtAgo(e.at), e.msg].filter(Boolean).join(' · ')} />)
        : <Row title={<span className="intg-line dim">{t('Nothing yet')}</span>} />}
    </Section>}
    <DangerRow label={t('Disconnect')} disabled={busy} onClick={disconnect} />
  </>
}

/* ---------------- Strava (#478) ---------------- */

const STRAVA_ERRORS = {
  denied: 'Strava was not given access. Nothing was connected.',
  scope: 'Strava has to be allowed to upload activities. Connect again and leave that box ticked.',
  state: 'That sign-in took too long or came from somewhere else. Start again from here.',
  signin: 'Sign in to your server first, then connect Strava.',
  off: 'Strava is off on this server.',
}

// The sign-in is a trip to Strava and back to this server's address, so it starts from a browser
// that has the server's session. The phone apps upload through the same connection afterwards.
function startStrava(card) {
  if (MOBILE) return infoSheet(card, t('Connect Strava once from openGym in a browser, signed in to your server. Your workouts then go up from the server, whichever device you log them on.'), INTEGRATIONS_DOCS + '#strava')
  window.location.assign(appBase().replace(/\/$/, '') + '/api/integrations/oauth/start?provider=strava')
}

function stravaSheet(conn, ctx) {
  if (!conn) return
  sheet(close => <StravaDetail close={close} conn={conn} {...ctx} />)
}

function StravaDetail({ close, conn: initial, server, toast }) {
  const [c, setC] = useState(initial)
  const [busy, setBusy] = useState(false)
  const call = async (path, body, after) => {
    setBusy(true)
    try {
      const r = await api(path, { method: 'POST', body: JSON.stringify({ id: c.id, ...body }) })
      if (r?.connection) setC(r.connection)
      after?.(r)
      server.load()
    } catch (e) { toast?.(errText(e, t('Something went wrong'))) }
    setBusy(false)
  }
  const trouble = c.status === 'attention'
  const disconnect = () => confirmSheet({
    title: t('Disconnect Strava?'),
    message: t('Your server forgets the sign-in and stops uploading. What is on Strava stays, and the Strava app keeps its access until you remove it on strava.com.'),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => call('/api/integrations/disconnect', {}, () => { close(); toast?.(t('Strava disconnected')) }),
  })
  return <>
    <SheetHead icon="figureRun" title="Strava" status={statusOf(c)} />
    <p className="intg-lead" translate="no">{c.info?.athlete || c.label}</p>
    <Section footer={t('Cardio goes up as what it was: a run, a ride, a row. Strength as Weight Training, with every set in the description.')}>
      <Row icon="dumbbell" iconTint="var(--orange)" title={t('Strength workouts too')}>
        <Switch aria-label={t('Strength workouts too')} checked={c.info?.strength === 'on'} disabled={busy} onChange={v => call('/api/integrations/update', { strength: v })} />
      </Row>
      <Row icon="play" iconTint="var(--green)" title={t('Uploading')} subtitle={c.paused ? t('Paused. Nothing is sent until you switch it back on.') : null}>
        <Switch aria-label={t('Uploading')} checked={!c.paused} disabled={busy} onChange={v => call('/api/integrations/update', { paused: !v })} />
      </Row>
      <Row icon="clock" iconTint="var(--blue)" title={t('Last upload')} value={c.lastOk ? fmtAgo(c.lastOk) : t('Not yet')} />
      {c.lastError && <Row icon="warning" iconTint={trouble ? 'var(--orange)' : 'var(--grey)'} title={<span className="intg-line">{c.lastError.msg}</span>}
        subtitle={c.lastError.at ? fmtAgo(c.lastError.at) : null} />}
    </Section>
    <div className="sect-b intg-acts">
      <ActRow icon="bolt" label={t('Check the connection')} disabled={busy} onClick={() => call('/api/integrations/test', {}, r => toast?.(r?.ok ? t('Strava is listening') : t('Test failed: {0}', r?.msg || '')))} />
      {trouble && <ActRow icon="reset" label={t('Reconnect')} disabled={busy} onClick={() => startStrava({ icon: 'figureRun', name: 'Strava', state: {} })} />}
    </div>
    <DangerRow label={t('Disconnect')} disabled={busy} onClick={disconnect} />
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
