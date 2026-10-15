// Browser-side QR decoding for the gym check-in — the PWA half of lib/scan.js. The app build
// hands scanning to ML Kit; here in a browser tab (installed PWA on a phone, most often) we do
// it ourselves: draw the source — an uploaded photo or a live <video> frame — onto an offscreen
// canvas and decode the pixels.
//
// Two decoders, tried in order:
//   1. BarcodeDetector — the browser's own (Chrome/Edge on Android, Samsung Internet). Native
//      speed and quality when it exists; asked for QR only.
//   2. jsQR (Apache-2.0, see NOTICE.md) — pure JS, works everywhere including iOS Safari, which
//      has no BarcodeDetector. Loaded with a dynamic import so it only ships when someone scans.
//
// decodeImageData is the pure core (pixels in, string out) and is what the unit test exercises;
// decodeSource wraps it with the canvas plumbing the browser paths need.
import { normalizeFmt } from './qr.js'

let _jsqr = null
async function loadJsQr() {
  if (!_jsqr) _jsqr = (await import('jsqr')).default
  return _jsqr
}

let _detector = null
function nativeDetector() {
  if (_detector !== null) return _detector
  try {
    _detector = (typeof BarcodeDetector === 'function') ? new BarcodeDetector({ formats: ['qr_code'] }) : false
  } catch (e) { _detector = false }
  return _detector
}

// { data, width, height } (an ImageData or anything shaped like one) → { value, fmt } | null.
// jsQR only; the native detector wants a drawable, not raw pixels, so it lives in decodeSource.
export async function decodeImageData(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  const jsQR = await loadJsQr()
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return hit && hit.data ? { value: hit.data, fmt: 'qrcode' } : null
}

// Product barcodes (EAN-13, EAN-8, UPC-A, UPC-E) for the food scanner. The browser's own
// BarcodeDetector when it has one; otherwise ZXing's pure-JS reader, loaded only when someone
// scans a product. Same shape as the QR path: pixels in, { value, fmt } out.
const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
let _productDetector = null
// The native detector only when it reads all four product formats; a browser without
// BarcodeDetector, or with a partial list, goes to ZXing alone.
async function productDetector() {
  if (_productDetector !== null) return _productDetector
  try {
    if (typeof BarcodeDetector !== 'function') {
      _productDetector = false
    } else {
      const supported = typeof BarcodeDetector.getSupportedFormats === 'function' ? await BarcodeDetector.getSupportedFormats() : []
      _productDetector = PRODUCT_FORMATS.every(f => supported.includes(f)) ? new BarcodeDetector({ formats: PRODUCT_FORMATS }) : false
    }
  } catch (e) { _productDetector = false }
  return _productDetector
}

/** Forgets the detector probe (tests change what the browser offers). */
export function resetProductDetector() { _productDetector = null }

let _zxing = null
async function loadZxing() {
  if (!_zxing) {
    const z = await import('@zxing/library')
    const reader = new z.MultiFormatReader()
    reader.setHints(new Map([
      [z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E]],
      [z.DecodeHintType.TRY_HARDER, true],
    ]))
    _zxing = { z, reader }
  }
  return _zxing
}

// { data, width, height } → { value, fmt } | null. A frame with no barcode in it is the normal
// case while the camera searches, so a not-found is null, not an error.
export async function decodeProductImageData(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  const { z, reader } = await loadZxing()
  const lum = new Uint8ClampedArray(img.width * img.height)
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (img.data[p] * 306 + img.data[p + 1] * 601 + img.data[p + 2] * 117) >> 10
  }
  try {
    // decodeWithState keeps the hints set above; decode() would reset them to none.
    const hit = reader.decodeWithState(new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(lum, img.width, img.height))))
    return { value: hit.getText(), fmt: normalizeFmt(z.BarcodeFormat[hit.getBarcodeFormat()]) }
  } catch (e) {
    return null
  }
}

// Decode from anything drawImage accepts: <video>, <img>, ImageBitmap, canvas. The source is
// scaled down to at most MAX px on its long edge — plenty for a QR, and it keeps jsQR fast enough
// to run on every few video frames on a phone. Reuses one canvas across calls. `product` reads
// EAN/UPC product barcodes instead of QR; those are thin bars, so the frame keeps more width.
const MAX = 800
const MAX_PRODUCT = 1280
let _canvas = null
export async function decodeSource(source, { product = false } = {}) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0
  const sh = source.videoHeight || source.naturalHeight || source.height || 0
  if (!sw || !sh) return null
  const k = Math.min(1, (product ? MAX_PRODUCT : MAX) / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k))
  if (!_canvas) _canvas = document.createElement('canvas')
  _canvas.width = w; _canvas.height = h
  const ctx = _canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)

  if (product) {
    const native = await productDetector()
    if (native) {
      // It reads every product format, so a frame it finds nothing in has none: no ZXing pass.
      try {
        const found = await native.detect(_canvas)
        const b = found && found.find(x => x.rawValue)
        return b ? { value: b.rawValue, fmt: normalizeFmt(b.format) } : null
      } catch (e) { /* a detector that throws falls through to ZXing */ }
    }
    return decodeProductImageData(ctx.getImageData(0, 0, w, h))
  }

  const det = nativeDetector()
  if (det) {
    try {
      const found = await det.detect(_canvas)
      const b = found && found.find(x => x.rawValue)
      if (b) return { value: b.rawValue, fmt: normalizeFmt(b.format) || 'qrcode' }
    } catch (e) { /* fall through to jsQR */ }
  }
  return decodeImageData(ctx.getImageData(0, 0, w, h))
}

// A picked File → { value, fmt } | null. createImageBitmap honours EXIF orientation where the
// browser supports it, which matters for photos of a card taken in portrait.
export async function importCodeFromImageWeb(file) {
  if (!file) return null
  let bmp
  if (typeof createImageBitmap === 'function') {
    bmp = await createImageBitmap(file)
  } else {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('bad image'))
      img.src = URL.createObjectURL(file)
    })
  }
  try { return await decodeSource(bmp) } finally { if (bmp.close) bmp.close() }
}
