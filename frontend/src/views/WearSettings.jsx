// Settings → Wear OS watch (Android app): whether a watch is there and has the app, what to do
// when not, and this phone's choices for it (lib/watch-settings.js), which the watch gets with
// every snapshot. The states and their order live in lib/wear-view.js; this page has the words.
//
// The watch itself checks in each time its app comes to the front (a watchStatus event, android/wear
// CheckIn): "Last heard from the watch" is the one sign that the two really talk, both ways.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Section, Row, Switch } from '../components/ui.jsx'
import { readWatchPrefs, writeWatchPrefs, readWatchStatus, onWatchPrefs } from '../lib/watch-settings.js'
import { wearStatus } from '../lib/watch-sync.js'
import { getChannel } from '../lib/channel.js'
import { wearView, wearWatchLine, WEAR_DOCS } from '../lib/wear-view.js'
import { fmtAgo } from '../lib/format.js'

const lineOf = key => ({
  checking: t('Checking…'),
  build: t('Wear OS watches talk to the phone through Google Play services, which F-Droid apps leave out. The APK from opengym.ch and the Google Play app have the watch link.'),
  'no-watch': t('No Wear OS watch is connected to this phone. Pair one in its own app (Galaxy Wearable, Pixel Watch), then come back here.'),
  'get-app-play': t('Your watch is here, openGym isn’t on it yet. On the watch, open the Play Store and install openGym from “Apps on your phone”.'),
  'get-app-apk': t('Your watch is here, openGym isn’t on it yet. This phone runs the openGym APK, so the watch needs the Wear OS APK of the same release. One from Google Play won’t pair with it.'),
  'on-watch': t('openGym is on your watch and in reach. Sets you log on the wrist land here.'),
  'on-watch-away': t('openGym is on your watch, but the watch is out of reach right now. Sets you log on it wait there and land here once it is back.'),
}[key] || '')

const watchLine = w => ({
  connected: t('Connected'),
  away: t('Not in reach'),
  'not-installed': t('openGym isn’t on it yet'),
}[wearWatchLine(w)])

/** `api`: the phone's answer and where the app came from (a test hands in its own). */
export default function WearSettingsPage ({ api = { status: wearStatus, channel: getChannel } }) {
  const [prefs, setPrefs] = useState(readWatchPrefs)
  const [heard, setHeard] = useState(readWatchStatus)
  const [wear, setWear] = useState(null)
  const [channel, setChannel] = useState('sideload')
  useEffect(() => onWatchPrefs(() => { setPrefs(readWatchPrefs()); setHeard(readWatchStatus()) }), [])
  // Asked now, again every few seconds while the page is open (the watch connects, the app lands
  // on it), and when the app comes back to the front: nobody should have to leave and reopen the
  // page to see that it worked.
  useEffect(() => {
    let gone = false
    api.channel().then(c => { if (!gone) setChannel(c) }).catch(() => {})
    const ask = () => api.status().then(st => { if (!gone) { setWear(st || { paired: false, installed: false, watches: [] }); setHeard(readWatchStatus()) } }).catch(() => { if (!gone) setWear({ paired: false, installed: false, watches: [] }) })
    ask()
    const tm = setInterval(ask, 3000)
    const onVisible = () => { if (document.visibilityState === 'visible') ask() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { gone = true; clearInterval(tm); document.removeEventListener('visibilitychange', onVisible) }
  }, [api])
  const set = patch => setPrefs(writeWatchPrefs(patch))
  const view = wearView(wear, channel)
  const there = view.key === 'on-watch' || view.key === 'on-watch-away'
  // With the app on the watch: when it last checked in, or that it has not yet.
  const heardLine = !there ? '' : heard?.at
    ? t('Last heard from the watch: {0}', fmtAgo(heard.at))
    : t('The watch hasn’t checked in yet. Open openGym on it once.')

  return <>
    <Section footer={[lineOf(view.key), heardLine].filter(Boolean).join(' ')}>
      <Row icon="watch" iconTint="var(--grey)" title={t('Send workouts to the watch')}>
        <Switch checked={prefs.enabled} onChange={v => set({ enabled: v })} aria-label={t('Send workouts to the watch')} />
      </Row>
    </Section>
    {view.watches.length > 0 && <Section title={t('Your watches')}>
      {view.watches.map((w, i) => <Row key={w.id || i} icon="watch" iconTint={wearWatchLine(w) === 'connected' ? 'var(--green)' : 'var(--grey)'}
        title={w.name || t('Wear OS watch')} subtitle={watchLine(w)} />)}
    </Section>}
    {view.getApp && <Section>
      <Row icon="download" iconTint="var(--green)" accessory="chevron" title={t('Get openGym for Wear OS')}
        onClick={() => window.open(WEAR_DOCS, '_blank', 'noopener,noreferrer')} />
    </Section>}
    {prefs.enabled && view.key !== 'build' && <>
      <Section footer={t('Start a workout on the phone and it shows up on your watch. One tap opens it.')}>
        <Row icon="bolt" iconTint="var(--green)" title={t('Open on the watch')}>
          <Switch checked={prefs.autoShow} onChange={v => set({ autoShow: v })} aria-label={t('Open on the watch')} />
        </Row>
      </Section>
      <Section title={t('On the watch')} footer={t('Fewer things, bigger numbers. Pick what helps you mid-set.')}>
        {[['hr', 'Heart rate', 'heart'], ['last', 'Last time', 'history'], ['next', 'Next exercise during the rest', 'list']].map(([k, title, icon]) => (
          <Row key={k} icon={icon} iconTint="var(--grey)" title={t(title)}>
            <Switch checked={!!prefs.show[k]} onChange={v => set({ show: { [k]: v } })} aria-label={t(title)} />
          </Row>
        ))}
      </Section>
      <Section>
        <Row icon="vibrate" iconTint="var(--indigo)" title={t('Tap the wrist when a rest is over')}>
          <Switch checked={prefs.restHaptics} onChange={v => set({ restHaptics: v })} aria-label={t('Tap the wrist when a rest is over')} />
        </Row>
      </Section>
    </>}
  </>
}
