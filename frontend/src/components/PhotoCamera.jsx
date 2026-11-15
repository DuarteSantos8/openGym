// The progress-photo camera (#951): a live view with an earlier photo laid over it, faint, so the
// new one can be framed the same way (same distance, same height, same pose). The overlay sits
// exactly on the camera's frame, which is also the picture that is kept (lib/camera-frame.js),
// and none of it ends up in the saved photo.
//
// Camera access is getUserMedia, as the QR scan already does (CameraScan.jsx): it works in the
// browser on HTTPS or localhost, in the iPhone app's WebView and in the Android one (Capacitor's
// WebView asks for the CAMERA permission the app already declares). Where it is not there or was
// refused, the screen says so and offers the phone's own camera through a file input instead;
// that photo comes back without an overlay, but it still lands on today.
//
// The front camera's live view is mirrored like every camera app's, and the picture kept is
// mirrored the same way: what was on the screen is what is saved. Nothing leaves the device
// here: the picture goes through the same ingest as an added photo (re-encoded, no EXIF).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { containRect, captureSize, overlayOpacity, captureName } from '../lib/camera-frame.js'
import { CustomThumb, useMediaUrl } from './CustomMedia.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const OVERLAY_KEY = 'gym_photo_overlay'
const readOpacity = () => { try { return overlayOpacity(localStorage.getItem(OVERLAY_KEY) ?? undefined) } catch { return 0.4 } }
const keepOpacity = v => { try { localStorage.setItem(OVERLAY_KEY, String(v)) } catch { /* private mode */ } }

/** How a getUserMedia failure reads: 'denied' (the person or the browser said no) or 'unavailable'. */
export const cameraError = e => (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable')

function Overlay({ m, rect, opacity }) {
  const { url } = useMediaUrl(m)
  if (!url || !rect.w) return null
  return <img className="pc-ghost" src={url} alt="" draggable={false}
    style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity }} />
}

/**
 * `photos`: the gallery's photos, newest first (the overlay starts on the first). `onUse(file)`
 * gets the picture kept, as a JPEG File; the camera closes after.
 */
export default function PhotoCamera({ photos = [], onUse, close }) {
  const videoRef = useRef(null)
  const stageRef = useRef(null)
  const fileRef = useRef(null)
  const [facing, setFacing] = useState('user')
  const [status, setStatus] = useState('starting')   // starting | live | denied | unavailable
  const [shot, setShot] = useState(null)             // { file, url } once the shutter was pressed
  const [ghost, setGhost] = useState(photos.length ? 0 : -1)
  const [opacity, setOpacity] = useState(readOpacity)
  const [picking, setPicking] = useState(false)
  const [rect, setRect] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const [busy, setBusy] = useState(false)

  // The camera, opened again on a flip; stopped on unmount, a flip, or a taken picture.
  useEffect(() => {
    if (shot) return undefined
    let stream = null, done = false
    setStatus('starting')
    ;(async () => {
      const md = globalThis.navigator?.mediaDevices
      if (!md || typeof md.getUserMedia !== 'function') { setStatus('unavailable'); return }
      try {
        stream = await md.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false })
      } catch (e) { if (!done) setStatus(cameraError(e)); return }
      if (done) { stream.getTracks().forEach(tr => tr.stop()); return }
      const v = videoRef.current
      if (!v) return
      v.srcObject = stream
      try { await v.play() } catch { /* autoplay rules: 'playing' below still fires once it runs */ }
    })()
    return () => {
      done = true
      if (stream) stream.getTracks().forEach(tr => tr.stop())
      const v = videoRef.current
      if (v) v.srcObject = null
    }
  }, [facing, shot])

  // Where the camera's frame sits on the stage, kept up to date as the stage or the frame changes.
  const measure = useCallback(() => {
    const v = videoRef.current, st = stageRef.current
    if (!v || !st) return
    setRect(containRect(v.videoWidth, v.videoHeight, st.clientWidth, st.clientHeight))
  }, [])
  useLayoutEffect(() => {
    const st = stageRef.current
    if (!st || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(st)
    return () => ro.disconnect()
  }, [measure])

  useEffect(() => () => { if (shot?.url) URL.revokeObjectURL(shot.url) }, [shot])

  const onPlaying = () => { measure(); setStatus('live') }

  const snap = async () => {
    const v = videoRef.current
    if (!v || status !== 'live' || busy) return
    const size = captureSize(v.videoWidth, v.videoHeight)
    if (!size) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = size.w
      canvas.height = size.h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      if (facing === 'user') { ctx.translate(size.w, 0); ctx.scale(-1, 1) }
      ctx.drawImage(v, 0, 0, size.w, size.h)
      const blob = await new Promise(res => { try { canvas.toBlob(res, 'image/jpeg', 0.92) } catch { res(null) } })
      canvas.width = 0; canvas.height = 0
      if (!blob) return
      const name = captureName(todayISO())
      const file = typeof File === 'function' ? new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }) : blob
      setShot({ file, url: URL.createObjectURL(blob) })
    } finally { setBusy(false) }
  }

  const use = async file => {
    if (!file || busy) return
    setBusy(true)
    try { await onUse?.(file) } finally { setBusy(false); close() }
  }
  const onNativeFile = ev => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (f) use(f)
  }
  const changeOpacity = v => { const o = overlayOpacity(v); setOpacity(o); keepOpacity(o) }

  const ghostPhoto = ghost >= 0 ? photos[ghost] : null
  const failed = status === 'denied' || status === 'unavailable'

  return <div className="mviewer pc" role="dialog" aria-modal="true" aria-label={t('Take photo')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{shot ? t('Keep this one?') : ghostPhoto ? t('Line up with {0}', fmtDate(ghostPhoto.d, true)) : t('Progress photo')}</span>
      {!shot && !failed
        ? <button type="button" className="iconbtn" aria-label={t('Switch camera')} onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))}><Icon name="repeat" /></button>
        : <span style={{ width: 36 }} />}
    </div>

    <div className="pc-stage" ref={stageRef} data-swipe-ignore>
      {shot
        ? <img className="pc-shot" src={shot.url} alt={t('The photo you just took')} />
        : failed
          ? <div className="pc-msg">
              <Icon name="camera" />
              <p>{status === 'denied'
                ? t('The camera is switched off for openGym. Allow it in your settings, or use the camera app instead.')
                : t('No live camera here (a browser only offers one on HTTPS). The camera app still works.')}</p>
              <Button variant="tinted" icon="camera" onClick={() => fileRef.current?.click()}>{t('Use the camera app')}</Button>
            </div>
          : <>
              <video ref={videoRef} className={'pc-video' + (facing === 'user' ? ' mirror' : '')} playsInline muted autoPlay
                onLoadedMetadata={measure} onPlaying={onPlaying} />
              {ghostPhoto && status === 'live' && <Overlay m={ghostPhoto.m} rect={rect} opacity={opacity} />}
              {status === 'starting' && <div className="pc-wait" aria-live="polite">{t('Waking up the camera…')}</div>}
            </>}
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onNativeFile} />
    </div>

    {shot
      ? <div className="pc-controls pc-review">
          <Button variant="ghost" className="pc-dark" disabled={busy} onClick={() => setShot(null)}>{t('Retake')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => use(shot.file)}>{busy ? t('Loading…') : t('Use photo')}</Button>
        </div>
      : !failed && <div className="pc-controls">
          {picking && photos.length > 0 && <div className="pc-picks" role="listbox" aria-label={t('Overlay')}>
            <button type="button" role="option" aria-selected={ghost < 0} className={'pc-pick pc-off' + (ghost < 0 ? ' on' : '')}
              onClick={() => { setGhost(-1); setPicking(false) }}>{t('Off')}</button>
            {photos.slice(0, 24).map((p, i) => (
              <button key={p.key} type="button" role="option" aria-selected={ghost === i} aria-label={fmtDate(p.d, true, true)}
                className={'pc-pick' + (ghost === i ? ' on' : '')} onClick={() => { setGhost(i); setPicking(false) }}>
                <CustomThumb ex={{ custom: true, media: p.m }} />
              </button>
            ))}
          </div>}
          {ghostPhoto && !picking && <label className="pc-opacity">
            <Icon name="image" />
            <input type="range" min="0.1" max="0.9" step="0.05" value={opacity} onChange={e => changeOpacity(e.target.value)} aria-label={t('Overlay strength')} />
          </label>}
          <div className="pc-row">
            <button type="button" className={'pc-side' + (picking ? ' on' : '')} disabled={!photos.length}
              aria-expanded={picking} onClick={() => setPicking(x => !x)}>
              <Icon name="sides" /><span>{ghostPhoto ? t('Overlay') : t('No overlay')}</span>
            </button>
            <button type="button" className="pc-shutter" aria-label={t('Take photo')} disabled={status !== 'live' || busy} onClick={snap} />
            <span className="pc-side pc-spacer" aria-hidden="true" />
          </div>
        </div>}
  </div>
}
