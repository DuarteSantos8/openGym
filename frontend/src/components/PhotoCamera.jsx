// The progress-photo camera (#951): the live view full screen with an earlier photo drawn
// semi-transparent over it, so a new photo can be framed like an old one. The overlay moves with
// one finger, scales with two, and its opacity has a slider; it starts as the latest photo and can
// be changed or turned off. Nothing of the overlay is in the saved picture, only the video frame.
// The front camera's preview is shown mirrored, the way every camera app does, and the picture that
// is kept is mirrored the same way: what is on the screen is what is saved. The overlay is the earlier
// photo as it looks in the gallery, never mirrored.
//
// Needs getUserMedia, which a browser only gives on HTTPS or localhost. Where it is not there, or
// the camera is refused, the screen says so in place and the add-photos flow stays the way in.
// `onTaken(file)` gets the JPEG of the frame once "Use photo" is pressed.
import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { frameToBlob } from '../lib/camera-capture.js'
import { defaultOverlay, DEFAULT_OPACITY, clampPan, pinchScale, distance, overlayTransform, isMirrored, photoFileName } from '../lib/camera-overlay.js'
import { useMediaUrl, CustomThumb } from './CustomMedia.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// How many recent photos the overlay choice offers.
const CHOICES = 24
const START = { x: 0, y: 0, scale: 1 }

export default function PhotoCamera({ photos, onTaken, close, capture = frameToBlob }) {
  const videoRef = useRef(null)
  const stageRef = useRef(null)
  const pointers = useRef(new Map())
  const base = useRef(null)           // where the current gesture started: { pos, point, dist }
  const [facing, setFacing] = useState('environment')
  const [error, setError] = useState(null)               // null, 'denied' or 'unavailable'
  const [mirror, setMirror] = useState(false)             // the front camera's preview is shown mirrored, as in any camera app
  const [overlay, setOverlay] = useState(() => defaultOverlay(photos))
  const [choosing, setChoosing] = useState(false)
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY)
  const [pos, setPos] = useState(START)
  const [shot, setShot] = useState(null)                 // { blob, url } once the shutter is pressed
  const [busy, setBusy] = useState(false)
  const overlayUrl = useMediaUrl(overlay ? overlay.m : null).url

  // The camera, again when it is flipped; the stream is stopped whenever it goes.
  useEffect(() => {
    let stream = null, done = false
    setError(null)
    setMirror(false)
    ;(async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setError('unavailable'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false })
      } catch (e) {
        if (!done) setError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable')
        return
      }
      if (done) { stream.getTracks().forEach(tr => tr.stop()); return }
      const v = videoRef.current
      if (!v) return
      const track = stream.getVideoTracks ? stream.getVideoTracks()[0] : stream.getTracks()[0]
      const reported = track && track.getSettings ? track.getSettings().facingMode : undefined
      setMirror(isMirrored(reported, facing))
      v.srcObject = stream
      try { await v.play() } catch (e) { /* autoplay rules; the frames come once it plays */ }
    })()
    return () => { done = true; if (stream) stream.getTracks().forEach(tr => tr.stop()) }
  }, [facing])

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const point = e => ({ x: e.clientX, y: e.clientY })
  const startGesture = () => {
    const pts = [...pointers.current.values()]
    base.current = { pos, point: pts[0], dist: pts.length > 1 ? distance(pts[0], pts[1]) : 0, mid: pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : null }
  }
  const onPointerDown = e => {
    if (shot || error) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, point(e))
    startGesture()
  }
  const onPointerMove = e => {
    if (!pointers.current.has(e.pointerId) || !base.current) return
    pointers.current.set(e.pointerId, point(e))
    const rect = stageRef.current ? stageRef.current.getBoundingClientRect() : { width: 0, height: 0 }
    const pts = [...pointers.current.values()]
    const b = base.current
    if (pts.length > 1 && b.dist) {
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      setPos({
        scale: pinchScale(b.pos.scale, b.dist, distance(pts[0], pts[1])),
        x: clampPan(b.pos.x + mid.x - b.mid.x, rect.width),
        y: clampPan(b.pos.y + mid.y - b.mid.y, rect.height),
      })
    } else if (pts.length === 1 && !b.dist) {
      setPos({ scale: b.pos.scale, x: clampPan(b.pos.x + pts[0].x - b.point.x, rect.width), y: clampPan(b.pos.y + pts[0].y - b.point.y, rect.height) })
    }
  }
  const endPointer = e => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size) startGesture()
    else base.current = null
  }

  const choose = photo => { setOverlay(photo); setPos(START); setChoosing(false) }
  const snap = async () => {
    const v = videoRef.current
    if (!v || busy) return
    setBusy(true)
    try {
      const blob = await capture(v, { mirror })
      if (blob) setShot({ blob, url: URL.createObjectURL(blob) })
    } finally { setBusy(false) }
  }
  const use = () => {
    if (!shot) return
    const file = new File([shot.blob], photoFileName(todayISO()), { type: 'image/jpeg', lastModified: Date.now() })
    onTaken(file)
    close()
  }

  const label = overlay ? fmtDate(overlay.d) : t('None')
  return <div className="mviewer pp-cam" role="dialog" aria-modal="true" aria-label={t('Take photo')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{t('Take photo')}</span>
      <button type="button" className="iconbtn" aria-label={t('Flip camera')} disabled={!!shot} onClick={() => setFacing(f => (f === 'environment' ? 'user' : 'environment'))}><Icon name="repeat" /></button>
    </div>
    {/* A photo has no reading direction, and the fingers move the overlay the same way in Arabic. */}
    <div className="pp-cam-stage" dir="ltr" ref={stageRef} data-swipe-ignore
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}>
      <video ref={videoRef} playsInline muted autoPlay style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
      {overlayUrl && !error && !shot && <img className="pp-cam-overlay" src={overlayUrl} alt="" draggable={false}
        style={{ opacity, transform: overlayTransform(pos) }} />}
      {shot && <img className="pp-cam-shot" src={shot.url} alt="" draggable={false} />}
      {error && <div className="pp-cam-error">
        {error === 'denied'
          ? t('Camera access was denied. Allow it in your browser and try again.')
          : t('No camera available here. Add the photo from your gallery instead.')}
      </div>}
    </div>
    {choosing && !shot && <div className="pp-cam-choose" dir="ltr" data-swipe-ignore>
      <button type="button" className={'pp-cam-none' + (!overlay ? ' on' : '')} onClick={() => choose(null)}>{t('None')}</button>
      {photos.slice(0, CHOICES).map(p => <button key={p.key} type="button" className={'pp-cam-pick' + (overlay && overlay.key === p.key ? ' on' : '')}
        aria-label={fmtDate(p.d, true, true)} onClick={() => choose(p)}>
        <CustomThumb ex={{ custom: true, media: p.m }} />
        <span className="pp-cam-date" aria-hidden="true">{fmtDate(p.d)}</span>
      </button>)}
    </div>}
    <div className="pp-cam-controls">
      {shot
        ? <div className="pp-cam-actions">
            <Button variant="tinted" onClick={() => setShot(null)}>{t('Retake')}</Button>
            <Button variant="primary" onClick={use}>{t('Use photo')}</Button>
          </div>
        : <>
            <label className="pp-cam-op" dir="ltr">
              <span>{t('Opacity')}</span>
              <input type="range" min="0" max="100" value={Math.round(opacity * 100)} data-swipe-ignore onChange={e => setOpacity(+e.target.value / 100)} />
            </label>
            <div className="pp-cam-row">
              <Button variant="tinted" size="sm" onClick={() => setChoosing(c => !c)}>{t('Overlay: {0}', label)}</Button>
              <button type="button" className="pp-shutter" aria-label={t('Take photo')} disabled={!!error || busy} onClick={snap}><span /></button>
              <span className="pp-cam-spacer" />
            </div>
            <div className="small dim pp-cam-hint">{t('Drag to move, pinch to resize.')}</div>
          </>}
    </div>
  </div>
}
