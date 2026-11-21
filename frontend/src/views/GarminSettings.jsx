// Settings → Garmin (phone app): the Garmin link (docs/GARMIN.md). Which Garmins the phone knows,
// whether openGym is on them, and the two watch switches every watch shares (lib/watch-settings.js).
// On the iPhone the watches are picked in Garmin Connect (it opens and comes back); on Android
// Garmin Connect's own pairing is the list. The words come from lib/garmin-view.js.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Section, Row, Switch } from '../components/ui.jsx'
import { readWatchPrefs, writeWatchPrefs, onWatchPrefs } from '../lib/watch-settings.js'
import { garminCall } from '../lib/watch-sync.js'
import { garminView, garminDeviceLine, GARMIN_STORE } from '../lib/garmin-view.js'

const lineOf = key => ({
  checking: t('Checking…'),
  build: t('This version of openGym comes without the Garmin link, since Garmin’s part of it isn’t open source. The App Store, Google Play and GitHub versions have it.'),
  'no-gcm': t('Garmin Connect isn’t on this phone. Install it, pair your watch there, then come back here.'),
  'gcm-upgrade': t('Garmin Connect needs an update before openGym can talk to your watch.'),
  error: t('Couldn’t reach Garmin Connect. Try again in a moment.'),
  pick: t('Pick your Garmin in Garmin Connect and your workouts show up on your wrist.'),
  'no-watch': t('Garmin Connect doesn’t know a watch yet. Pair yours there first.'),
  'on-watch': t('openGym is on your Garmin. Sets you log on the wrist land here.'),
  'on-watch-away': t('openGym is on your Garmin. It catches up as soon as the watch is in reach.'),
  away: t('Your Garmin isn’t in reach right now. Bring it close with Bluetooth on, and this page catches up by itself.'),
  'get-app': t('Your Garmin is here, openGym isn’t on it yet. Get it, then open it once on the watch.'),
}[key] || '')

const deviceLine = d => ({
  connected: t('Connected'),
  away: t('Not in reach'),
  'not-installed': t('openGym isn’t on it yet'),
}[garminDeviceLine(d)])

/** `api`: the native calls (a test hands in its own). */
export default function GarminSettingsPage ({ api = garminCall }) {
  const [status, setStatus] = useState(null)
  const [prefs, setPrefs] = useState(readWatchPrefs)
  useEffect(() => onWatchPrefs(() => setPrefs(readWatchPrefs())), [])
  // Asked now, again every few seconds while the page is open (a watch connects, Garmin Connect
  // comes back with the picked ones), and when the app comes back to the front.
  useEffect(() => {
    let gone = false
    const ask = () => api('garminStatus').then(st => { if (!gone) setStatus(st || { supported: false, state: 'build' }) })
    ask()
    const tm = setInterval(ask, 3000)
    const onVisible = () => { if (document.visibilityState === 'visible') ask() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { gone = true; clearInterval(tm); document.removeEventListener('visibilitychange', onVisible) }
  }, [api])
  const view = garminView(status)
  const set = patch => setPrefs(writeWatchPrefs(patch))
  const pick = () => api('garminPick').then(() => api('garminStatus')).then(st => st && setStatus(st))
  const getApp = async () => {
    // Garmin Connect opens its store page; when it cannot (or will not), the page on the web does.
    const r = status?.store ? await api('garminStore') : null
    if (!r?.ok) window.open(GARMIN_STORE, '_blank', 'noopener,noreferrer')
  }

  return <>
    <Section footer={lineOf(view.key)}>
      <Row icon="watch" iconTint="var(--grey)" title={t('Send workouts to the watch')}>
        <Switch checked={prefs.enabled} onChange={v => set({ enabled: v })} aria-label={t('Send workouts to the watch')} />
      </Row>
    </Section>
    {view.devices.length > 0 && <Section title={t('Your Garmins')}>
      {view.devices.map(d => <Row key={d.id} icon="watch" iconTint={d.connected ? 'var(--green)' : 'var(--grey)'} title={d.name || 'Garmin'} subtitle={deviceLine(d)} />)}
    </Section>}
    {(view.pick || view.getApp) && <Section>
      {view.pick && <Row icon={status?.picker ? 'plusCircle' : 'repeat'} iconTint="var(--blue)" accessory="chevron"
        title={status?.picker ? t('Choose watches') : t('Look again')} onClick={pick} />}
      {view.getApp && <Row icon="download" iconTint="var(--green)" accessory="chevron" title={t('Get openGym for Garmin')} onClick={getApp} />}
    </Section>}
    {prefs.enabled && view.key !== 'build' && <Section footer={t('Start a workout on the phone and your Garmin asks to open openGym.')}>
      <Row icon="bolt" iconTint="var(--green)" title={t('Open on the watch')}>
        <Switch checked={prefs.autoShow} onChange={v => set({ autoShow: v })} aria-label={t('Open on the watch')} />
      </Row>
    </Section>}
  </>
}
