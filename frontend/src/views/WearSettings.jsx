// Settings → Wear OS watch (Android app): whether a watch is there and has the app, what to do
// when not, and this phone's choices for it (lib/watch-settings.js), which the watch gets with
// every snapshot. The states and their order live in lib/wear-view.js; this page has the words.
//
// The watch itself checks in each time its app comes to the front (a watchStatus event, android/wear
// CheckIn): "Last heard from the watch" is the one sign that the two really talk, both ways.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Section, Row, Switch } from '../components/ui.jsx'
import { readWatchPrefs, writeWatchPrefs, readWatchStatus, onWatchPrefs, lastHeardAt, routinesSync, readRoutinesSent } from '../lib/watch-settings.js'
import { wearStatus } from '../lib/watch-sync.js'
import { getChannel } from '../lib/channel.js'
import { wearView, wearWatchLine, WEAR_DOCS } from '../lib/wear-view.js'
import WatchPill from '../components/WatchPill.jsx'

// The next step under the pill, on trouble: one short line. (F-Droid builds have no Google Play
// services, the only way to a Wear OS watch; a watch app pairs only with the phone app from the same place.)
const lineOf = key => ({
  build: t('This version can’t reach a watch. Get openGym from Google Play or opengym.ch.'),
  'no-watch': t('Pair your watch in its own app, like Galaxy Wearable.'),
  'get-app-play': t('On the watch, install openGym from the Play Store.'),
  'get-app-apk': t('Install the Wear OS APK of this release. The Play Store one won’t pair.'),
  'on-watch-away': t('Open openGym on the watch, or bring it closer.'),
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
  // The pill's words, as on the Apple Watch page. An F-Droid build has no watch link at all: "not set up", and why.
  // (heardAt: its newest set, rest or status that reached this phone, #1151)
  const heardAt = lastHeardAt(heard)
  // A watch that never checked in is "silent", as on the Apple Watch page: in reach says nothing about the app.
  const link = !there ? { checking: 'checking', build: 'unpaired', 'no-watch': 'unpaired' }[view.key] || 'missing'
    : !heardAt ? 'silent' : view.key === 'on-watch' ? 'live' : 'away'
  // Whether the watch has every routine (it reports what it shows, each time it takes in a new file).
  const sent = readRoutinesSent()
  const rs = routinesSync({ link: there ? { paired: true, installed: true } : null, phone: sent, status: heard, enabled: prefs.enabled })
  const todo = link === 'live'
    ? { sending: t('Keep openGym open on the watch for a moment.'), unknown: t('Update openGym on the watch.') }[rs]
    : link === 'silent' ? t('Open openGym on the watch once.') : lineOf(view.key)

  return <>
    {prefs.enabled && <WatchPill link={link} routines={rs} count={sent?.count} heardAt={heardAt} todo={todo} round />}
    <Section>
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
