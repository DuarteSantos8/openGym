import { useEffect, useRef, useState } from 'react'
import { renderCodeToCanvas } from '../lib/qr.js'
import { t } from '../lib/i18n.js'

// Renders a QR or a barcode in its scanned format on a canvas.
// QR modules and barcode bars use black on white; CSS keeps the image crisp at any
// display size without re-generating. Regenerated from `value` on every change — we never store
// the picture (see lib/qr.js).
//
// The lib loads via dynamic import, so the first paint is a frame behind; a plain box holds the
// space until then. A render failure (empty value, lib load error) shows nothing rather than a
// broken canvas — the caller decides what an unusable card looks like.
export default function QrCanvas({ value, fmt = 'qrcode', size = 240, className = '' }) {
  const ref = useRef(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let alive = true
    setOk(false)
    renderCodeToCanvas(ref.current, value, fmt)
      .then(mods => { if (alive) setOk(mods > 0) })
      .catch(() => { if (alive) setOk(false) })
    return () => { alive = false }
  }, [value, fmt])

  return (
    <canvas
      ref={ref}
      className={'qr-canvas ' + className}
      style={{ width: size, maxWidth: '100%', height: fmt === 'qrcode' ? size : 'auto', opacity: ok ? 1 : 0 }}
      aria-label={t(fmt === 'qrcode' ? 'QR code' : 'Barcode')}
    />
  )
}
