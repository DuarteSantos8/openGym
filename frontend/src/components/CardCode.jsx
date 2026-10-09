import { useEffect, useRef, useState } from 'react'
import QrCanvas from './QrCanvas.jsx'
import { normalizeFmt } from '../lib/qr.js'
import { encodeCode128 } from '../lib/code128.js'
import { t } from '../lib/i18n.js'

// A gym card's code in whichever symbology it was scanned as: a QR (QrCanvas) or a Code 128
// barcode. `size` is the QR's edge; a barcode uses it as its width and is drawn wide and short,
// the shape a laser reader expects.
export default function CardCode({ value, fmt, size = 240 }) {
  if (normalizeFmt(fmt) === 'code128') return <Code128Canvas value={value} width={size} />
  return <QrCanvas value={value} size={size} />
}

// Quiet zone each side, in modules. The spec asks for 10; the white plate around the canvas adds
// more, but the canvas carries its own so the code reads even if the plate's padding changes.
const QUIET = 10

// Like QrCanvas: 1 module per canvas pixel, scaled up by CSS with nearest-neighbour (.qr-canvas)
// so every bar edge stays sharp. An unencodable value draws nothing.
function Code128Canvas({ value, width }) {
  const ref = useRef(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const canvas = ref.current
    const runs = encodeCode128(value)
    if (!canvas || !runs) { setOk(false); return }
    const modules = runs.reduce((a, b) => a + b, 0) + 2 * QUIET
    canvas.width = modules
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) { setOk(false); return }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, modules, 1)
    ctx.fillStyle = '#000000'
    let x = QUIET
    runs.forEach((w, i) => {
      if (i % 2 === 0) ctx.fillRect(x, 0, w, 1)   // even runs are bars, odd runs spaces
      x += w
    })
    setOk(true)
  }, [value])

  return (
    <canvas
      ref={ref}
      className="qr-canvas"
      style={{ width, height: Math.round(width * 0.42), opacity: ok ? 1 : 0 }}
      aria-label={t('Barcode')}
    />
  )
}
