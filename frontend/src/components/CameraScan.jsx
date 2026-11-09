import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { decodeSource } from '../lib/scan-web.js'
import { Button } from '../components/ui.jsx'

// Live camera scanner for the browser/PWA (the app build uses ML Kit's own UI instead — see
// lib/scan.js). Opens the rear camera into a <video>, decodes a frame every ~150 ms until a code
// shows up, then hands { value, fmt } to onFound. Cancel (or unmount) stops the camera.
//
// Errors are shown in place rather than thrown: a denied permission or a browser without
// getUserMedia leaves the sheet up with a message, and the add-card form underneath still offers
// photo import and typing.
export default function CameraScan({ onFound, onCancel, importPhoto = false, onImportError }) {
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const [error, setError] = useState(null)
  // `importPhoto`: with no camera, a screenshot of the code instead (Plan → Scan a QR code has no
  // form underneath that offers it, as the gym check-in does; night QA 146).
  const fromPhoto = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      const { importCodeFromImage } = await import('../lib/scan.js')
      const code = await importCodeFromImage(file)
      if (code) onFound(code)
      else onImportError?.(t('No code found in that image'))
    } catch { onImportError?.(t('Could not read that image')) }
  }

  useEffect(() => {
    let stream = null, timer = null, done = false
    const stop = () => {
      done = true
      if (timer) clearTimeout(timer)
      if (stream) stream.getTracks().forEach(tr => tr.stop())
    }
    ;(async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setError('unavailable'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch (e) {
        setError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable')
        return
      }
      if (done) { stream.getTracks().forEach(tr => tr.stop()); return }
      const v = videoRef.current
      if (!v) return
      v.srcObject = stream
      try { await v.play() } catch (e) { /* autoplay policies; the loop below waits for frames */ }
      const tick = async () => {
        if (done) return
        if (v.readyState >= 2) {
          let code = null
          try { code = await decodeSource(v) } catch (e) { /* keep trying */ }
          if (code && !done) { stop(); onFound(code); return }
        }
        timer = setTimeout(tick, 150)
      }
      tick()
    })()
    return stop
  }, [onFound])

  return <>
    <h3>{t('Scan')}</h3>
    {error
      ? <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {error === 'denied'
            ? t('Camera access was denied. Allow it in your browser and try again.')
            : t('No camera available here. Import a photo or type the code instead.')}
        </div>
      : <>
          <div className="cam-wrap">
            {/* playsInline keeps iOS from going full-screen; muted satisfies autoplay rules. */}
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="cam-frame" aria-hidden="true" />
          </div>
          <div className="muted small" style={{ textAlign: 'center', margin: '12px 0 16px' }}>{t('Point the camera at the QR code')}</div>
        </>}
    {error && importPhoto && <>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={fromPhoto} />
      <Button variant="primary" icon="image" onClick={() => fileRef.current?.click()} style={{ marginBottom: 8 }}>{t('Import photo')}</Button>
    </>}
    <Button variant="tinted" onClick={onCancel}>{t('Cancel')}</Button>
  </>
}
