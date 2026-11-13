// Settings → Apple Watch (iPhone app only): whether the watch app is there, and this phone's
// choices for it (lib/watch-settings.js), which the watch gets with every snapshot.
//
// Apple Health is one switch for phone and watch: the Apple Health card in Settings → Data. This
// page only says what the watch makes of it (measuring, off, or not allowed there) and leads to it.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { Section, Row, Switch } from '../components/ui.jsx'
import { readWatchPrefs, writeWatchPrefs, readWatchStatus, onWatchPrefs, watchLinkState } from '../lib/watch-settings.js'
import { watchStatus } from '../lib/watch-sync.js'
import { loadHealth, onHealthChange } from '../lib/health-sync.js'
import { fmtAgo } from '../lib/format.js'
import Icon from '../components/Icon.jsx'

// The two rest screens as the watch draws them (simulator screenshots of the effort screen from #1100, in public/watch/).
const REST_LOOKS = [
  { value: 'ring', label: 'Progress bar', img: 'watch/rest-bar.png', alt: 'Watch rest screen: the countdown with a thin progress bar under it' },
  { value: 'plain', label: 'Countdown only', img: 'watch/rest-plain.png', alt: 'Watch rest screen: just the big countdown' },
]

// How often the page asks the phone about its watch while it is open.
const LINK_POLL_MS = 4000

function RestPicker({ value, onChange }) {
  const onKey = (e, i) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!d) return
    e.preventDefault()
    const n = REST_LOOKS[(i + d + REST_LOOKS.length) % REST_LOOKS.length]
    onChange(n.value)
    e.currentTarget.parentElement.querySelector(`[data-v="${n.value}"]`)?.focus()
  }
  return <div className="looks" role="radiogroup" aria-label={t('Rest timer')}>
    {REST_LOOKS.map((o, i) => {
      const on = o.value === value
      return <button key={o.value} type="button" role="radio" aria-checked={on} data-v={o.value} tabIndex={on ? 0 : -1}
        className={'look' + (on ? ' on' : '')} onClick={() => onChange(o.value)} onKeyDown={e => onKey(e, i)}>
        <img src={o.img} alt={t(o.alt)} width="110" height="131" draggable="false" />
        <span className="look-t">{t(o.label)}</span>
        <span className="look-k" aria-hidden="true">{on && <Icon name="check" />}</span>
      </button>
    })}
  </div>
}

export default function WatchSettingsPage() {
  const nav = useNavigate()
  const [prefs, setPrefs] = useState(readWatchPrefs)
  const [status, setStatus] = useState(readWatchStatus)
  const [link, setLink] = useState(null)   // { paired, installed } from the phone, or null while asking
  const [healthOn, setHealthOn] = useState(null)   // the phone's Apple Health switch, null while reading
  useEffect(() => onWatchPrefs(() => { setPrefs(readWatchPrefs()); setStatus(readWatchStatus()) }), [])
  // Asked again while the phone's link to the watch is still starting (right after launch it knows
  // nothing yet, and "no watch" would be wrong), for up to a few seconds; then every few seconds
  // while the page is open, so the line follows what you do (the app installed on the watch, the
  // watch app opened) without leaving the page.
  useEffect(() => {
    let gone = false, tries = 0, tm = null
    const ask = () => watchStatus()
      .then(st => {
        if (gone) return
        if (st.activated === false && tries++ < 8) { tm = setTimeout(ask, 750); return }
        setLink(st)
        setStatus(readWatchStatus())
        tm = setTimeout(ask, LINK_POLL_MS)
      })
      .catch(() => { if (!gone) { setLink({ paired: false, installed: false }); tm = setTimeout(ask, LINK_POLL_MS) } })
    ask()
    return () => { gone = true; clearTimeout(tm) }
  }, [])
  useEffect(() => {
    let gone = false
    loadHealth().then(h => { if (!gone) setHealthOn(!!h?.on) }).catch(() => { if (!gone) setHealthOn(false) })
    const off = onHealthChange(h => setHealthOn(!!h?.on))
    return () => { gone = true; off() }
  }, [])
  const set = patch => setPrefs(writeWatchPrefs(patch))

  // Every state says what to do next (lib/watch-settings.js watchLinkState). What the watch said
  // last (it checks in each time its app starts) is the one sign the two really talk.
  const state = watchLinkState(link, status)
  const onWatch = t('openGym is on your Apple Watch') + '. '
  const heard = status?.at ? t('Last heard from the watch: {0}', fmtAgo(status.at)) + '. ' : ''
  const linkLine = {
    checking: t('Checking…'),
    starting: t('Still connecting to your Apple Watch. Give it a moment, then open this page again.'),
    unpaired: t('No Apple Watch is paired with this iPhone. Pair one in the Watch app, then install openGym on it there.'),
    missing: t('openGym is not on your Apple Watch yet. Open the Watch app on this iPhone, find openGym under Available Apps and tap Install.'),
    silent: onWatch + t('The watch hasn’t checked in yet. Open openGym on it once.'),
    live: onWatch + heard + t('Connected right now.'),
    away: onWatch + heard + t('The watch app is closed or out of reach right now. Sets you log on the watch are kept there and arrive when the two are in touch again.'),
  }[state]
  const denied = healthOn && status?.health === 'denied'
  const healthValue = healthOn == null ? '' : denied ? t('Not allowed') : healthOn ? t('On') : t('Off')
  const healthLine = denied ? t('Not allowed on the watch. Allow it in the Health app on your iPhone.')
    : healthOn ? t('Heart rate during the workout and next to each set, and the workout saved to Apple Health. The watch asks once.')
    : t('Turn on Apple Health and the watch measures your heart rate for every set.')
  // The one Apple Health switch, on its own card in Settings → Data.
  const openHealth = () => nav('/settings/apple-health', { state: { find: 'Write to Apple Health' } })

  return <>
    <Section footer={<span data-watch-link={state} aria-live="polite">{linkLine}</span>}>
      <Row icon="watch" iconTint="var(--grey)" title={t('Send workouts to the watch')}>
        <Switch checked={prefs.enabled} onChange={v => set({ enabled: v })} aria-label={t('Send workouts to the watch')} />
      </Row>
    </Section>
    {prefs.enabled && <>
      <Section footer={t('Start a workout on the phone and openGym pops up on your wrist.')}>
        <Row icon="bolt" iconTint="var(--green)" title={t('Open on the watch')}>
          <Switch checked={prefs.autoShow} onChange={v => set({ autoShow: v })} aria-label={t('Open on the watch')} />
        </Row>
      </Section>
      <Section footer={healthLine}>
        <Row icon="heart" iconTint="var(--red)" title={t('Apple Health')} value={healthValue} accessory="chevron" onClick={openHealth} />
      </Section>
      {/* What a workout screen shows on the watch: clean by default, the rest one switch away. */}
      <Section title={t('On the watch')} footer={t('Fewer things, bigger numbers. Pick what helps you mid-set.')}>
        {[['clip', 'Exercise animation', 'image'], ['hr', 'Heart rate', 'heart'], ['last', 'Last time', 'history'],
          ['kcal', 'Calories', 'flame'], ['next', 'Next exercise during the rest', 'list']].map(([k, title, icon]) => (
          <Row key={k} icon={icon} iconTint="var(--grey)" title={t(title)}>
            <Switch checked={!!prefs.show[k]} onChange={v => set({ show: { [k]: v } })} aria-label={t(title)} />
          </Row>
        ))}
      </Section>
      <Section title={t('Rest timer')}>
        <RestPicker value={prefs.show.rest} onChange={v => set({ show: { rest: v } })} />
      </Section>
      <Section>
        <Row icon="vibrate" iconTint="var(--indigo)" title={t('Tap the wrist when a rest is over')}>
          <Switch checked={prefs.restHaptics} onChange={v => set({ restHaptics: v })} aria-label={t('Tap the wrist when a rest is over')} />
        </Row>
      </Section>
    </>}
  </>
}
