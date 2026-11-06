// Settings → About & updates → Network log (phone app): what this copy of openGym sent where since
// it started (lib/net-log.js). A phone kept on its own should read "0 requests this session", and
// anyone can check that here instead of taking our word for it. openGym Offline adds why it can
// only ever be 0: Android does not give it the internet permission.
import { useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { netLog, subscribeNetLog, hostsOf } from '../lib/net-log.js'
import { useOfflineBuild } from '../lib/use-offline-build.js'
import { useStore } from '../store/useStore.js'
import { Section, Row } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

// netLog() hands out the same object until something is logged, so the snapshot is stable.
let snap = null
let snapTotal = -1
const read = () => {
  const l = netLog()
  if (!snap || l.total !== snapTotal || l.entries !== snap.entries) { snap = { ...l }; snapTotal = l.total }
  return snap
}

const clock = at => {
  try { return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(at)) } catch { return '' }
}

// How it went out, in words a person reads.
const SCRIPTED = new Set(['fetch', 'xhr', 'eventsource', 'websocket', 'beacon'])
const SHOWN = new Set(['img', 'iframe', 'video', 'audio', 'image'])
const viaLabel = v => SCRIPTED.has(v) ? t('From the app') : v === 'native' ? t('From the phone itself')
  : SHOWN.has(v) ? t('Something it showed') : t('Something the page loaded')

export function NetworkLogRow() {
  const log = useSyncExternalStore(subscribeNetLog, read, read)
  const nav = useNavigate()
  return <Row icon="shield" iconTint="var(--green)" title={t('Network log')}
    subtitle={t('Who this app talked to since you opened it.')}
    value={String(log.total)} accessory="chevron" onClick={() => nav('/settings/network')} />
}

export default function NetworkLogPage() {
  const log = useSyncExternalStore(subscribeNetLog, read, read)
  const offline = useOfflineBuild()
  const server = useStore(s => s.sync?.server || null)
  const paired = useStore(s => !!s.user)
  const hosts = hostsOf(log.entries)
  const recent = log.entries.slice(-50).reverse()
  const since = log.since ? clock(log.since) : null
  const lead = log.total === 0
    ? (offline ? t('And it stays that way: openGym Offline has no internet permission, so Android blocks anything it might try.')
      : paired ? t('Nothing yet. Your server hears from this phone when there is something to sync.')
        : t('Not a single byte left this phone. Your training is nobody’s business but yours.'))
    : paired && server ? t('Mostly your own server, {0}, when there was something to sync.', hostOf(server))
      : t('Everything this app asked the internet for, newest first. The address only, never what was in it.')
  return <>
    <div className="netlog-hero" role="status" aria-live="polite">
      <span className="netlog-ico"><Icon name="shield" /></span>
      <div className="netlog-n">{tn('{0} request this session', '{0} requests this session', log.total)}</div>
      <p className="netlog-lead">{lead}</p>
    </div>
    {hosts.length > 0 && <Section title={t('Who')}>
      {hosts.map(h => <Row key={h.host} icon="globe" iconTint="var(--blue)" title={<span translate="no">{h.host}</span>}
        subtitle={t('Last at {0}', clock(h.last))} value={String(h.count)} />)}
    </Section>}
    {recent.length > 0 && <Section title={t('Latest')} footer={log.total > log.entries.length ? t('Showing the last {0}. The count above has them all.', log.entries.length) : null}>
      {recent.map((e, i) => <Row key={log.total - i} className="netlog-row" title={<span className="netlog-url" translate="no">{e.method} {e.host}{e.path}</span>}
        subtitle={clock(e.at) + ' · ' + viaLabel(e.via)} />)}
    </Section>}
    <p className="sect-f">{since ? t('Counting since {0}, when the app started. Closing the app resets it; the log never leaves the phone.', since) : t('Closing the app resets the count; the log never leaves the phone.')}</p>
  </>
}

function hostOf(url) {
  try { return new URL(url).host } catch { return String(url) }
}
