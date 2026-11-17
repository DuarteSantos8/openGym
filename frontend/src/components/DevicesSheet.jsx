// The Devices sheet (docs/dev/DEVICE_LINK_STATUS.md): one row per link, opened from the workout's
// link sign. While it is open it looks at the links, with a ping, every 5 s.
import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtAgo } from '../lib/format.js'
import { checkLinks } from '../lib/device-link-live.js'
import { closeThenNav } from '../lib/nav.js'
import Icon from './Icon.jsx'
import { Button, Section, Row } from './ui.jsx'
import { actionLabel, syncNowWithToast, pairAgain, connectServer, signInAgain } from './ServerSync.jsx'
import { useDeviceLink } from './useDeviceLink.js'

const LOOK_MS = 5e3

// Every state has its own glyph as well as its word: never colour alone.
const STATE = {
  live: ['dot', () => t('Live')], ok: ['dot', () => t('All synced')],
  delayed: ['clock', () => t('Delayed')], wait: ['clock', () => t('Waiting to sync')],
  notAnswering: ['warning', () => t('Not answering')], notFound: ['help', () => t('Not found')],
  offline: ['linkSlash', () => t('Offline')],
}
const NAME = { apple: () => t('Apple Watch'), wear: () => t('Wear OS watch'), zepp: () => t('Zepp OS watch'), server: () => t('Sync server'), hr: () => t('Heart rate') }
const TILE = { apple: 'watch', wear: 'watch', zepp: 'watch', server: 'cloud', hr: 'heart' }
const WATCH_SYNCS = () => t('Sets, rest timer, heart rate per set')
const SYNCS = { apple: WATCH_SYNCS, wear: WATCH_SYNCS, zepp: WATCH_SYNCS, server: () => t('Workouts, plans and history'), hr: () => t('From Apple Health') }

function detail(r) {
  if (r.state === 'offline') return r.lastHeard ? t('Last heard {0}', fmtAgo(r.lastHeard)) : null
  if (r.state === 'notAnswering') return t('Open openGym on your watch')
  if (r.state === 'notFound') return r.reason === 'unpaired' ? t('Pair your watch') : t('Install openGym on your watch')
  return SYNCS[r.kind]?.() || null
}

export function DevicesSheet({ close }) {
  const fixes = { retry: syncNowWithToast, pair: () => { close(); pairAgain() }, connect: () => { close(); connectServer() }, signin: () => { close(); signInAgain() } }
  const { rows } = useDeviceLink({ live: false })
  useEffect(() => {
    checkLinks({ ping: true })
    const id = setInterval(() => { if (document.visibilityState === 'visible') checkLinks({ ping: true }) }, LOOK_MS)
    return () => clearInterval(id)
  }, [])

  if (!rows.length) return <>
    <h3>{t('Devices')}</h3>
    <div className="card" style={{ textAlign: 'center' }}>
      <b>{t('No devices connected')}</b>
      <div className="muted small" style={{ margin: '4px 0 12px' }}>{t('Add a watch or connect a server in Settings')}</div>
      <Button className="dev-fix" style={{ margin: 0 }} onClick={() => closeThenNav(close, '/settings')}>{t('Open Settings')}</Button>
    </div>
  </>

  return <>
    <h3>{t('Devices')}</h3>
    <Section>
      {rows.map(r => {
        const [glyph, word] = STATE[r.state]
        const down = r.state === 'offline' && r.kind === 'server'
        return <div className="dev-item" key={r.id}>
          <Row icon={TILE[r.kind]} title={r.device || NAME[r.kind]()} subtitle={detail(r)}>
            {r.bpm != null && <span className="dev-bpm">{r.bpm} bpm</span>}
            {r.speed && <span className={'dev-speed ' + r.speed}><Icon name="bars" />{r.speed === 'fast' ? t('Fast') : t('Slow')}</span>}
            <span className={'dev-state' + (r.warn ? ' warn' : r.state === 'live' || r.state === 'ok' ? ' ok' : '')}><Icon name={glyph} />{word()}</span>
          </Row>
          {down && r.pending && <div className="small dim dev-note">{t('Your changes wait on this phone')}</div>}
          {r.fix === 'watchSettings' && <Button className="dev-fix" onClick={() => closeThenNav(close, '/settings/watch')}>{t('Open Watch settings')}</Button>}
          {r.fix === 'server' && fixes[r.action] && <Button className="dev-fix" onClick={() => fixes[r.action]()}>{actionLabel({ action: r.action })}</Button>}
        </div>
      })}
    </Section>
  </>
}

export function openDevicesSheet() {
  useUI.getState().openSheet(close => <DevicesSheet close={close} />)
}
