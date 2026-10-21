// Browser-side QR/barcode decoding for the gym check-in — the PWA half of lib/scan.js. The app build
// hands scanning to ML Kit; here in a browser tab (installed PWA on a phone, most often) we do
// it ourselves: draw the source — an uploaded photo or a live <video> frame — onto an offscreen
// canvas and decode the pixels.
//
// Two decoders, tried in order:
//   1. BarcodeDetector — the browser's own (Chrome/Edge on Android, Samsung Internet). Native
//      speed and quality when it exists; asked for the formats we can redraw.
//   2. ZXing (Apache-2.0, see NOTICE.md) — pure JS, works everywhere including iOS Safari, which
//      has no BarcodeDetector. Loaded with a dynamic import so it only ships when someone scans.
//
// decodeImageData is the pure core (pixels in, string out) and is what the unit test exercises;
// decodeSource wraps it with the canvas plumbing the browser paths need.
import { canRenderFmt, normalizeFmt } from './qr.js'

let _zxing = null
async function loadZxing() {
  if (!_zxing) _zxing = await import('@zxing/library')
  return _zxing
}

let _detector = null
async function nativeDetector() {
  if (_detector === null) _detector = (async () => {
    try {
      if (typeof BarcodeDetector !== 'function') return false
      const supported = await BarcodeDetector.getSupportedFormats()
      const formats = supported.filter(canRenderFmt)
      return formats.length ? new BarcodeDetector({ formats }) : false
    } catch (e) { return false }
  })()
  return _detector
}

// { data, width, height } (an ImageData or anything shaped like one) → { value, fmt } | null.
// ZXing's RGBLuminanceSource takes grayscale bytes, not ImageData's interleaved RGBA bytes.
export async function decodeImageData(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  const { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } = await loadZxing()
  const { width, height, data } = img
  if (data.length < width * height * 4) return null
  const luminance = new Uint8ClampedArray(width * height)
  for (let i = 0; i < luminance.length; i++) {
    const p = i * 4, alpha = data[p + 3] / 255
    luminance[i] = (data[p] + 2 * data[p + 1] + data[p + 2]) / 4 * alpha + 255 * (1 - alpha)
  }
  const hints = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, Object.entries(BarcodeFormat)
      .filter(([name, value]) => typeof value === 'number' && canRenderFmt(name)).map(([, value]) => value)],
    [DecodeHintType.TRY_HARDER, true],
    [DecodeHintType.RETURN_CODABAR_START_END, true],
    // Preserve the GS1 marker/separators so validation can refuse codes that need FNC1 rather
    // than silently losing those markers and saving a different plain Code 128 payload.
    [DecodeHintType.ASSUME_GS1, true],
  ])
  const reader = new MultiFormatReader()
  reader.setHints(hints)
  // RGBLuminanceSource cannot rotate itself. Try a quarter turn too so portrait photos of
  // membership cards work, and preserve the old QR fallback's support for inverted codes.
  for (let rotation = 0; rotation < 2; rotation++) {
    let pixels = luminance, w = width, h = height
    if (rotation) {
      pixels = new Uint8ClampedArray(luminance.length)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) pixels[x * height + height - y - 1] = luminance[y * width + x]
      }
      w = height; h = width
    }
    const source = new RGBLuminanceSource(pixels, w, h)
    for (const input of [source, source.invert()]) {
      try {
        const hit = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(input)))
        const value = hit.getText(), fmt = normalizeFmt(BarcodeFormat[hit.getBarcodeFormat()])
        if (value && canRenderFmt(fmt)) return { value, fmt }
      } catch (e) { /* no readable code in this orientation */ }
    }
  }
  return null
}

// Decode from anything drawImage accepts: <video>, <img>, ImageBitmap, canvas. The source is
// scaled down to at most MAX px on its long edge, retaining enough detail for narrow barcode
// bars while keeping decoding practical on a phone. Reuses one canvas across calls.
const MAX = 1280
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

  const det = await nativeDetector()
  if (det) {
    try {
      const found = await det.detect(_canvas)
      const b = found && found.find(x => x.rawValue && canRenderFmt(x.format))
      if (b) return { value: b.rawValue, fmt: normalizeFmt(b.format) }
    } catch (e) { /* fall through to ZXing */ }
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
