// The profile picture (lib/avatar.js): the round face on the Settings account card, and the
// editor on the Account page. A photo is picked with a plain file input (the camera or the library
// on a phone, through the WebView's own chooser: no plugin), framed in a round crop (drag, pinch,
// the wheel, the slider or the keyboard), drawn into a 256 px square and kept in the media store
// like any other photo of the profile. Without a picture, while it loads, offline or when its file
// never arrives, the first letter of the name shows, as it always did.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { mediaStore } from '../lib/media-store.js'
import { avatarOf, initialOf, setAvatarPhoto, setAvatarPreset, clearAvatar, AVATAR_PRESETS, clampCrop, coverScale, zoomAround, ZOOM_MAX, openAvatarImage, renderAvatar } from '../lib/avatar.js'
import { useMediaUrl } from './CustomMedia.jsx'
import { mediaErrorText } from './CustomMediaField.jsx'
import Glyph from './Glyph.jsx'
import Icon from './Icon.jsx'
import { Section, Row, Button } from './ui.jsx'

const toast = m => useUI.getState().toast(m)
const VIEW = 264   // px, the crop viewport: fits a 320 px phone inside the sheet's padding

/** The sentence for a picked file that cannot be a picture. */
import { PinnedBadges, profileBadgesSheet } from './Streak.jsx'
import { streakInfo } from '../lib/streak.js'
import { isOn } from '../lib/modules.js'

export function avatarErrorText(e) {
  if (e?.code === 'type') return t('That isn’t a photo. Try a JPEG, PNG, WebP or HEIC.')
  return mediaErrorText(e)
}

/**
 * The round face: the photo, else the built-in picture, else the name's first letter, else the
 * person icon. `name` is whose letter to show (null: no letter, the icon). Decorative; the name is
 * always written beside it.
 */
export function AvatarFace({ name = null, className = 'sp-avatar' }) {
  const S = useStore(s => s.S)
  const a = avatarOf(S)
  const photo = a?.type === 'photo' ? a.m : null
  const { url, status } = useMediaUrl(photo)
  const [broken, setBroken] = useState(null)
  const initial = initialOf(name)
  const showPhoto = photo && status === 'ready' && url && broken !== url
  const kind = showPhoto ? 'photo' : a?.type === 'preset' ? 'preset' : initial ? 'letter' : 'none'
  return <span className={className + (kind !== 'none' ? ' on' : '') + ' av-' + kind} aria-hidden="true" data-avatar={kind}>
    {showPhoto ? <img src={url} alt="" draggable="false" decoding="async" onError={() => setBroken(url)} />
      : kind === 'preset' ? <Glyph icon={a.icon} emoji={a.emoji} />
      : initial || <Icon name="personCircle" />}
  </span>
}

/** The editor on the Account page: the face, then choose, icons, remove. */
export function AvatarSection({ name, signedIn }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const a = avatarOf(S)
  // It goes to the other devices only through a server that says it keeps it (media.avatar).
  const synced = useStore(s => !!(signedIn && s.config?.media?.avatar))
  const file = useRef(null)
  const pick = () => file.current?.click()
  const onFile = ev => {
    const f = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (f) openCrop(f)
  }
  const remove = () => {
    update(s => { clearAvatar(s) })
    toast(t('Picture removed. Back to the letter.'))
  }
  return <Section title={t('Profile picture')}
    footer={synced ? t('Only you see it, here and on your other devices. Not even an admin can.') : t('Only you see it, and it stays on this device.')}>
    <div className="lrow av-edit">
      <button type="button" className="av-edit-face" onClick={pick} aria-label={t('Choose a photo')}>
        <AvatarFace name={name} className="sp-avatar av-lg" />
        <span className="av-edit-badge" aria-hidden="true"><Icon name="camera" /></span>
      </button>
    </div>
    <Row icon="image" iconTint="var(--acc)" title={t('Choose a photo')} accessory="chevron" onClick={pick} />
    <Row icon="smile" iconTint="var(--orange)" title={t('Pick an icon')} accessory="chevron"
      onClick={() => useUI.getState().openSheet(close => <AvatarPresetSheet close={close} />)} />
    {/* Badges pinned beside the picture (lib/levels.js); the same sheet as Stats → Week streak → Level. */}
    {isOn(S, 'motivation') && <Row icon="medal" iconTint="var(--yellow)" title={t('Badges on your profile')} accessory="chevron"
      value={<PinnedBadges />} onClick={() => profileBadgesSheet(streakInfo(S))} />}
    {a && <Row icon="trash" iconTint="var(--red)" title={t('Remove picture')} danger onClick={remove} />}
    {/* accept image/*: the phone's own chooser offers the camera and the library. */}
    <input ref={file} type="file" accept="image/*" hidden onChange={onFile} data-avatar-input />
  </Section>
}

export function openCrop(file) {
  return useUI.getState().openSheet(close => <AvatarCropSheet file={file} close={close} />)
}

function AvatarPresetSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const cur = avatarOf(S)
  const choose = id => {
    update(s => { setAvatarPreset(s, id) })
    close()
    toast(t('Picture set. Looking sharp.'))
  }
  return <>
    <h3>{t('Pick an icon')}</h3>
    <div className="av-presets" role="list">
      {AVATAR_PRESETS.map(p => {
        const on = cur?.type === 'preset' && cur.id === p.id
        return <button key={p.id} type="button" role="listitem" className={'av-preset' + (on ? ' on' : '')} aria-pressed={on}
          aria-label={p.emoji} onClick={() => choose(p.id)} data-avatar-preset={p.id}>
          <Glyph icon={p.icon} emoji={p.emoji} />
        </button>
      })}
    </div>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

function AvatarCropSheet({ file, close }) {
  const update = useStore(s => s.update)
  const [pic, setPic] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0, zoom: 1 })
  const [busy, setBusy] = useState(false)
  const canvas = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const view = useRef(null)

  useEffect(() => {
    let alive = true
    let opened = null
    ;(async () => {
      try {
        opened = await openAvatarImage(file)
        if (alive) setPic(opened); else opened.close()
      } catch (e) {
        if (!alive) return
        close()
        toast(avatarErrorText(e))
      }
    })()
    return () => { alive = false; opened?.close() }
  }, [file])

  useEffect(() => {
    const c = canvas.current
    if (!pic || !c) return
    c.width = pic.width
    c.height = pic.height
    c.getContext('2d').drawImage(pic.source, 0, 0)
    return () => { c.width = 0; c.height = 0 }
  }, [pic])

  const set = next => setCrop(pic ? clampCrop(pic, VIEW, next) : next)
  // A point of the viewport, from its centre, in CSS px.
  const local = e => {
    const r = view.current.getBoundingClientRect()
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
  }
  const onDown = e => {
    if (!pic) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    pinch.current = null
  }
  const onMove = e => {
    const ps = pointers.current
    if (!pic || !ps.has(e.pointerId)) return
    const prev = ps.get(e.pointerId)
    const p = local(e)
    ps.set(e.pointerId, p)
    if (ps.size === 1) { setCrop(c => clampCrop(pic, VIEW, { ...c, x: c.x + p.x - prev.x, y: c.y + p.y - prev.y })); return }
    const [a, b] = [...ps.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const last = pinch.current
    pinch.current = { dist, mid }
    if (!last || !last.dist) return
    setCrop(c => {
      const z = zoomAround(pic, VIEW, c, dist / last.dist, mid.x, mid.y)
      return clampCrop(pic, VIEW, { ...z, x: z.x + mid.x - last.mid.x, y: z.y + mid.y - last.mid.y })
    })
  }
  const onUp = e => { pointers.current.delete(e.pointerId); pinch.current = null }
  const onWheel = e => {
    if (!pic) return
    const p = local(e)
    setCrop(c => zoomAround(pic, VIEW, c, Math.exp(-e.deltaY / 400), p.x, p.y))
  }
  const onKey = e => {
    if (!pic) return
    const step = e.shiftKey ? 40 : 10
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (moves[e.key]) { e.preventDefault(); set({ ...crop, x: crop.x + moves[e.key][0], y: crop.y + moves[e.key][1] }); return }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setCrop(zoomAround(pic, VIEW, crop, 1.15)) }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); setCrop(zoomAround(pic, VIEW, crop, 1 / 1.15)) }
  }
  // Zoom is wheel-only on a desktop; keep the page from scrolling under it.
  useEffect(() => {
    const el = view.current
    if (!el) return
    const stop = e => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  const save = async () => {
    if (!pic || busy) return
    setBusy(true)
    try {
      const out = await renderAvatar(pic, VIEW, crop)
      // Pending: the sync sends it to a server that keeps avatars (media.avatar); anywhere else it
      // stays here, which is all a phone without a server or a guest needs.
      await mediaStore.put(out.media.hash, out.blob, { mime: out.media.mime, pending: true })
      update(s => { setAvatarPhoto(s, out.media) })
      close()
      toast(t('Picture set. Looking sharp.'))
    } catch (e) {
      toast(avatarErrorText(e))
      setBusy(false)
    }
  }

  const s = pic ? coverScale(pic, VIEW) * crop.zoom : 1
  const tx = pic ? VIEW / 2 - (pic.width * s) / 2 + crop.x : 0
  const ty = pic ? VIEW / 2 - (pic.height * s) / 2 + crop.y : 0
  return <>
    <h3>{t('Frame your best side')}</h3>
    <div className="muted small av-crop-hint">{t('Drag to move, pinch or slide to zoom.')}</div>
    <div ref={view} className={'av-crop' + (pic ? '' : ' loading')} style={{ width: VIEW, height: VIEW }} data-nodrag
      tabIndex={0} role="img" aria-label={t('Photo crop. Arrow keys move it, plus and minus zoom.')}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onKeyDown={onKey}>
      <canvas ref={canvas} className="av-crop-img" style={pic ? { width: pic.width, height: pic.height, transform: `translate3d(${tx}px, ${ty}px, 0) scale(${s})` } : { display: 'none' }} />
      <span className="av-crop-ring" aria-hidden="true" />
    </div>
    <label className="av-zoom">
      <Icon name="minus" />
      <input type="range" min="1" max={ZOOM_MAX} step="0.01" value={crop.zoom} disabled={!pic} aria-label={t('Zoom')}
        onChange={e => setCrop(c => (pic ? zoomAround(pic, VIEW, c, Number(e.target.value) / c.zoom) : c))} />
      <Icon name="plus" />
    </label>
    <Button variant="primary" onClick={save} disabled={!pic || busy}>{busy ? t('Loading…') : t('Use this photo')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
