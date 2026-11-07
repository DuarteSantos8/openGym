// "Share" on the finish summary and "Share as image" in a past workout's options (#453, redone in
// 1.4.5 after Sharan's post on Discord): the card drawn live on a canvas, four templates, your own
// photo behind the numbers (dragged and pinched into place), a switch per element and three sizes.
// The photo is one on this workout or one picked from the gallery or the camera; it is decoded
// here, painted onto the card and never leaves the device on its own. The exported PNG is a new
// picture, so no EXIF or GPS goes with it. Exercise stills and animations are never offered as a
// photo (licence, NOTICE.md). Layout and drawing live in lib/share-card.js.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { countsWarmups, workoutDay } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { streakInfo } from '../lib/streak.js'
import { speedUnitOf } from '../lib/speed.js'
import { workoutMediaOf } from '../lib/media-refs.js'
import { mediaStore } from '../lib/media-store.js'
import { fetchToStore } from '../lib/media-sync.js'
import { makeCanvas, toPng, currentAccent, isRtl, shareImage, saveImage } from '../lib/share-image.js'
import { MOBILE } from '../lib/mobile.js'
import { viewAspect, CARD_FONT } from '../lib/workout-card.js'
import {
  shareCardModel, layoutShareCard, drawShareCard, sharePalette, shownElements, panBy, zoomTo, shadeFor,
  SHARE_TEMPLATES, SHARE_LOOKS, SHARE_FORMATS, SHARE_FORMAT_IDS, ZOOM_MAX,
} from '../lib/share-card.js'
import { CustomThumb } from './CustomMedia.jsx'
import { Button, Segmented, Slider } from './ui.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)

// The template, size and look last used, per device. A sticker person keeps making stickers.
const PREF = 'og_share_workout'
export function readSharePref() {
  try {
    const v = JSON.parse(localStorage.getItem(PREF) || '{}')
    return {
      template: SHARE_TEMPLATES.includes(v.template) ? v.template : 'classic',
      format: SHARE_FORMAT_IDS.includes(v.format) ? v.format : 'story',
      look: SHARE_LOOKS.includes(v.look) ? v.look : 'dark',
    }
  } catch (e) { return { template: 'classic', format: 'story', look: 'dark' } }
}
function writePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)) } catch (e) { /* not remembered then */ } }

/** The element switches as the profile keeps them: a list of the ones turned off, and the muscle
 *  map's own older switch (shareMap) still honoured. */
export function hiddenOf(S) {
  const hide = Array.isArray(S.shareHide) ? S.shareHide.filter(x => typeof x === 'string') : []
  return S.shareMap === false ? [...new Set([...hide, 'map'])] : hide
}

const MAX_EDGE = 2400
// A file or blob as something a canvas can paint, its long edge cut to MAX_EDGE (a 48 MP photo
// would otherwise sit in memory at full size), turned upright by its EXIF on the way in.
export async function decodePhoto(blob) {
  let bmp = null
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }) } catch (e) { bmp = null }
  if (!bmp) {
    bmp = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
      img.src = url
    })
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight
  if (!w || !h) throw new Error('decode')
  const s = Math.min(1, MAX_EDGE / Math.max(w, h))
  let image = bmp, width = w, height = h
  if (s < 1) {
    width = Math.round(w * s); height = Math.round(h * s)
    const c = makeCanvas(width, height, CARD_FONT)
    if (c) { c.ctx.drawImage(bmp, 0, 0, width, height); image = c.canvas; bmp.close?.() }
  }
  // How dark the lower half is decides how much the shade under the type darkens it.
  let shade = 0.7
  const probe = makeCanvas(24, 24, CARD_FONT)
  if (probe) {
    try {
      probe.ctx.drawImage(image, 0, height * 0.5, width, height * 0.5, 0, 0, 24, 24)
      shade = shadeFor(probe.ctx.getImageData(0, 0, 24, 24).data)
    } catch (e) { /* a tainted canvas cannot happen with a local blob, but never fail on it */ }
  }
  return { image, width, height, shade }
}

// The pictures on this workout that can go behind the card: its photos, and the poster of a
// video. Only the owner's own files: catalogue media is not on a workout record.
export function workoutPhotos(w) {
  return workoutMediaOf(w).map(m => (m.kind === 'image' ? { key: m.hash, file: m, ref: m } : m.poster ? { key: m.poster.hash, file: m.poster, ref: m } : null)).filter(Boolean)
}

export default function ShareWorkout({ w, close }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [pref, setPref] = useState(readSharePref)
  const [photo, setPhoto] = useState(null)       // { image, width, height, shade, key }
  const [pan, setPan] = useState({ x: 0, y: 0, zoom: 1 })
  const [body, setBody] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(null)
  const canvasRef = useRef(null)
  const pickRef = useRef(null)
  const camRef = useRef(null)
  const set = patch => setPref(p => { const next = { ...p, ...patch }; writePref(next); return next })

  const day = workoutDay(w) || todayISO()
  const warmups = countsWarmups(st)
  const model = useMemo(() => shareCardModel(w, {
    unit: st.unit, warmups, streak: streakInfo(st, day).current, state: st, speedUnit: speedUnitOf(st),
    nameOf: e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id)),
  }), [w, st.unit, warmups, st.workouts, st.weekStart, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = hiddenOf(st)
  const show = shownElements(hidden)
  const photos = useMemo(() => workoutPhotos(w), [w])

  // The body drawing is ~90 KB and lazy everywhere else too (components/BodyMap.jsx).
  useEffect(() => {
    if (!model.levels || !show.map || body) return
    let alive = true
    import('../lib/body-geometry.js').then(m => { if (alive) setBody(m.default) }).catch(() => {})
    return () => { alive = false }
  }, [model.levels, show.map, body])

  const shape = body && model.levels ? (body[st.body] || body.male) : null
  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext?.('2d')
    if (!ctx) return null
    const measure = (text, weight, size) => { ctx.font = `${weight} ${size}px ${CARD_FONT}`; return ctx.measureText(String(text)).width }
    const layout = layoutShareCard(model, {
      template: pref.template, format: pref.format, show, measure, rtl: isRtl(),
      map: shape ? { aspect: viewAspect(shape.front) } : null, photo: !!photo,
    })
    if (canvas.width !== layout.width) canvas.width = layout.width
    if (canvas.height !== layout.height) canvas.height = layout.height
    drawShareCard(ctx, layout, sharePalette(pref.template, pref.look, currentAccent()), {
      map: shape ? { body: shape, levels: model.levels } : null,
      photo: photo && pref.template === 'photo' ? { ...photo, pan } : null,
    })
    return layout
  }
  // One frame per change, however many pointer moves arrive in it.
  const frame = useRef(0)
  useEffect(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame.current)
  }) // every render: the canvas is the preview

  const usePhoto = async (load, key) => {
    setLoading(key)
    try {
      const blob = await load()
      if (!blob) throw new Error('missing')
      const got = await decodePhoto(blob)
      setPhoto({ ...got, key })
      setPan({ x: 0, y: 0, zoom: 1 })
      if (pref.template !== 'photo') set({ template: 'photo' })
    } catch (e) {
      toast(t('Could not open that photo.'))
    } finally { setLoading(null) }
  }
  const fromWorkout = p => usePhoto(async () => {
    const here = await mediaStore.get(p.key).catch(() => null)
    if (here?.blob) return here.blob
    await fetchToStore(p.key, p.file)
    return (await mediaStore.get(p.key))?.blob
  }, p.key)
  const onFile = ev => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (file) usePhoto(async () => file, 'pick')
  }

  // Drag to move, pinch (or a wheel) to zoom. The photo follows the finger 1:1: a move on the
  // preview is scaled up to the card's own pixels.
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const canMove = pref.template === 'photo' && !!photo
  const toCard = () => {
    const c = canvasRef.current
    const r = c?.getBoundingClientRect()
    return r && r.width ? c.width / r.width : 1
  }
  const onDown = e => {
    if (!canMove) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: pan.zoom }
    }
  }
  const onMove = e => {
    const prev = pointers.current.get(e.pointerId)
    if (!canMove || !prev) return
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)
    const F = SHARE_FORMATS[pref.format]
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      setPan(p => zoomTo(p, pinch.current.zoom * (d / pinch.current.d)))
      return
    }
    const k = toCard()
    setPan(p => panBy(p, (next.x - prev.x) * k, (next.y - prev.y) * k, photo.width, photo.height, F.width, F.height))
  }
  const onUp = e => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }
  const onWheel = e => {
    if (!canMove) return
    setPan(p => zoomTo(p, p.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
  }

  // Share hands the card to another app; Save puts it straight into Photos / the gallery.
  const share = async (how = shareImage) => {
    const layout = draw()
    if (!layout) return
    setBusy(true)
    const blob = await toPng(canvasRef.current)
    if (!blob) { toast(t('Could not create the image')); setBusy(false); return }
    const done = await how(blob, `opengym-workout-${day}${pref.template === 'sticker' ? '-sticker' : ''}.png`, w.name || 'openGym', toast)
    setBusy(false)
    if (done !== false) close?.()
  }

  const toggle = id => update(s => {
    if (id === 'map') { s.shareMap = !(s.shareMap !== false); s.shareHide = (s.shareHide || []).filter(x => x !== 'map'); return }
    const cur = new Set(Array.isArray(s.shareHide) ? s.shareHide : [])
    if (cur.has(id)) cur.delete(id); else cur.add(id)
    s.shareHide = [...cur]
  })
  // Only what this workout has: no heart-rate switch without a reading, no map for pure cardio.
  const elements = [
    ['title', t('Title'), !!model.title], ['date', t('Date'), !!model.date],
    ['duration', t('Duration'), model.stats.some(s => s.id === 'duration')], ['volume', t('Volume'), true], ['sets', t('Sets'), true],
    ['prs', t('PRs'), true], ['exercises', t('Exercises'), model.lifts.length > 0], ['map', t('Muscle map'), !!model.levels],
    ['streak', t('Streak'), model.streak > 0], ['hr', t('Heart rate'), !!model.hr], ['logo', t('Logo'), true],
  ].filter(e => e[2])

  const sticker = pref.template === 'sticker'
  const aspect = sticker ? null : `${SHARE_FORMATS[pref.format].width} / ${SHARE_FORMATS[pref.format].height}`
  return <div className="sharew">
    <h3>{t('Share workout')}</h3>
    <div className={'sharew-stage' + (sticker ? ' is-sticker' : '') + (canMove ? ' can-move' : '')}>
      <canvas ref={canvasRef} className="sharew-canvas" width={1080} height={1920} style={aspect ? { aspectRatio: aspect } : undefined}
        role="img" aria-label={t('Preview of the image to share')}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} />
    </div>

    <Segmented className="sharew-tpl" value={pref.template} onChange={template => set({ template })}
      options={[
        { value: 'classic', label: t('Classic') }, { value: 'photo', label: t('Photo') },
        { value: 'lifts', label: t('Lifts') }, { value: 'sticker', label: t('Sticker') },
      ]} />
    {sticker && <p className="small muted sharew-hint">{t('A see-through PNG. Lay it over a photo you already have in Instagram.')}</p>}

    {pref.template === 'photo' && <div className="sharew-photo">
      <div className="sharew-pick" role="group" aria-label={t('Photo')}>
        {photos.map((p, i) => (
          <button key={p.key} type="button" className={'sharew-thumb' + (photo?.key === p.key ? ' on' : '')} aria-pressed={photo?.key === p.key}
            aria-label={t('Photo {0} of this workout', i + 1)} disabled={!!loading} onClick={() => fromWorkout(p)}>
            <CustomThumb ex={{ custom: true, media: p.ref }} />
          </button>
        ))}
        <button type="button" className="sharew-add" disabled={!!loading} onClick={() => pickRef.current?.click()}>
          <Icon name="image" /><span>{loading === 'pick' ? t('Opening…') : t('Choose photo')}</span>
        </button>
        <button type="button" className="sharew-add" disabled={!!loading} onClick={() => camRef.current?.click()}>
          <Icon name="camera" /><span>{t('Take photo')}</span>
        </button>
      </div>
      <input ref={pickRef} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      {photo
        ? <div className="sharew-zoom">
          <Icon name="image" className="muted" />
          <Slider value={pan.zoom} min={1} max={ZOOM_MAX} step={0.01} onChange={z => setPan(p => zoomTo(p, z))} />
          <Button variant="plain" icon="reset" onClick={() => setPan({ x: 0, y: 0, zoom: 1 })} aria-label={t('Reset')} />
          <Button variant="plain" icon="trash" onClick={() => setPhoto(null)} aria-label={t('Remove photo')} />
        </div>
        : null}
      <p className="small muted sharew-hint">{photo ? t('Drag to move it, pinch to zoom. The photo never leaves this device on its own.') : t('Pick one of yours. It stays on this device.')}</p>
    </div>}

    <div className="share-opts">
      {!sticker && <Segmented value={pref.format} onChange={format => set({ format })}
        options={[{ value: 'story', label: t('Story 9:16') }, { value: 'portrait', label: t('Portrait 4:5') }, { value: 'square', label: t('Square 1:1') }]} />}
      {pref.template !== 'photo' && <Segmented value={pref.look} onChange={look => set({ look })}
        options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }, { value: 'accent', label: t('Accent') }]} />}
    </div>

    <div className="small muted sharew-h">{t('On the card')}</div>
    <div className="sharew-els">
      {elements.map(([id, label]) => (
        <button key={id} type="button" className={'chip' + (show[id] ? ' on' : '')} aria-pressed={show[id]} onClick={() => toggle(id)}>{label}</button>
      ))}
    </div>

    <div className="sharew-actions">
      <Button icon="download" disabled={busy} onClick={() => share(saveImage)}>{t(MOBILE ? 'Save to Photos' : 'Save image')}</Button>
      <Button variant="primary" icon="share" disabled={busy} onClick={() => share()}>{t('Share')}</Button>
    </div>
  </div>
}

// Kept for a test that wants a picture without the sheet: the card for a template as a PNG blob.
export async function shareCardPng(model, { template, format, look, show, photo = null, body = null, acc = '#30d158' }) {
  const probe = makeCanvas(1, 1, CARD_FONT)
  if (!probe) return null
  const shape = body && model.levels ? body : null
  const layout = layoutShareCard(model, { template, format, show, measure: probe.measure, rtl: isRtl(), map: shape ? { aspect: viewAspect(shape.front) } : null, photo: !!photo })
  const c = makeCanvas(layout.width, layout.height, CARD_FONT)
  if (!c) return null
  drawShareCard(c.ctx, layout, sharePalette(template, look, acc), { map: shape ? { body: shape, levels: model.levels } : null, photo })
  return toPng(c.canvas)
}
