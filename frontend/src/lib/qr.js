// QR rendering for the gym check-in cards (see views/CheckIn.jsx).
//
// We never store a photo of a membership card, only its decoded value (+ its symbology in
// `fmt`). The picture a turnstile scanner reads is regenerated from that value every time the
// card is shown, here.
//
// lean-qr (MIT, see NOTICE.md) is loaded with a dynamic import so its ~4kB only loads when a
// card is actually shown, on every platform — the PWA renders the same code as the app.
//
// QR and supported 1D codes retain their scanned symbology when displayed.

let _leanqr = null

// Cached loader for lean-qr. Resolves once; every card after the first reuses the same module.
async function loadLeanQr() {
  if (!_leanqr) _leanqr = await import('lean-qr')
  return _leanqr
}

// Supported formats must have a matching renderer; never substitute a QR for bars.
export function canRenderFmt(fmt) {
  return normalizeFmt(fmt) === 'qrcode' || !!BARCODE_FORMATS[normalizeFmt(fmt)]
}

export const BARCODE_FORMATS = {
  code128: 'CODE128', code39: 'CODE39', code93: 'CODE93',
  ean13: 'EAN13', ean8: 'EAN8', upca: 'UPC', upce: 'UPCE',
  itf: 'ITF', codabar: 'codabar',
}

export async function renderCodeToCanvas(canvas, value, fmt = 'qrcode') {
  const normalized = normalizeFmt(fmt)
  if (normalized === 'qrcode') return renderQrToCanvas(canvas, value)
  const format = BARCODE_FORMATS[normalized]
  if (!format) throw new Error('Unsupported barcode format')
  const { default: JsBarcode } = await import('jsbarcode')
  JsBarcode(canvas, value, { format, width: 3, height: 120,
    displayValue: false, margin: 24, background: '#ffffff', lineColor: '#000000' })
  return canvas.width
}

// mlkit reports BarcodeFormat as e.g. 'QR_CODE' | 'QrCode'; older callers may pass 'qr'. Fold
// them all to a stable lower-case token we store and compare on.
export function normalizeFmt(fmt) {
  const s = String(fmt || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (s === 'qr' || s === 'qrcode') return 'qrcode'
  return s
}

// Draw `value` as a QR code onto `canvas` at 1 module per pixel; CSS scales it up with
// image-rendering: pixelated (see .qr-canvas in index.css) so it stays crisp at any size.
// `on`/`off` default to solid black on white — turnstile scanners want maximum contrast, not
// the app's theme colours, and a themed (e.g. lime-on-black) code fails to read on many
// readers. Returns the module count (QR size) so the caller can react if it wants.
export async function renderQrToCanvas(canvas, value, { on = '#000000', off = '#ffffff' } = {}) {
  if (!canvas || !value) return 0
  const { generate, correction } = await loadLeanQr()
  // Medium error correction: a good default that survives a scratched or partly-obscured phone
  // screen without inflating the code so much it gets dense on small screens.
  const code = generate(value, { minCorrectionLevel: correction.M })
  code.toCanvas(canvas, {
    on: hexToRgba(on),
    off: hexToRgba(off),
    padX: 2,
    padY: 2,
  })
  return code.size
}

// lean-qr wants colours as [r,g,b,a]. Accept a #rrggbb (or #rgb) string; anything else is
// treated as opaque black/white by the caller's defaults, so this only has to handle hex.
function hexToRgba(hex) {
  let h = String(hex).replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}
