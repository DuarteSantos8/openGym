// QR/barcode rendering for the gym check-in cards (see views/CheckIn.jsx).
//
// We never store a photo of a membership card, only its decoded value (+ its symbology in
// `fmt`). The picture a turnstile scanner reads is regenerated from that value every time the
// card is shown, here.
//
// lean-qr (MIT, see NOTICE.md) is loaded with a dynamic import so its ~4kB only loads when a
// card is actually shown, on every platform — the PWA renders the same code as the app.
//
// JsBarcode supplies the 1D formats, also loaded on demand. Only accept formats that we can
// reproduce: converting a barcode's value to QR would not work with a barcode-only turnstile.

let _leanqr = null
let _jsbarcode = null

const barcodeFormats = {
  code128: 'CODE128', code39: 'CODE39', code93: 'CODE93FullASCII',
  ean13: 'EAN13', ean8: 'EAN8', upca: 'UPC', itf: 'ITF', codabar: 'codabar',
}

async function loadJsBarcode() {
  if (!_jsbarcode) _jsbarcode = (await import('jsbarcode')).default
  return _jsbarcode
}

// Cached loader for lean-qr. Resolves once; every card after the first reuses the same module.
async function loadLeanQr() {
  if (!_leanqr) _leanqr = await import('lean-qr')
  return _leanqr
}

// The intersection of formats our scanners can read and our renderers can reproduce.
export function canRenderFmt(fmt) {
  const f = normalizeFmt(fmt)
  return f === 'qrcode' || Object.hasOwn(barcodeFormats, f)
}

// mlkit reports BarcodeFormat as e.g. 'QR_CODE' | 'QrCode'; older callers may pass 'qr'. Fold
// them all to a stable lower-case token we store and compare on.
export function normalizeFmt(fmt) {
  const s = String(fmt || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (s === 'qr' || s === 'qrcode') return 'qrcode'
  return s
}

// Do not allow the encoder to silently change scanned data (e.g. upper-casing Code 39 or
// supplying missing EAN digits). The encoder then checks the remaining format/checksum rules.
function validBarcodeValue(value, fmt) {
  if (fmt === 'code39') return /^[0-9A-Z\-. $/+%]+$/.test(value)
  // GS1-128 uses FNC1 markers that a plain decoded string cannot faithfully reconstruct.
  if (fmt === 'code128' && (value.startsWith(']C1') || value.includes('\x1d'))) return false
  if (fmt === 'code128' || fmt === 'code93') return /^[\x00-\x7f]+$/.test(value)
  if (fmt === 'ean13') return /^\d{13}$/.test(value)
  if (fmt === 'ean8') return /^\d{8}$/.test(value)
  if (fmt === 'upca') return /^\d{12}$/.test(value)
  if (fmt === 'itf') return /^(?:\d{2})+$/.test(value)
  if (fmt === 'codabar') return /^(?:[A-D][0-9\-$:.+/]+[A-D]|[0-9\-$:.+/]+)$/.test(value)
  return false
}

async function encodeBarcode(value, fmt, target = {}) {
  if (!validBarcodeValue(value, fmt)) throw new Error('Invalid barcode value')
  const JsBarcode = await loadJsBarcode()
  JsBarcode(target, value, {
    format: barcodeFormats[fmt], displayValue: false,
    width: 2, height: 90, margin: 20, background: '#ffffff', lineColor: '#000000',
  })
  return target
}

// Validate before saving, without needing a canvas. Values are kept byte-for-byte; leading
// zeroes and surrounding whitespace can be meaningful membership data.
export async function validateCode(value, fmt) {
  if (typeof value !== 'string' || !value.length || !canRenderFmt(fmt)) return false
  const f = normalizeFmt(fmt)
  try {
    if (f === 'qrcode') {
      const { generate, correction } = await loadLeanQr()
      generate(value, { minCorrectionLevel: correction.M })
    } else {
      await encodeBarcode(value, f)
    }
    return true
  } catch (e) { return false }
}

export async function renderCodeToCanvas(canvas, value, fmt = 'qrcode') {
  if (!canvas || !value) return 0
  const f = normalizeFmt(fmt)
  if (f === 'qrcode') return renderQrToCanvas(canvas, value)
  if (!canRenderFmt(f)) throw new Error('Unsupported barcode format')
  await encodeBarcode(value, f, canvas)
  return canvas.width
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
