import { useEffect, useRef, useState } from 'react'
import { normalizeFmt, renderCodeToCanvas } from '../lib/qr.js'
import { t } from '../lib/i18n.js'

// Renders a QR or a linear barcode in its saved format. QR remains the default for callers
// such as device linking. Linear barcodes keep their wide aspect ratio instead of being
// stretched into a square. We regenerate the image from its value; no photo is stored.
//
// The lib loads via dynamic import, so the first paint is a frame behind; a plain box holds the
// space until then. A render failure (empty value, lib load error) shows nothing rather than a
// broken canvas — the caller decides what an unusable card looks like.
export default function QrCanvas({ value, fmt = 'qrcode', size = 240, className = '' }) {
  const ref = useRef(null)
  const [ok, setOk] = useState(false)
  const qr = normalizeFmt(fmt) === 'qrcode'

  useEffect(() => {
    let alive = true
    setOk(false)
    // A detached canvas prevents a slower, older render from overwriting a newer scan.
    const canvas = document.createElement('canvas')
    renderCodeToCanvas(canvas, value, fmt)
      .then(mods => {
        if (!alive || !ref.current || !mods) return
        ref.current.width = canvas.width
        ref.current.height = canvas.height
        ref.current.getContext('2d').drawImage(canvas, 0, 0)
        setOk(true)
      })
      .catch(() => { if (alive) setOk(false) })
    return () => { alive = false }
  }, [value, fmt])

  return (
    <canvas
      ref={ref}
      className={'qr-canvas ' + className}
      style={{ width: qr ? size : Math.max(size, 280), maxWidth: '100%', height: 'auto', aspectRatio: qr ? '1' : undefined, opacity: ok ? 1 : 0 }}
      aria-label={qr ? t('QR code') : t('Barcode')}
    />
  )
}
