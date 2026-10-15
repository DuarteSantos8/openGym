import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { decodeSource } from '../lib/scan-web.js'
import { Button } from '../components/ui.jsx'
import { SheetHeader } from './sheet-layout.jsx'

// Live camera scanner for the browser/PWA (the app build uses ML Kit's own UI instead — see
// lib/scan.js). Opens the rear camera into a <video>, decodes a frame every ~150 ms until a QR
// shows up, then hands { value, fmt } to onFound. Cancel (or unmount) stops the camera.
//
// Errors are shown in place rather than thrown: a denied permission or a browser without
// getUserMedia leaves the sheet up with a message, and the add-card form underneath still offers
// photo import and typing.
//
// `product` scans EAN/UPC product barcodes for the food scanner instead of QR cards: the host
// sheet brings its own title and a way to type the code, so the heading and Cancel are left out.
// `onFound` must be stable (the camera restarts when it changes).
export default function CameraScan({ onFound, onCancel, product = false }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let stream = null, timer = null, done = false
    // Releases the camera and the loop; `begin` can open them again (the tab came back to the front).
    const release = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (stream) stream.getTracks().forEach(tr => tr.stop())
      stream = null
    }
    const stop = () => { done = true; release() }
    // A product barcode has a 1-in-10 chance of passing its check digit by luck, so a single
    // read of a smudged or half-seen code can name the wrong product. It is taken once two
    // reads inside 1.5 s agree; a QR card carries its own error correction and goes at once.
    const reads = []
    const confirmed = code => {
      if (!product) return true
      const now = Date.now()
      reads.push({ value: code.value, at: now })
      while (reads[0].at < now - 1500) reads.shift()
      return reads.filter(r => r.value === code.value).length >= 2
    }
    let opening = false
    const begin = async () => {
      if (opening || stream || done) return
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setError('unavailable'); return }
      opening = true
      let opened
      try {
        opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch (e) {
        opening = false
        setError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable')
        return
      }
      opening = false
      // Closed, or hidden again, while the camera was opening.
      if (done || document.visibilityState === 'hidden') { opened.getTracks().forEach(tr => tr.stop()); return }
      const v = videoRef.current
      if (!v) { opened.getTracks().forEach(tr => tr.stop()); return }
      stream = opened
      v.srcObject = stream
      try { await v.play() } catch (e) { /* autoplay policies; the loop below waits for frames */ }
      reads.length = 0
      const tick = async () => {
        if (done || !stream) return
        if (v.readyState >= 2) {
          let code = null
          try { code = await decodeSource(v, { product }) } catch (e) { /* keep trying */ }
          if (code && !done && stream && confirmed(code)) { stop(); onFound(code); return }
        }
        if (stream) timer = setTimeout(tick, 150)
      }
      tick()
    }
    // A hidden tab keeps the camera light on and burns battery decoding: let go, and resume on return.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release()
      else begin()
    }
    document.addEventListener('visibilitychange', onVisibility)
    begin()
    return () => { document.removeEventListener('visibilitychange', onVisibility); stop() }
  }, [onFound, product])

  if (product) {
    return error
      ? <div className="muted small cam-note" role="status">
          {error === 'denied'
            ? t('Camera access was denied. Allow it in your browser and try again.')
            : t('No camera available here. Type the barcode instead.')}
        </div>
      : <>
          <div className="cam-wrap">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="cam-frame wide" aria-hidden="true" />
          </div>
          <div className="muted small cam-note center">{t('Point the camera at the barcode')}</div>
        </>
  }

  return <>
    <SheetHeader title={t('Scan')} />
    {error
      ? <div className="muted small mb-8 lh-150">
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
          <div className="muted small ta-center mt-6 mb-8">{t('Point the camera at the QR code')}</div>
        </>}
    <Button variant="tinted" onClick={onCancel}>{t('Cancel')}</Button>
  </>
}
