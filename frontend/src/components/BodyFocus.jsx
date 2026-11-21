import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { isOn } from '../lib/modules.js'
import {
  AREAS, areaOfMuscle, toggleArea, focusMuscles, exploreHref, loadFocus, saveFocus,
  poseProblem, areasFromPose, hitArea, toPhoto,
} from '../lib/body-focus.js'
import { photoStore, preparePhoto, detectPose } from '../lib/body-photo.js'
import BodyMap from './BodyMap.jsx'
import CardHead from './CardHead.jsx'
import { Button, Segmented } from './ui.jsx'
import './body-focus.css'

/* Today's body picker (Ironvane, module 'bodyfocus'): your own photo, or the drawn body, and you
   tap where you want to get stronger. "Show exercises" opens the explorer on those areas' muscles,
   "Build a session" the session builder with them (lib/body-focus.js).

   The photo stays on this device (lib/body-photo.js). The picks are remembered here too, not in the
   synced profile. Everything on the picture is also a chip below it, so nobody has to aim at a
   photo, and a screen reader meets one plain button per area. */

const local = () => { try { return globalThis.localStorage } catch { return null } }
let STORE = null
const store = () => STORE || (STORE = photoStore())
/** Tests swap the photo store and the pose model. */
export const __test = { setStore: s => { STORE = s }, detect: detectPose, prepare: preparePhoto }

function PhotoAreas({ rec, url, view, picked, onTap }) {
  const shapes = useMemo(() => areasFromPose(rec.lm, rec.w, rec.h, view), [rec, view])
  const svg = useRef(null)
  const tap = e => {
    const p = toPhoto(svg.current.getBoundingClientRect(), rec.w, rec.h, e.clientX, e.clientY)
    const area = p && hitArea(shapes, p.x, p.y)
    if (area) onTap(area)
  }
  // Painted bottom-up: the shapes a tap meets first (lib/body-focus.js) are drawn on top.
  // As wide as the column allows, but never taller than 520 px: the box keeps the photo's shape,
  // so no bars, and toPhoto() handles any that a browser still draws.
  return <div className="bf-photo" style={{ aspectRatio: `${rec.w} / ${rec.h}`, maxWidth: `${Math.round(520 * rec.w / rec.h)}px` }}>
    <img src={url} alt="" draggable="false" />
    <svg ref={svg} viewBox={`0 0 ${rec.w} ${rec.h}`} onClick={tap} aria-hidden="true">
      {[...shapes].reverse().map((s, i) => {
        const on = picked.includes(s.area) ? ' on' : ''
        if (s.kind === 'circle') return <circle key={i} className={'bf-a' + on} cx={s.cx} cy={s.cy} r={s.r} />
        if (s.kind === 'capsule') return <line key={i} className={'bf-cap' + on} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={2 * s.r} />
        return <polygon key={i} className={'bf-a' + on} points={s.pts.map(p => p.join(',')).join(' ')} />
      })}
    </svg>
  </div>
}

export default function BodyFocus() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [focus, setFocus] = useState(() => loadFocus(local()))
  const [photos, setPhotos] = useState({})            // view -> { rec, url }
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const file = useRef(null)
  const urls = useRef([])

  const show = rec => {
    const url = URL.createObjectURL(new Blob([rec.data], { type: rec.mime || 'image/jpeg' }))
    urls.current.push(url)
    setPhotos(p => ({ ...p, [rec.view]: { rec, url } }))
  }
  useEffect(() => {
    let alive = true
    Promise.all(['front', 'back'].map(v => store().get(v).catch(() => null)))
      .then(recs => { if (alive) for (const rec of recs) if (rec?.lm && !poseProblem(rec.lm, rec.w, rec.h)) show(rec) })
    return () => { alive = false; for (const u of urls.current) URL.revokeObjectURL(u) }
  }, [])

  if (!isOn(S, 'bodyfocus')) return null

  const change = next => { setFocus(next); saveFocus(local(), next) }
  const toggle = id => id && change({ ...focus, areas: toggleArea(focus.areas, id) })
  const view = focus.view
  const photo = photos[view]
  const anyPhoto = !!(photos.front || photos.back)

  const onFile = async e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true)
    setNote('')
    try {
      let p
      try { p = await __test.prepare(f) } catch { setNote(t('Couldn’t open this picture. Try another one.')); return }
      let lm
      try { lm = await __test.detect(p.canvas) } catch { setNote(t('This device can’t look for the body in photos. The drawn body works the same way.')); return }
      if (poseProblem(lm, p.w, p.h)) { setNote(t('Couldn’t find your whole body in this photo. Stand straight with your head and feet in view, then try again.')); return }
      const rec = { view, data: p.data, mime: p.mime, w: p.w, h: p.h, lm, at: Date.now() }
      await store().put(rec).catch(() => {})
      show(rec)
    } finally { setBusy(false) }
  }
  const removePhoto = async () => {
    await store().remove(view).catch(() => {})
    setPhotos(p => { const n = { ...p }; delete n[view]; return n })
  }
  const picked = focus.areas
  const muscles = focusMuscles(picked)

  return <div className="card bf-card" data-tour="home-body">
    <CardHead icon="person" eyebrow={t('Your body')} title={t('Tap where you want to get stronger')} />

    {anyPhoto && <Segmented className="bf-views" value={view} onChange={v => change({ ...focus, view: v })}
      options={[{ value: 'front', label: t('Front view') }, { value: 'back', label: t('Back view') }]} />}

    <div className="bf-stage">
      {photo ? <PhotoAreas rec={photo.rec} url={photo.url} view={view} picked={picked} onTap={toggle} />
        : <BodyMap body={S.body} onMuscle={slug => toggle(areaOfMuscle(slug))} selected={muscles} />}
    </div>

    <input ref={file} type="file" accept="image/*" hidden onChange={onFile} />
    <div className="bf-tools">
      {busy ? <span className="small dim" role="status">{t('Finding you in the photo…')}</span> : photo ? <>
        <Button size="sm" variant="ghost" icon="camera" onClick={() => file.current?.click()}>{t('Change photo')}</Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={removePhoto}>{t('Remove photo')}</Button>
      </> : <Button size="sm" variant="tinted" icon="camera" onClick={() => file.current?.click()}>
        {anyPhoto ? (view === 'back' ? t('Add a back photo') : t('Add a front photo')) : t('Add your photo')}
      </Button>}
    </div>
    {!photo && !busy && <p className="bf-tip small dim">{t('Stand facing the camera, arms at your sides, palms forward. Fitted clothes work best. Your photo stays on this device.')}</p>}
    {note && <p className="bf-note small" role="alert">{note}</p>}

    <div className="bf-chips" role="group" aria-label={t('Your body')}>
      {AREAS.map(a => <button key={a.id} type="button" className={'chip nocap' + (picked.includes(a.id) ? ' on' : '')}
        aria-pressed={picked.includes(a.id)} onClick={() => toggle(a.id)}>{t(a.name)}</button>)}
    </div>

    {picked.length > 0 && <div className="bf-go">
      <Button variant="primary" icon="list" onClick={() => nav(exploreHref(picked), { state: { from: '/' } })}>{t('Show exercises')}</Button>
      <Button icon="sparkles" onClick={() => import('./SessionBuilder.jsx').then(m => m.sessionBuilderSheet(muscles))}>{t('Build a session')}</Button>
      <Button size="sm" variant="ghost" onClick={() => change({ ...focus, areas: [] })}>{t('Clear selection')}</Button>
    </div>}
  </div>
}
