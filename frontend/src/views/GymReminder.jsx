// Settings → Reminders → Gym reminder (#614), phone app only: the gyms that get you a nudge when
// you walk in, the search that adds one and the editor for one of them. Redrawn twice in 1.4.4;
// the second time (after the owner tried build 45 on an iPhone) to work like Apple Maps: adding a
// gym is a search first (type, the results come as you type, tap one), and only then a small map
// to fine-tune it, where you drag the map under a pin that stays in the middle. Everything else is
// plain Settings rows. On the iPhone the search is Apple's (lib/gym-places.js findPlaces), on
// Android OpenStreetMap's; the map is OpenStreetMap on both (components/GymMap.jsx).
// What is kept and how the phone watches it: lib/gym-reminder.js.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { Section, Row, Switch, SearchField, Segmented, Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import GymMap from '../components/GymMap.jsx'
import { confirmSheet } from '../sheets.jsx'
import { platformNow } from '../lib/platform-now.js'
import { findPlaces, placeOfPick, addressAt, searchSource, fmtDistance, googleMapsUrl, appleMapsUrl } from '../lib/gym-places.js'
import {
  RADIUS_PRESETS, MAX_GYMS, DEFAULT_WINDOW, normConfig, normGym, statusOf,
  loadGymConfig, saveGymConfig, gymPermissions, askForegroundLocation, askBackgroundLocation,
  currentPosition, openAppSettings,
} from '../lib/gym-reminder.js'

const ios = () => platformNow() === 'ios'
// How long the search waits after the last key before it asks.
export const TYPE_PAUSE_MS = 350

// The one place a permission is explained before the system asks for it.
const explainAlways = () => new Promise(resolve => confirmSheet({
  title: ios() ? t('Allow location “Always”?') : t('Allow location “All the time”?'),
  message: <>
    <p>{t('To notice that you walked into your gym while openGym is closed, the phone needs to let it see your location in the background.')}</p>
    <p style={{ marginTop: 8 }}>{t('The phone itself watches the gyms you added and only wakes openGym when you arrive. No tracking in between, and your locations never leave this phone.')}</p>
    {!ios() && <p style={{ marginTop: 8 }}>{t('On the next screen, pick “Allow all the time”.')}</p>}
  </>,
  confirmText: t('Continue'),
  cancelText: t('Not now'),
  onConfirm: () => resolve(true),
  onCancel: () => resolve(false),
}))

const permLabel = p => !p ? '' : p.background === 'granted' ? (ios() ? t('Always') : t('All the time'))
  : p.location === 'granted' ? t('Only while using the app') : p.location === 'denied' ? t('Not allowed') : t('Not asked yet')

const noLocation = () => t('Location isn’t allowed for openGym. You can change that in the phone’s settings.')

// While-using location, asked for if it has not been yet. True when the phone may locate.
async function mayLocate() {
  let p = await gymPermissions()
  if (p?.location !== 'granted') p = await askForegroundLocation()
  return p?.location === 'granted'
}

// Where the phone is, without asking: only when location is already allowed (for "near me" in
// the search and the distances), else null.
async function whereQuietly() {
  const p = await gymPermissions()
  if (p?.location !== 'granted') return null
  const h = await currentPosition()
  return h ? { lat: h.lat, lng: h.lng } : null
}

const validPos = g => (Number.isFinite(g?.lat) && Number.isFinite(g?.lng) ? { lat: g.lat, lng: g.lng } : null)

export default function GymReminderPage() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [config, setConfig] = useState(null)
  const [perm, setPerm] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let gone = false
    loadGymConfig().then(r => { if (!gone) { setConfig(r.config); setPerm(r.permission) } })
    return () => { gone = true }
  }, [])
  // Back from the system settings: the answer may have changed there.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') gymPermissions().then(p => p && setPerm(p)) }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [])
  if (!config) return <Section><Row icon="mapPin" iconTint="var(--green)" title={t('Checking…')} /></Section>

  const save = async next => {
    const c = normConfig(next)
    setConfig(c)
    const r = await saveGymConfig(c, useStore.getState().S)
    if (r?.permission) setPerm(r.permission)
    return r
  }

  // Off → on: explain, then ask for location while in use, "Always", and notifications.
  const turnOn = async () => {
    setBusy(true)
    try {
      let p = await gymPermissions()
      if (p?.background !== 'granted') {
        if (!(await explainAlways())) return
        p = await askForegroundLocation()
        if (p?.location !== 'granted') { setPerm(p); toast(noLocation()); return }
        p = await askBackgroundLocation()
        setPerm(p)
        if (p?.background !== 'granted') { toast(t('Without background location the phone can’t spot your gym while openGym is closed.')); return }
      }
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        let n = await LocalNotifications.checkPermissions()
        if (n.display !== 'granted') n = await LocalNotifications.requestPermissions()
        if (n.display !== 'granted') toast(t('Notifications are off for openGym, so the reminder has nowhere to show up.'))
      } catch { /* no plugin: the native side posts anyway where it may */ }
      await save({ ...config, on: true })
    } finally { setBusy(false) }
  }
  const toggle = v => (v ? turnOn() : save({ ...config, on: false }))

  const full = config.gyms.length >= MAX_GYMS
  const edit = g => nav('/settings/gym-edit', { state: { id: g.id } })
  const add = () => nav('/settings/gym-find')

  const win = config.window
  const setWin = patch => save({ ...config, window: { ...(win || DEFAULT_WINDOW), ...patch } })

  return <>
    <Section footer={t('Walk into one of your gyms and openGym nudges you to hit Start. Once a day at most, and never when you already trained. Your gyms stay on this phone.')}>
      <Row icon="mapPin" iconTint="var(--green)" title={t('Gym reminder')}>
        <Switch checked={config.on} disabled={busy} onChange={toggle} aria-label={t('Gym reminder')} />
      </Row>
    </Section>
    {/* A plain grouped list like the rest of Settings: tap a gym to change it, the last row adds one. */}
    <Section title={t('Your gyms')} className="gym-list" footer={full ? t('That’s 20 gyms, the most a phone can watch.')
      : config.gyms.length ? null : t('No gyms yet.') + ' ' + t('Add the one you keep meaning to go to.')}>
      {config.gyms.map(g => <Row key={g.id} icon="mapPin" iconTint="var(--orange)" className={'gym-row' + (g.off ? ' off' : '')}
        title={g.name || t('My gym')} subtitle={[g.address, t('{0} m', g.radius)].filter(Boolean).join(' · ')}
        value={g.off ? t('Off') : null} accessory="chevron" onClick={() => edit(g)} />)}
      {!full && <Row icon="plusCircle" iconTint="var(--acc)" className="gym-add-row" title={t('Add a gym')} onClick={add} />}
    </Section>
    <Section footer={win ? t('Outside these hours the phone stays quiet, even at the gym.') : null}>
      <Row icon="clock" iconTint="var(--purple)" title={t('Only between certain hours')}>
        <Switch checked={!!win} onChange={v => save({ ...config, window: v ? { ...DEFAULT_WINDOW } : null })} aria-label={t('Only between certain hours')} />
      </Row>
      {win && <Row icon="sunrise" iconTint="var(--orange)" title={t('From')}>
        <input type="time" className="timef" value={win.from} aria-label={t('From')} onChange={e => e.target.value && setWin({ from: e.target.value })} />
      </Row>}
      {win && <Row icon="moon" iconTint="var(--indigo)" title={t('Until')}>
        <input type="time" className="timef" value={win.to} aria-label={t('Until')} onChange={e => e.target.value && setWin({ to: e.target.value })} />
      </Row>}
    </Section>
    {perm && <Section footer={perm.background === 'granted' ? null : perm.precise === false
      ? t('Precise location is off for openGym. Turn it on in the phone’s settings, or your gym can’t be spotted.')
      : t('The reminder needs location access in the background. You can allow it in the phone’s settings.')}>
      <Row icon="lock" iconTint="var(--grey)" title={t('Location access')} value={permLabel(perm)}
        accessory={perm.background === 'granted' ? 'none' : 'chevron'}
        onClick={perm.background === 'granted' ? undefined : () => openAppSettings()} />
    </Section>}
    {perm?.quick && perm.background === 'granted' && <Section footer={perm.quick === 'granted'
      ? t('Near a gym, the phone takes a short GPS look (a few minutes at most) so the nudge comes at the door.')
      : t('Android can take up to half an hour to notice you walked in. Set openGym’s battery use to Unrestricted and the phone takes a short GPS look when you get near a gym, so the nudge comes at the door.')}>
      <Row icon="bolt" iconTint="var(--orange)" title={t('Quick arrival check')} value={perm.quick === 'granted' ? t('On') : t('Off')}
        accessory={perm.quick === 'granted' ? 'none' : 'chevron'}
        onClick={perm.quick === 'granted' ? undefined : () => openAppSettings()} />
    </Section>}
  </>
}

/* ---------------- adding one: the search ---------------- */

// The little grey word on a result: what kind of place it is.
const hintOf = kind => kind === 'gym' ? t('Gym') : kind === 'sport' ? t('Sports centre')
  : kind === 'address' ? t('Address') : kind === 'area' ? t('Area') : ''

/**
 * Search first, like Apple Maps: the app's search field at the top, "Current location" as the
 * first row, then the results as you type (after a short pause, the newest question wins). A
 * tap opens the editor with the place filled in. `find` is for tests.
 */
export function GymFindPage({ find = findPlaces }) {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [status, setStatus] = useState('idle')
  const [near, setNear] = useState(null)
  const [source, setSource] = useState(null)
  const [locating, setLocating] = useState(false)
  const [picking, setPicking] = useState(null)
  const asked = useRef(0)
  useEffect(() => {
    let gone = false
    searchSource().then(s => { if (!gone) setSource(s) })
    whereQuietly().then(p => { if (!gone && p) setNear(p) })
    return () => { gone = true }
  }, [])
  const query = q.trim()
  useEffect(() => {
    const n = ++asked.current
    if (query.length < 2) { setHits(null); setStatus('idle'); return }
    setStatus('busy')
    const timer = setTimeout(async () => {
      try {
        const r = await find(query, { near })
        if (n !== asked.current || r === null) return
        setHits(r); setStatus('idle')
      } catch { if (n === asked.current) setStatus('error') }
    }, TYPE_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [query, near?.lat, near?.lng])

  const open = draft => nav('/settings/gym-edit', { state: { draft, from: 'find' } })
  const pick = async h => {
    if (picking) return
    setPicking(h.id)
    let p = null
    try { p = await placeOfPick(h) } catch { /* answered below */ }
    setPicking(null)
    if (!p) { toast(t('The search didn’t answer. Try again in a moment.')); return }
    open({ name: p.name || '', address: p.address || '', lat: p.lat, lng: p.lng })
  }
  const here = async () => {
    if (locating) return
    if (!(await mayLocate())) { toast(noLocation()); return }
    setLocating(true)
    const h = await currentPosition()
    setLocating(false)
    if (h) open({ name: '', address: '', lat: h.lat, lng: h.lng })
    else toast(t('Couldn’t find where you are. Try the search instead.'))
  }

  const results = query.length < 2 ? null
    : status === 'error' && !hits?.length ? <Row className="gym-hit-none" title={t('The search didn’t answer. Try again in a moment.')} />
      : hits === null ? <Row className="gym-hit-none" title={t('Searching…')} />
        : !hits.length ? (status === 'busy' ? <Row className="gym-hit-none" title={t('Searching…')} /> : <Row className="gym-hit-none" title={t('Nothing found. Try a street and a town.')} />)
          : hits.map(h => <Row key={h.id} className={'gym-hit' + (picking === h.id ? ' busy' : '')}
            icon={h.fitness ? 'dumbbell' : 'mapPin'} iconTint={h.fitness ? 'var(--acc)' : 'var(--grey)'}
            title={h.name} subtitle={[fmtDistance(h.distance), hintOf(h.kind), h.address].filter(Boolean).join(' · ')}
            onClick={() => pick(h)} />)

  return <>
    <div className="gym-find-bar" role="search">
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} autoFocus
        placeholder={t('Find your gym…')} aria-label={t('Find your gym…')} inputMode="search" enterKeyHint="search"
        autoComplete="off" autoCorrect="off" spellCheck={false} />
    </div>
    <p className="gym-find-note">{source === 'apple' ? t('Searches go to Apple Maps. Your gyms stay on this phone.') : t('Searches go to OpenStreetMap. Your gyms stay on this phone.')}</p>
    <Section>
      <Row icon="location" iconTint="var(--blue)" className="gym-here" title={t('Current location')}
        subtitle={locating ? t('Finding you…') : null} onClick={here} />
    </Section>
    {results && <Section className="gym-hits" footer={source === 'osm' && hits?.length ? '© OpenStreetMap' : null}>
      <div aria-live="polite" aria-busy={status === 'busy'}>{results}</div>
    </Section>}
  </>
}

/* ---------------- one gym: confirm or change it ---------------- */

const PRESETS = [RADIUS_PRESETS.small, RADIUS_PRESETS.medium, RADIUS_PRESETS.large]

export function GymEditPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const toast = useUI(s => s.toast)
  const S = useStore(s => s.S)
  const [config, setConfig] = useState(null)
  const [gym, setGym] = useState(null)
  const [locating, setLocating] = useState(false)
  const editId = loc.state?.id || null
  const fromFind = loc.state?.from === 'find'
  useEffect(() => {
    let gone = false
    loadGymConfig().then(({ config: c }) => {
      if (gone) return
      setConfig(c)
      const have = editId && c.gyms.find(g => g.id === editId)
      const d = loc.state?.draft || {}
      setGym(have ? { ...have } : validPos(d)
        ? { id: null, name: String(d.name || '').slice(0, 60), address: d.address || '', lat: d.lat, lng: d.lng, radius: d.radius || RADIUS_PRESETS.medium, text: '' }
        : false)
    })
    return () => { gone = true }
  }, [])
  // Opened with nothing to show (no place yet, a gym that is gone): the search, or the list.
  useEffect(() => {
    if (config && gym === false) nav(editId ? '/settings/gym' : '/settings/gym-find', { replace: true })
  }, [config, gym])
  // A spot without an address (Current location, a pin moved by hand): look it up once the map
  // has been still for a moment, for the list's second line.
  const pos = validPos(gym)
  useEffect(() => {
    if (!pos || gym.address) return
    let gone = false
    const at = pos
    const timer = setTimeout(() => {
      addressAt(at).then(a => { if (!gone && a) setGym(g => (g && g.lat === at.lat && g.lng === at.lng && !g.address ? { ...g, address: a } : g)) })
    }, 900)
    return () => { gone = true; clearTimeout(timer) }
  }, [pos?.lat, pos?.lng, gym?.address])
  if (!config || !gym) return null

  const set = patch => setGym(g => ({ ...g, ...patch }))
  // Back to the list: past the search too when the gym came from it.
  const close = () => {
    const idx = window.history.state?.idx || 0
    if (fromFind && idx > 1) nav(-2)
    else if (!fromFind && idx > 0) nav(-1)
    else nav('/settings/gym', { replace: true })
  }
  // The map came to rest somewhere else: the address the search found no longer says where it is.
  const moved = p => set({ lat: p.lat, lng: p.lng, address: '' })
  const locate = async () => {
    if (!(await mayLocate())) { toast(noLocation()); return }
    setLocating(true)
    const h = await currentPosition()
    setLocating(false)
    if (h) moved(h)
    else toast(t('Couldn’t find where you are. Try the search instead.'))
  }
  const save = async () => {
    const g = normGym({ ...gym, id: gym.id || undefined })
    if (!g) return
    const gyms = gym.id ? config.gyms.map(x => (x.id === gym.id ? g : x)) : [...config.gyms, g]
    await saveGymConfig({ ...config, gyms }, S)
    close()
  }
  const remove = () => confirmSheet({
    title: t('Remove this gym?'),
    message: t('No more nudges when you arrive here.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: async () => { await saveGymConfig({ ...config, gyms: config.gyms.filter(x => x.id !== gym.id) }, S); close() },
  })
  const radii = PRESETS.includes(gym.radius) ? PRESETS : [...PRESETS, gym.radius].sort((a, b) => a - b)
  const sizeName = r => r === RADIUS_PRESETS.small ? t('Small') : r === RADIUS_PRESETS.medium ? t('Medium') : r === RADIUS_PRESETS.large ? t('Large') : t('Custom')
  const mapsLink = () => window.open(ios() ? appleMapsUrl(pos, gym.name) : googleMapsUrl(pos), '_blank', 'noopener')

  return <>
    <div className="gmap">
      <GymMap pos={pos} radius={gym.radius} onMove={moved} label={t('Drag the map to put the pin on your gym.')} />
      <span className="gmap-pin" aria-hidden="true"><span /></span>
      <button type="button" className="gmap-locate" onClick={locate} disabled={locating} aria-label={t('Show where I am')}><Icon name="location" /></button>
    </div>
    <p className="sect-f gmap-hint">
      {gym.address && <span className="gmap-addr">{gym.address}</span>}
      <span>{t('Drag the map to put the pin on your gym.')}</span>
    </p>
    <Section>
      <label className="lrow gym-in-row">
        <span className="lrow-i" style={{ '--tint': 'var(--orange)' }}><Icon name="pencil" /></span>
        <span className="lrow-m"><span className="lrow-t">{t('Name')}</span></span>
        <input className="lrow-in" value={gym.name} maxLength={60} placeholder={t('My gym')} aria-label={t('Name')}
          enterKeyHint="done" autoComplete="off" onChange={e => set({ name: e.target.value })} />
      </label>
      <Row icon="bell" iconTint="var(--red)" title={t('Remind me here')}>
        <Switch checked={!gym.off} onChange={v => set({ off: !v })} aria-label={t('Remind me here')} />
      </Row>
    </Section>
    <Section title={t('Radius')} footer={t('Medium fits most gyms. Go bigger if the nudge comes late, smaller if it pings you on the street.')}>
      <div className="lrow gym-radius" role="group" aria-label={t('Radius')}>
        <Segmented value={gym.radius} onChange={v => set({ radius: v })}
          options={radii.map(r => ({ value: r, label: <span className="gym-size"><b>{sizeName(r)}</b><small>{t('{0} m', r)}</small></span> }))} />
      </div>
    </Section>
    <Section title={t('Notification text')} footer={t('Leave it empty for the default.')}>
      <div className="lrow gym-in-row">
        <input className="lrow-in full" value={gym.text} maxLength={120} placeholder={statusOf(null).body} aria-label={t('Notification text')}
          enterKeyHint="done" onChange={e => set({ text: e.target.value })} />
      </div>
    </Section>
    <div className="gym-actions">
      <Button variant="primary" onClick={save} disabled={!pos}>{t('Save')}</Button>
    </div>
    <Section>
      <Row icon="map" iconTint="var(--blue)" title={ios() ? t('Open in Apple Maps') : t('Open in Google Maps')} accessory="chevron" onClick={mapsLink} />
    </Section>
    {gym.id && <Section>
      <Row className="gym-remove" danger title={t('Remove')} onClick={remove} />
    </Section>}
  </>
}
