// Settings → Reminders → Gym reminder (#614), phone app only: the gyms that get you a nudge when
// you walk in, and the editor for one of them (a pin on an OpenStreetMap map, a radius, a text).
// What is kept and how the phone watches it: lib/gym-reminder.js.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { t, getLang } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { Section, Row, Switch, Slider, TextField, Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import { platformNow } from '../lib/platform-now.js'
import { nativeFetch } from '../lib/capacitor-fetch.js'
import {
  RADIUS, MAX_GYMS, DEFAULT_WINDOW, normConfig, normGym, statusOf,
  loadGymConfig, saveGymConfig, gymPermissions, askForegroundLocation, askBackgroundLocation,
  currentPosition, openAppSettings,
} from '../lib/gym-reminder.js'

// Asked only on an explicit tap of Search, never while typing (Nominatim's usage policy), with a
// User-Agent that says who is asking.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'openGym/' + (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev') + ' (gym reminder; +https://opengym.ch)'
export async function searchAddress(q, fetcher = nativeFetch) {
  const query = String(q || '').trim()
  if (!query) return []
  const url = NOMINATIM + '?format=jsonv2&limit=5&q=' + encodeURIComponent(query) + '&accept-language=' + encodeURIComponent(getLang() || 'en')
  const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) throw new Error('search failed: ' + res.status)
  const rows = await res.json()
  return (Array.isArray(rows) ? rows : []).map(r => ({ lat: Number(r.lat), lng: Number(r.lon), label: String(r.display_name || '') }))
    .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
}

const ios = () => platformNow() === 'ios'

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
        if (p?.location !== 'granted') { setPerm(p); toast(t('Location isn’t allowed for openGym. You can change that in the phone’s settings.')); return }
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
  const addHere = async () => {
    let p = await gymPermissions()
    if (p?.location !== 'granted') p = await askForegroundLocation()
    if (p?.location !== 'granted') { toast(t('Location isn’t allowed for openGym. You can change that in the phone’s settings.')); return }
    toast(t('Finding you…'))
    const here = await currentPosition()
    if (!here) { toast(t('Couldn’t find where you are. Try the map instead.')); return }
    nav('/settings/gym-edit', { state: { draft: { lat: here.lat, lng: here.lng } } })
  }
  const add = () => menuSheet({
    title: t('Add a gym'),
    items: [
      { icon: 'mapPin', label: t('I’m at the gym right now'), sub: t('Uses where your phone is'), onClick: addHere },
      { icon: 'globe', label: t('Pick it on the map'), sub: t('Search an address or drag the pin'), onClick: () => nav('/settings/gym-edit', { state: { draft: {} } }) },
    ],
  })

  const win = config.window
  const setWin = patch => save({ ...config, window: { ...(win || DEFAULT_WINDOW), ...patch } })

  return <>
    <Section footer={t('Walk into one of your gyms and openGym nudges you to hit Start. Once a day at most, and never when you already trained. Your gyms stay on this phone.')}>
      <Row icon="mapPin" iconTint="var(--green)" title={t('Gym reminder')}>
        <Switch checked={config.on} disabled={busy} onChange={toggle} aria-label={t('Gym reminder')} />
      </Row>
    </Section>
    <Section title={t('Your gyms')} footer={full ? t('That’s 20 gyms, the most a phone can watch.') : null}>
      {config.gyms.map(g => (
        <Row key={g.id} icon="mapPin" iconTint="var(--orange)" title={g.name || t('My gym')}
          subtitle={t('{0} m around the pin', g.radius) + (g.text ? ' · ' + g.text : '')} accessory="chevron"
          onClick={() => nav('/settings/gym-edit', { state: { id: g.id } })} />
      ))}
      {!full && <Row icon="plusCircle" iconTint="var(--green)" title={t('Add a gym')} accessory="chevron" onClick={add} />}
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

/* ---------------- one gym ---------------- */

// The map: OpenStreetMap tiles through Leaflet, loaded only when this page opens (and only in the
// phone app; the web build never has the page). Tap the map or drag the pin; the circle is the radius.
function GymMap({ pos, radius, onPick, label }) {
  const host = useRef(null)
  const live = useRef(null)
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    let gone = false
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([mod]) => {
      const L = mod.default || mod
      if (gone || !host.current) return
      const start = pos || { lat: 20, lng: 0 }
      const map = L.map(host.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], pos ? 17 : 2)
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>')
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }).addTo(map)
      const icon = L.divIcon({ className: 'gym-pin', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 30] })
      const marker = L.marker([start.lat, start.lng], { draggable: true, icon, title: label, alt: label, opacity: pos ? 1 : 0 }).addTo(map)
      const circle = L.circle([start.lat, start.lng], { radius, className: 'gym-radius', interactive: false, opacity: pos ? 1 : 0, fillOpacity: pos ? 0.15 : 0 }).addTo(map)
      const moveTo = ll => { marker.setLatLng(ll); circle.setLatLng(ll); marker.setOpacity(1); circle.setStyle({ opacity: 1, fillOpacity: 0.15 }); pick.current({ lat: ll.lat, lng: ll.lng }) }
      marker.on('drag', e => circle.setLatLng(e.target.getLatLng()))
      marker.on('dragend', e => moveTo(e.target.getLatLng()))
      map.on('click', e => moveTo(e.latlng))
      live.current = { map, marker, circle }
      // The page may still be sliding in: measure once it sits.
      setTimeout(() => { if (!gone) map.invalidateSize() }, 350)
    }).catch(() => {})
    return () => { gone = true; live.current?.map.remove(); live.current = null }
  }, [])
  // A new place from outside (a search result, "use my location"): the pin and the view follow.
  useEffect(() => {
    const m = live.current
    if (!m || !pos) return
    const cur = m.marker.getLatLng()
    if (Math.abs(cur.lat - pos.lat) < 1e-7 && Math.abs(cur.lng - pos.lng) < 1e-7 && m.marker.options.opacity === 1) return
    m.marker.setLatLng([pos.lat, pos.lng]); m.circle.setLatLng([pos.lat, pos.lng])
    m.marker.setOpacity(1); m.circle.setStyle({ opacity: 1, fillOpacity: 0.15 })
    m.map.setView([pos.lat, pos.lng], Math.max(m.map.getZoom(), 16))
  }, [pos?.lat, pos?.lng])
  useEffect(() => { live.current?.circle.setRadius(radius) }, [radius])
  return <div className="gym-map" ref={host} role="application" aria-label={label} />
}

export function GymEditPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const toast = useUI(s => s.toast)
  const S = useStore(s => s.S)
  const [config, setConfig] = useState(null)
  const [gym, setGym] = useState(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [searching, setSearching] = useState(false)
  const editId = loc.state?.id || null
  useEffect(() => {
    let gone = false
    loadGymConfig().then(({ config: c }) => {
      if (gone) return
      setConfig(c)
      const have = editId && c.gyms.find(g => g.id === editId)
      const d = loc.state?.draft || {}
      setGym(have ? { ...have } : { id: null, name: '', lat: d.lat ?? null, lng: d.lng ?? null, radius: RADIUS.def, text: '' })
    })
    return () => { gone = true }
  }, [])
  // Opened with nothing to show (no draft, a gym that is gone): back to the list.
  useEffect(() => { if (config && !gym) nav('/settings/gym', { replace: true }) }, [config, gym])
  if (!config || !gym) return null

  const pos = Number.isFinite(gym.lat) && Number.isFinite(gym.lng) ? { lat: gym.lat, lng: gym.lng } : null
  const set = patch => setGym(g => ({ ...g, ...patch }))
  const close = () => { if ((window.history.state?.idx || 0) > 0) nav(-1); else nav('/settings/gym', { replace: true }) }

  const search = async () => {
    if (!q.trim()) return
    setSearching(true)
    try {
      const r = await searchAddress(q)
      setHits(r)
      if (r.length === 1) { set({ lat: r[0].lat, lng: r[0].lng }); setHits(null) }
    } catch { toast(t('The address search didn’t answer. Try again in a moment.')) }
    setSearching(false)
  }
  const here = async () => {
    let p = await gymPermissions()
    if (p?.location !== 'granted') p = await askForegroundLocation()
    if (p?.location !== 'granted') { toast(t('Location isn’t allowed for openGym. You can change that in the phone’s settings.')); return }
    const h = await currentPosition()
    if (h) set({ lat: h.lat, lng: h.lng })
    else toast(t('Couldn’t find where you are. Try the map instead.'))
  }
  const save = async () => {
    const g = normGym({ ...gym, id: gym.id || undefined })
    if (!g) { toast(t('Tap the map to put the pin on your gym first.')); return }
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
  const fallback = statusOf(null).body

  return <>
    <Section>
      <div className="gym-search">
        <TextField value={q} onChange={e => setQ(e.target.value)} placeholder={t('Search an address')} aria-label={t('Search an address')}
          inputMode="search" enterKeyHint="search" autoComplete="off" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
        <Button variant="tinted" onClick={search} disabled={searching || !q.trim()}>{searching ? t('Searching…') : t('Search')}</Button>
      </div>
      {hits && (hits.length
        ? hits.map((h, i) => <Row key={i} icon="mapPin" iconTint="var(--grey)" title={h.label} onClick={() => { set({ lat: h.lat, lng: h.lng }); setHits(null) }} />)
        : <Row icon="info" iconTint="var(--grey)" title={t('Nothing found. Try a street and a town.')} />)}
    </Section>
    <div className="gym-map-wrap">
      <GymMap pos={pos} radius={gym.radius} onPick={p => set(p)} label={t('Tap the map or drag the pin onto your gym.')} />
      <p className="sect-f">{t('Tap the map or drag the pin onto your gym.')} {t('The address search asks OpenStreetMap (Nominatim), and only when you tap Search.')}</p>
    </div>
    <Section>
      <Row icon="mapPin" iconTint="var(--blue)" title={t('Use my location')} accessory="chevron" onClick={here} />
    </Section>
    <Section title={t('Radius')} footer={t('About 100 m fits most gyms. Bigger if the phone notices you late, smaller if it pings you on the street outside.')}>
      <div className="gym-radius-row">
        <Slider value={gym.radius} min={RADIUS.min} max={RADIUS.max} step={RADIUS.step} onChange={v => set({ radius: v })} />
        <span className="gym-radius-val">{t('{0} m', gym.radius)}</span>
      </div>
    </Section>
    <Section title={t('Name')}>
      <div className="gym-field"><TextField value={gym.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder={t('My gym')} aria-label={t('Name')} /></div>
    </Section>
    <Section title={t('Notification text')} footer={t('Leave it empty for the default.')}>
      <div className="gym-field"><TextField value={gym.text} maxLength={120} onChange={e => set({ text: e.target.value })} placeholder={fallback} aria-label={t('Notification text')} /></div>
    </Section>
    <div className="gym-actions">
      <Button variant="primary" onClick={save} disabled={!pos}>{t('Save')}</Button>
      {gym.id && <Button variant="danger" icon="trash" onClick={remove}>{t('Remove')}</Button>}
    </div>
  </>
}
