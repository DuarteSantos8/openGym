// Settings → Huawei watch (Android app): the Huawei link (docs/HUAWEI_WATCH.md). Which watches
// Huawei Health knows, whether openGym is on them, and what to do when the link is not up yet.
// The words come from lib/huawei-view.js.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Section, Row } from '../components/ui.jsx'
import { huaweiCall } from '../lib/watch-sync.js'
import { huaweiView, huaweiDeviceLine, HUAWEI_DOCS } from '../lib/huawei-view.js'

const lineOf = key => ({
  checking: t('Checking…'),
  starting: t('Looking for your watch…'),
  build: t('This version of openGym can’t talk to a Huawei watch yet.'),
  'no-health': t('Huawei Health isn’t on this phone. Install it, pair your watch there, then come back here.'),
  'no-permission': t('openGym needs your OK in Huawei Health to talk to your watch.'),
  error: t('Couldn’t reach Huawei Health. Try again in a moment.'),
  'no-watch': t('Huawei Health doesn’t know a watch yet. Pair yours there first.'),
  ready: t('Open openGym on your watch and keep it open while you train. The watch only hears the phone while its app is on screen.'),
}[key] || '')

const deviceLine = d => ({
  connected: t('Connected'),
  away: t('Not in reach'),
  'not-installed': t('openGym isn’t on it yet'),
}[huaweiDeviceLine(d)])

/** `api`: the native calls (a test hands in its own). */
export default function HuaweiSettingsPage ({ api = huaweiCall }) {
  const [status, setStatus] = useState(null)
  // Asked now, again every few seconds while the page is open (a watch connects, the permission
  // is given in Huawei Health), and when the app comes back to the front.
  useEffect(() => {
    let gone = false
    const ask = () => api('huaweiStatus').then(st => { if (!gone) setStatus(st || { supported: false, state: 'build' }) })
    ask()
    const tm = setInterval(ask, 3000)
    const onVisible = () => { if (document.visibilityState === 'visible') ask() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { gone = true; clearInterval(tm); document.removeEventListener('visibilitychange', onVisible) }
  }, [api])
  const view = huaweiView(status)
  const pick = () => api('huaweiPick').then(() => api('huaweiStatus')).then(st => st && setStatus(st))

  return <>
    {!view.devices.length && <p className="sect-f">{lineOf(view.key)}</p>}
    {view.devices.length > 0 && <Section title={t('Your Huawei watches')} footer={lineOf(view.key)}>
      {view.devices.map(d => <Row key={d.id} icon="watch" iconTint={d.connected ? 'var(--green)' : 'var(--grey)'} title={d.name || 'Huawei'} subtitle={deviceLine(d)} />)}
    </Section>}
    {(view.button || view.getApp) && <Section>
      {view.button && <Row icon={view.button === 'allow' ? 'plusCircle' : 'repeat'} iconTint="var(--blue)" accessory="chevron"
        title={view.button === 'allow' ? t('Allow in Huawei Health') : t('Look again')} onClick={pick} />}
      {view.getApp && <Row icon="download" iconTint="var(--green)" accessory="chevron" title={t('Get openGym for Huawei')}
        onClick={() => window.open(HUAWEI_DOCS, '_blank', 'noopener,noreferrer')} />}
    </Section>}
  </>
}
