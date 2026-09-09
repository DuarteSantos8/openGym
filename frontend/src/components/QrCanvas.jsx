import { useEffect, useRef, useState } from 'react'
import { renderQrToCanvas } from '../lib/qr.js'

// Renders a gym check-in code as a QR image on a <canvas>. lean-qr draws one module per pixel;
// CSS (.qr-canvas) scales it up with image-rendering: pixelated so it stays razor-sharp at any
// display size without re-generating. Regenerated from `value` on every change — we never store
// the picture (see lib/qr.js).
//
// The lib loads via dynamic import, so the first paint is a frame behind; a plain box holds the
// space until then. A render failure (empty value, lib load error) shows nothing rather than a
// broken canvas — the caller decides what an unusable card looks like.
export default function QrCanvas({ value, size = 240, className = '' }) {
  const ref = useRef(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let alive = true
    setOk(false)
    renderQrToCanvas(ref.current, value)
      .then(mods => { if (alive) setOk(mods > 0) })
      .catch(() => { if (alive) setOk(false) })
    return () => { alive = false }
  }, [value])

  return (
    <canvas
      ref={ref}
      className={'qr-canvas ' + className}
      style={{ width: size, height: size, opacity: ok ? 1 : 0 }}
      aria-label="QR code"
    />
  )
}
