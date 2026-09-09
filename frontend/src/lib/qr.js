// QR rendering for the gym check-in cards (see views/CheckIn.jsx).
//
// We never store a photo of a membership card, only its decoded value (+ its symbology in
// `fmt`). The picture a turnstile scanner reads is regenerated from that value every time the
// card is shown, here.
//
// lean-qr (MIT, see NOTICE.md) is loaded with a dynamic import so its ~4kB only loads when a
// card is actually shown, on every platform — the PWA renders the same code as the app.
//
// Scope: lean-qr generates QR codes only. A gym card is virtually always a QR code, and the
// capture flow (lib/scan.js) refuses any symbology we cannot faithfully reproduce, so a stored
// card is guaranteed renderable here — canRenderFmt() is the single source of that truth, shared
// by both sides.

let _leanqr = null

// Cached loader for lean-qr. Resolves once; every card after the first reuses the same module.
async function loadLeanQr() {
  if (!_leanqr) _leanqr = await import('lean-qr')
  return _leanqr
}

// The symbologies we can both read (mlkit) AND redraw (lean-qr). Stored `fmt` is a lower-cased
// BarcodeFormat. Only QR qualifies: reproducing an EAN/Code128/etc. would need a 1D renderer we
// deliberately did not add, and a code we can't redraw faithfully is worse than not storing it —
// it would look scannable but carry the wrong bars.
export function canRenderFmt(fmt) {
  return normalizeFmt(fmt) === 'qrcode'
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
