// QR rendering for the gym check-in cards (see views/CheckIn.jsx).
//
// We never store a photo of a membership card, only its decoded value (+ its symbology in
// `fmt`). The picture a turnstile scanner reads is regenerated from that value every time the
// card is shown, here.
//
// lean-qr (MIT, see NOTICE.md) is loaded with a dynamic import so its ~4kB only loads when a
// card is actually shown, on every platform — the PWA renders the same code as the app.
//
// Scope: lean-qr generates QR codes; Code 128 barcodes are drawn by lib/code128.js (see
// components/CardCode.jsx). The capture flow (lib/scan.js) refuses any symbology we cannot
// faithfully reproduce, so a stored card is guaranteed renderable — canRenderFmt() is the single
// source of that truth, shared by both sides.

import { code128Symbols } from './code128.js'

let _leanqr = null

// Cached loader for lean-qr. Resolves once; every card after the first reuses the same module.
async function loadLeanQr() {
  if (!_leanqr) _leanqr = await import('lean-qr')
  return _leanqr
}

// The symbologies we can both read (mlkit / BarcodeDetector) AND redraw. Stored `fmt` is a
// lower-cased BarcodeFormat. QR is drawn by lean-qr; Code 128 - the 1D barcode many gyms use, and
// the only kind a laser turnstile can read - by lib/code128.js. Other 1D kinds (EAN, Code 39...)
// are still refused: a code we can't redraw faithfully is worse than not storing it - it would
// look scannable but carry the wrong bars.
export function canRenderFmt(fmt) {
  const f = normalizeFmt(fmt)
  return f === 'qrcode' || f === 'code128'
}

// The value as a card stores it. A QR's value is trimmed (stray whitespace from a decoder, as
// before), but a Code 128 value is kept byte for byte: every character, edge spaces included, is
// in the bars, so trimming it would make a different code from the one on the card.
export function cardCodeValue(value, fmt) {
  const s = String(value ?? '')
  return normalizeFmt(fmt) === 'code128' ? s : s.trim()
}

// Whether this exact value can be redrawn in this symbology - the check a scan, the preview and a
// save all go through, so a card is never stored that would show a blank plate at the turnstile.
// canRenderFmt alone isn't enough: a decoder can report Code 128 with characters set B can't carry
// (a GS1 FNC1 separator comes out as \u001d). We don't claim GS1-128: without the decoder's FNC1
// metadata it can't be redrawn faithfully, so it is refused like any other code we can't draw.
export function canRenderCode(value, fmt) {
  if (!canRenderFmt(fmt)) return false
  const v = cardCodeValue(value, fmt)
  if (!v) return false
  return normalizeFmt(fmt) === 'code128' ? code128Symbols(v) !== null : true
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
