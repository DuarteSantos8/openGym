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

// Each module is a whole number of physical pixels: the widest that fits `width`, never a
// fractional stretch, which would make equal bars come out 2 and 3 device pixels wide at random -
// enough to throw a laser reader. A code too long to fit even at one pixel a module is drawn at
// one anyway and overflows its plate (which scrolls) rather than being squeezed into blur. The
// height doesn't matter to a 1D reader, so a one-row canvas is stretched to it by CSS.
// An unencodable value draws nothing (CheckIn never stores one; see canRenderCode).
function Code128Canvas({ value, width }) {
  const ref = useRef(null)
  const [ok, setOk] = useState(false)
  const runs = encodeCode128(value)
  const modules = runs ? runs.reduce((a, b) => a + b, 0) + 2 * QUIET : 0
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const px = modules ? Math.max(1, Math.floor(width * dpr / modules)) : 1   // device px a module

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !runs) { setOk(false); return }
    canvas.width = modules * px
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) { setOk(false); return }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, modules * px, 1)
    ctx.fillStyle = '#000000'
    let x = QUIET
    runs.forEach((w, i) => {
      if (i % 2 === 0) ctx.fillRect(x * px, 0, w * px, 1)   // even runs are bars, odd runs spaces
      x += w
    })
    setOk(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, modules, px])

  return (
    <canvas
      ref={ref}
      className="qr-canvas"
      style={{ width: modules * px / dpr, height: Math.round(width * 0.42), opacity: ok ? 1 : 0 }}
      aria-label={t('Barcode')}
    />
  )
}
