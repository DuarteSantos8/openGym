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

// A Pro iPhone hands `facingMode: environment` its virtual multi-lens camera ("Back Triple
// Camera"), which swaps lenses — wide, ultra wide for macro, telephoto — as the distance changes:
// the picture zooms back and forth while you aim. Its plain wide camera ("Back Camera") keeps
// still. Device names only show once the camera is allowed, and they are in the phone's language.
const BACK_CAM = /\b(back|rear)\b|rück|arrière|trasera|posterior|traseira|задн|後|背面|후면/i
const MULTI_LENS = /dual|triple|dreifach|zweifach|ultra|tele|wide|weitwinkel|double|doble|tripl|grand.?angle|gran.?angular|grandangolo|двой|трой|широк|теле|广角|雙|双|三|長焦|长焦|광각|망원|듀얼|트리플/i

/**
 * The deviceId of the one plain rear camera to switch to, or null to keep the camera there is:
 * only when the current one is a multi-lens rear camera and exactly one plain rear camera sits
 * next to it (an iPhone). Android names its cameras "camera2 0, facing back" without saying which
 * lens is which, and a laptop has one camera: both keep theirs.
 */
export function steadyBackCamera(devices, currentLabel = '') {
  if (!MULTI_LENS.test(currentLabel) || !BACK_CAM.test(currentLabel)) return null
  const back = (Array.isArray(devices) ? devices : [])
    .filter(d => d && d.kind === 'videoinput' && d.deviceId && BACK_CAM.test(d.label || ''))
  const plain = back.filter(d => !MULTI_LENS.test(d.label))
  return plain.length === 1 && back.some(d => MULTI_LENS.test(d.label)) ? plain[0].deviceId : null
}
