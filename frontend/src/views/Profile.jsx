import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { streakWeeks } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import ProfileAvatar from '../components/ProfileAvatar.jsx'
import { Button, Row, Section, Segmented, Switch, TextField } from '../components/ui.jsx'
import Stats from './Stats.jsx'
import Social from './Social.jsx'
import '../profile.css'

const VIEW_KEY = 'opengym_profile_view'
const AVATAR_BYTES = 128 * 1024

const dataBytes = value => Math.ceil((value.length - value.indexOf(',') - 1) * 3 / 4)

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('This photo could not be opened.'))) }
    image.src = url
  })
}

async function prepareAvatar(file) {
  if (!file?.type.startsWith('image/')) throw new Error(t('Choose an image file.'))
  if (file.size > 10 * 1024 * 1024) throw new Error(t('Choose a photo smaller than 10 MB.'))
  const image = await loadPhoto(file)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const x = (image.naturalWidth - side) / 2
  const y = (image.naturalHeight - side) / 2
  canvas.getContext('2d').drawImage(image, x, y, side, side, 0, 0, 256, 256)
  const encodings = [
    ['image/webp', .82], ['image/webp', .68], ['image/jpeg', .82], ['image/jpeg', .68]
  ]
  for (const [type, quality] of encodings) {
    const value = canvas.toDataURL(type, quality)
    if (value.startsWith(`data:${type}`) && dataBytes(value) <= AVATAR_BYTES) return value
  }
  throw new Error(t('This photo could not be made small enough.'))
}

function EditProfileSheet({ user, close }) {
  const setUser = useStore(s => s.setUser)
  const toast = useUI(s => s.toast)
  const [name, setName] = useState(user.name)
  const [avatar, setAvatar] = useState(user.avatar || null)
  const [shareBodyWeight, setShareBodyWeight] = useState(user.shareBodyWeight !== false)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  const pick = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try { setAvatar(await prepareAvatar(file)) }
    catch (e) { toast(e.message) }
    finally { setBusy(false) }
  }
  const save = async () => {
    const nextName = name.trim()
    if (!nextName) { toast(t('Enter a name')); return }
    setBusy(true)
    try {
      const result = await api('/api/profile', {
        method: 'POST', body: JSON.stringify({ name: nextName, avatar, shareBodyWeight })
      })
      setUser(result.user)
      close()
      toast(t('Profile updated'))
    } catch (e) { toast(e.message || t('Profile could not be updated')) }
    finally { setBusy(false) }
  }

  return <>
    <h3>{t('Edit profile')}</h3>
    <div className="profile-edit-photo">
      <ProfileAvatar name={name} avatar={avatar} size="xl" />
      <div className="profile-edit-photo-actions">
        <Button size="sm" variant="tinted" icon="camera" disabled={busy} onClick={() => input.current?.click()}>{t('Choose photo')}</Button>
        {avatar && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAvatar(null)}>{t('Remove photo')}</Button>}
      </div>
      <input ref={input} className="profile-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} />
    </div>
    <label className="social-label" htmlFor="profile-name">{t('Name')}</label>
    <TextField id="profile-name" maxLength={40} value={name} onChange={event => setName(event.target.value)} />
    <p className="small muted profile-photo-note">{t('Photos are centre-cropped and stored only on your openGym server.')}</p>
    <Section title={t('Privacy')}>
      <Row icon="scale" iconTint="var(--teal)" title={t('Share body weight with friends')}
        subtitle={t('Accepted friends can see your latest weight and 30-day change.')}>
        <Switch checked={shareBodyWeight} onChange={setShareBodyWeight} />
      </Row>
    </Section>
    <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>{busy ? t('Saving…') : t('Save')}</Button>
  </>
}

function savedView() {
  try {
    const value = localStorage.getItem(VIEW_KEY)
    return value === 'social' ? 'social' : 'stats'
  } catch { return 'stats' }
}

export default function Profile() {
  const nav = useNavigate()
  const loc = useLocation()
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const socialCount = useUI(s => s.socialCount)
  const requested = new URLSearchParams(loc.search).get('view')
  const view = requested === 'stats' || requested === 'social' ? requested : savedView()
  const positions = useRef({ stats: 0, social: 0 })
  const pendingScroll = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* private browsing can refuse storage */ }
  }, [view])
  useLayoutEffect(() => {
    if (pendingScroll.current !== view) return
    const frame = requestAnimationFrame(() => window.scrollTo(0, positions.current[view] || 0))
    pendingScroll.current = null
    return () => cancelAnimationFrame(frame)
  }, [view])

  const chooseView = next => {
    if (next === view) return
    positions.current[view] = window.scrollY
    pendingScroll.current = next
    nav(`/profile?view=${next}`, { replace: true })
  }
  const name = user?.name || t('Local profile')
  const summary = [
    t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length),
    t('{0} week streak', streakWeeks(S))
  ].join(' · ')
  const edit = () => openSheet(close => <EditProfileSheet user={user} close={close} />)
  const socialLabel = <span className="profile-tab-label">{t('Social')}
    {socialCount > 0 && <b aria-label={t('{0} pending items', socialCount)}>{socialCount > 99 ? '99+' : socialCount}</b>}</span>

  return <div className="profile-page">
    <div className="hdr"><div><h1>{t('Profile')}</h1><div className="sub">{t('Your training identity')}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button></div>

    <section className="card profile-identity">
      <ProfileAvatar name={name} avatar={user?.avatar} size="xl" editable={!!user} onClick={user ? edit : undefined}
        label={t('Edit profile photo')} />
      <div className="profile-identity-copy">
        <h2>{name}</h2>
        <p>{summary}</p>
        {user ? <Button size="sm" variant="tinted" icon="pencil" onClick={edit}>{t('Edit profile')}</Button>
          : <span className="small muted">{t('Stored only on this device')}</span>}
      </div>
    </section>

    <div className="profile-tabs-shell">
      <Segmented className="profile-tabs" value={view} onChange={chooseView} tablist ariaLabel={t('Profile sections')}
        options={[{ value: 'stats', label: t('Stats'), controls: 'profile-stats' },
          { value: 'social', label: socialLabel, controls: 'profile-social' }]} />
    </div>

    <section key={view} id={`profile-${view}`} className="profile-panel" role="tabpanel">
      {view === 'stats' ? <Stats embedded /> : <Social embedded />}
    </section>
  </div>
}
