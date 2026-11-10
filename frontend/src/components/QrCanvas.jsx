import { useEffect, useRef, useState } from 'react'
import { renderQrToCanvas, normalizeFmt } from '../lib/qr.js'
import { drawBarsToCanvas } from '../lib/barcode.js'
import { t } from '../lib/i18n.js'

// Renders a gym check-in code on a <canvas>: a QR by default, or a 1D barcode when `fmt` names
// one (lib/barcode.js). Both draw one module per pixel; CSS (.qr-canvas) scales it up with
// image-rendering: pixelated so it stays razor-sharp at any display size without re-generating.
// Regenerated from `value` on every change — we never store the picture (see lib/qr.js).
//
// The QR lib loads via dynamic import, so the first paint is a frame behind; a plain box holds
// the space until then. A render failure (empty value, lib load error) shows nothing rather than
// a broken canvas — the caller decides what an unusable card looks like.
export default function QrCanvas({ value, fmt, size = 240, className = '' }) {
  const ref = useRef(null)
  const [ok, setOk] = useState(false)
  const [barsW, setBarsW] = useState(size)
  // cards saved before 1D support carry 'qrcode' (or nothing): both draw as QR
  const f = normalizeFmt(fmt)
  const bars = !!f && f !== 'qrcode'

  useEffect(() => {
    let alive = true
    setOk(false)
    if (bars) {
      // Shown at exactly the canvas's device pixels, so every bar keeps its drawn width. A long
      // code on a low-density screen can come out a little wider than `size`; that beats bars
      // a reader cannot tell apart.
      const dpr = window.devicePixelRatio || 1
      const mods = drawBarsToCanvas(ref.current, value, f, Math.floor(size * dpr))
      setBarsW(mods ? ref.current.width / dpr : size)
      setOk(mods > 0)
      return
    }
    renderQrToCanvas(ref.current, value)
      .then(mods => { if (alive) setOk(mods > 0) })
      .catch(() => { if (alive) setOk(false) })
    return () => { alive = false }
  }, [value, f, bars, size])

  return (
    <canvas
      ref={ref}
      className={'qr-canvas ' + className}
      style={{ width: bars ? barsW : size, height: bars ? Math.round(size * 0.45) : size, opacity: ok ? 1 : 0 }}
      aria-label={bars ? t('Barcode') : t('QR code')}
    />
  )
}
