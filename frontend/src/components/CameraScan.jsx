import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { decodeSource } from '../lib/scan-web.js'
import { scanCode } from '../lib/scan.js'
import { scanErrorMessage } from '../lib/scan-errors.js'
import { MOBILE } from '../lib/mobile.js'
import { useUI } from '../store/useUI.js'
import { Button } from '../components/ui.jsx'

// Live camera scanner for the browser/PWA (the app build uses ML Kit's own UI instead — see
// lib/scan.js). Opens the rear camera into a <video>, decodes a frame every ~150 ms until a QR
// shows up, then hands { value, fmt } to onFound. Cancel (or unmount) stops the camera.
//
// Errors are shown in place rather than thrown: a denied permission or a browser without
// getUserMedia leaves the sheet up with a message, and the add-card form underneath still offers
// photo import and typing.
// `noCamera` replaces the message for a browser without a camera, for callers with no photo
// import or text field to fall back on.
export default function CameraScan({ onFound, onCancel, noCamera }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)

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
            : noCamera || t('No camera available here. Import a photo or type the code instead.')}
        </div>
      : <>
          <div className="cam-wrap">
            {/* playsInline keeps iOS from going full-screen; muted satisfies autoplay rules. */}
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="cam-frame" aria-hidden="true" />
          </div>
          <div className="muted small" style={{ textAlign: 'center', margin: '12px 0 16px' }}>{t('Point the camera at the QR code')}</div>
        </>}
    <Button variant="tinted" onClick={onCancel}>{t('Cancel')}</Button>
  </>
}

// The browser sheet for scanOnce: settles the promise once, with null when the sheet goes away
// some other way than a scan (Cancel, a tap outside, the back gesture).
function ScanOnceSheet({ settle, close }) {
  // Settled on the way out only once the sheet has really gone: StrictMode unmounts and mounts
  // every effect once more on the way in, and settling there answered null before any scan.
  const live = useRef(false)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      setTimeout(() => { if (!live.current) settle(null) }, 0)
    }
  }, [settle])
  return <CameraScan noCamera={t('No camera available here.')}
    onCancel={() => { settle(null); close() }}
    onFound={code => { settle(code); close() }} />
}

/**
 * One scan, on every platform: ML Kit's own scanner in the app, our camera sheet in a browser.
 * Resolves to { value, fmt }, or null when nothing was scanned; a scanner that cannot start is
 * reported as a toast and resolves to null as well.
 */
export function scanOnce() {
  if (MOBILE) {
    return scanCode().catch(e => { useUI.getState().toast(scanErrorMessage(e)); return null })
  }
  return new Promise(resolve => {
    let done = false
    const settle = code => { if (!done) { done = true; resolve(code || null) } }
    useUI.getState().openSheet(close => <ScanOnceSheet settle={settle} close={close} />)
  })
}
