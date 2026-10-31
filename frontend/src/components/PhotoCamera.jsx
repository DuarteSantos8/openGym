// The progress-photo camera (#951): the live view full screen with an earlier photo drawn
// semi-transparent over it, so a new photo can be framed like an old one. The overlay is fixed and
// sits exactly on the frame of the video, which is the frame that is saved: it has the proportions
// of the photo that will be kept, so the pose is matched by standing and holding the phone the way
// the earlier photo was taken. Its opacity has a slider; it starts as the latest photo and can be
// changed or turned off. Nothing of the overlay is in the saved picture, only the video frame.
// The front camera's preview is shown mirrored, the way every camera app does, and the picture that
// is kept is mirrored the same way: what is on the screen is what is saved. The overlay is the earlier
// photo as it looks in the gallery, never mirrored.
//
// The front camera opens first. Until the video plays the screen is black and the shutter waits.
// Needs getUserMedia, which a browser only gives on HTTPS or localhost. Where it is not there, or
// the camera is refused, the screen says so in place and the add-photos flow stays the way in.
// `onTaken(file)` gets the JPEG of the frame once "Use photo" is pressed.
import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { frameToBlob } from '../lib/camera-capture.js'
import { defaultOverlay, DEFAULT_OPACITY, frameRatio, isMirrored, photoFileName } from '../lib/camera-overlay.js'
import { useMediaUrl, CustomThumb } from './CustomMedia.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// How many recent photos the overlay choice offers.
const CHOICES = 24

export default function PhotoCamera({ photos, onTaken, close, capture = frameToBlob }) {
  const videoRef = useRef(null)
  const [facing, setFacing] = useState('user')                // the front camera first, the way a progress photo is usually taken
  const [error, setError] = useState(null)               // null, 'denied' or 'unavailable'
  const [live, setLive] = useState(false)               // the video is playing: until then nothing but black
  const [mirror, setMirror] = useState(false)             // the front camera's preview is shown mirrored, as in any camera app
  const [ratio, setRatio] = useState(null)                // width / height of the video frame, which is the frame that is saved
  const [overlay, setOverlay] = useState(() => defaultOverlay(photos))
  const [choosing, setChoosing] = useState(false)
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY)
  const [shot, setShot] = useState(null)                 // { blob, url } once the shutter is pressed
  const [busy, setBusy] = useState(false)
  const overlayUrl = useMediaUrl(overlay ? overlay.m : null).url

  // The camera, again when it is flipped; the stream is stopped whenever it goes.
  useEffect(() => {
    let stream = null, done = false
    const v = videoRef.current
    const measure = () => { const r = frameRatio(v && v.videoWidth, v && v.videoHeight); if (r) setRatio(r) }
    setError(null)
    setLive(false)
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
      if (!v) return
      const track = stream.getVideoTracks ? stream.getVideoTracks()[0] : stream.getTracks()[0]
      const reported = track && track.getSettings ? track.getSettings().facingMode : undefined
      setMirror(isMirrored(reported, facing))
      v.srcObject = stream
      try { await v.play(); if (!done) { measure(); setLive(true) } } catch (e) { /* autoplay rules; onPlaying says when the frames come */ }
    })()
    if (v) { v.addEventListener('loadedmetadata', measure); v.addEventListener('resize', measure) }
    return () => {
      done = true
      if (v) { v.removeEventListener('loadedmetadata', measure); v.removeEventListener('resize', measure) }
      if (stream) stream.getTracks().forEach(tr => tr.stop())
    }
  }, [facing])

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const choose = photo => { setOverlay(photo); setChoosing(false) }
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
    {/* The frame has the shape of the video, which is the shape of the photo that is kept; the video,
        the overlay and the picture taken all fill it. A photo has no reading direction, so it stays ltr. */}
    <div className="pp-cam-stage" dir="ltr">
      <div className="pp-cam-frame" style={ratio ? { '--r': ratio } : undefined}>
        <video ref={videoRef} playsInline muted autoPlay onPlaying={() => setLive(true)} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
        {overlayUrl && live && !error && !shot && <img className="pp-cam-overlay" src={overlayUrl} alt="" draggable={false} style={{ opacity }} />}
        {shot && <img className="pp-cam-shot" src={shot.url} alt="" draggable={false} />}
      </div>
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
    {/* The live controls keep their place after the shot (hidden) and Retake / Use photo sit over
        them, so the bar never changes height and the frame does not move when the shutter is pressed. */}
    <div className="pp-cam-controls">
      <div style={shot ? { visibility: 'hidden' } : undefined}>
        <label className="pp-cam-op" dir="ltr">
          <span>{t('Opacity')}</span>
          <input type="range" min="0" max="100" value={Math.round(opacity * 100)} data-swipe-ignore onChange={e => setOpacity(+e.target.value / 100)} />
        </label>
        <div className="pp-cam-row">
          <Button variant="tinted" size="sm" onClick={() => setChoosing(c => !c)}>{t('Overlay: {0}', label)}</Button>
          <button type="button" className="pp-shutter" aria-label={t('Take photo')} disabled={!!error || !live || busy} onClick={snap}><span /></button>
          <span className="pp-cam-spacer" />
        </div>
      </div>
      {shot && <div className="pp-cam-actions">
        <Button variant="tinted" onClick={() => setShot(null)}>{t('Retake')}</Button>
        <Button variant="primary" onClick={use}>{t('Use photo')}</Button>
      </div>}
    </div>
  </div>
}
