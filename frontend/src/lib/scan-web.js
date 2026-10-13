// Browser-side QR decoding for the gym check-in — the PWA half of lib/scan.js. The app build
// hands scanning to ML Kit; here in a browser tab (installed PWA on a phone, most often) we do
// it ourselves: draw the source — an uploaded photo or a live <video> frame — onto an offscreen
// canvas and decode the pixels.
//
// Native BarcodeDetector where available, jsQR for QR codes, and ZXing for 1D
// barcodes on Safari. All decoding stays on the device.
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
    _detector = (typeof BarcodeDetector === 'function') ? new BarcodeDetector() : false
  } catch (e) { _detector = false }
  return _detector
}

// { data, width, height } (an ImageData or anything shaped like one) → { value, fmt } | null.
// jsQR only; the native detector wants a drawable, not raw pixels, so it lives in decodeSource.
export async function decodeImageData(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  const jsQR = await loadJsQr()
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  if (hit && hit.data) return { value: hit.data, fmt: 'qrcode' }
  // Safari lacks BarcodeDetector: decode 1D codes locally with ZXing.
  const { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource,
    BinaryBitmap, HybridBinarizer } = await import('@zxing/library')
  const pixels = new Int32Array(img.width * img.height)
  for (let i = 0; i < pixels.length; i++) {
    const p = i * 4
    pixels[i] = (img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2]
  }
  const reader = new MultiFormatReader()
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.CODABAR])
  hints.set(DecodeHintType.TRY_HARDER, true)
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, img.width, img.height)))
    const result = reader.decode(bitmap, hints)
    return { value: result.getText(), fmt: normalizeFmt(BarcodeFormat[result.getBarcodeFormat()]) }
  } catch (e) {
    if (['NotFoundException', 'ChecksumException', 'FormatException'].includes(e?.constructor?.name)) return null
    throw e
  } finally { reader.reset() }
}

// Decode from anything drawImage accepts: <video>, <img>, ImageBitmap, canvas. The source is
// scaled down to at most MAX px on its long edge — plenty for a QR, and it keeps jsQR fast enough
// to run on every few video frames on a phone. Reuses one canvas across calls.
const MAX = 800
let _canvas = null
export async function decodeSource(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0
  const sh = source.videoHeight || source.naturalHeight || source.height || 0
  if (!sw || !sh) return null
  const k = Math.min(1, MAX / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k))
  if (!_canvas) _canvas = document.createElement('canvas')
  _canvas.width = w; _canvas.height = h
  const ctx = _canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)

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
