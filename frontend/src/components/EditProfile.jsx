import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import ProfileAvatar from './ProfileAvatar.jsx'
import { Button, Row, Section, Switch, TextField } from './ui.jsx'
import '../profile.css'

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

export default function EditProfile({ user, close }) {
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

