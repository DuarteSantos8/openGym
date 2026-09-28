// Capturing a gym check-in code (see views/CheckIn.jsx). Three ways in:
//   1. type it            — no plugin, handled entirely in the view
//   2. import a photo      — importCodeFromImage(file): decode a picture the user already has
//   3. scan with camera    — scanCode(): live camera via ML Kit's own scanner UI (app build);
//                            in a browser the view opens components/CameraScan.jsx instead
//
// The app build (MOBILE) decodes with @capacitor-mlkit/barcode-scanning (Apache-2.0, see
// NOTICE.md), dynamic-imported so it never lands in the web bundle. In a browser — the PWA on a
// phone is the common case — photo import goes through lib/scan-web.js (BarcodeDetector where the
// browser has one, jsQR otherwise). scanCode() itself is app-only: ML Kit brings its own camera
// UI, the browser path is a React sheet and lives with the view.
//
// What comes back is a normalized { value, fmt } (or null when the user cancels / nothing was
// found). `value` is the code's machine-readable content; `fmt` is a lower-cased symbology token
// matching lib/qr.js's normalizeFmt. The caller checks canRenderFmt(fmt) before saving — we can
// read many barcode kinds but only redraw QR, so a non-QR code is reported and refused there, not
// silently stored.
import { MOBILE } from './mobile.js'
import { normalizeFmt } from './qr.js'

// A found barcode from either path → our stored shape. mlkit gives rawValue (machine-readable,
// what a turnstile actually reads) and a BarcodeFormat; we keep rawValue and fold the format.
function toCode(barcode) {
  if (!barcode) return null
  const value = barcode.rawValue || barcode.displayValue || ''
  if (!value) return null
  return { value, fmt: normalizeFmt(barcode.format) }
}

// Live camera scan. On Android this opens Google's own full-screen scanner UI (no camera view we
// have to host); on iOS the plugin's native scanner. Returns the first barcode found, or null if
// the user backed out without scanning. Throws if scanning isn't supported or permission is hard-
// denied so the caller can explain why.
export async function scanCode() {
  if (!MOBILE) throw new Error('Scanning is only available in the app')
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')

  const { supported } = await BarcodeScanner.isSupported()
  if (!supported) throw new Error('unsupported')

  await ensureCameraPermission(BarcodeScanner)
  await ensureScannerModule(BarcodeScanner)

  const { barcodes } = await BarcodeScanner.scan()
  return barcodes && barcodes.length ? toCode(barcodes[0]) : null
}

// Decode a barcode out of an image the user picked. mlkit's readBarcodesFromImage wants a local
// file PATH, and a browser <input type=file> only hands us a File/blob — so we bounce the bytes
// through the app's cache dir (reusing @capacitor/filesystem, already a dependency) to get a real
// path, decode, then delete the temp file. Returns the first barcode, or null if none was found.
export async function importCodeFromImage(file) {
  if (!file) return null
  if (!MOBILE) return (await import('./scan-web.js')).importCodeFromImageWeb(file)
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
  const { Filesystem, Directory } = await import('@capacitor/filesystem')

  const base64 = await fileToBase64(file)
  const name = `checkin-import-${Date.now()}.${extOf(file.name)}`
  let uri = null
  try {
    const w = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: base64 })
    uri = w.uri
    const { barcodes } = await BarcodeScanner.readBarcodesFromImage({ path: uri })
    return barcodes && barcodes.length ? toCode(barcodes[0]) : null
  } finally {
    // Best effort — a leftover temp image in the cache dir is harmless, but tidy up anyway.
    try { await Filesystem.deleteFile({ path: name, directory: Directory.Cache }) } catch (e) { /* */ }
  }
}

// Camera permission for the live scanner. checkPermissions first so an already-granted user never
// sees a prompt; request only when needed. A hard denial throws so the caller can point the user
// at Settings rather than silently doing nothing.
async function ensureCameraPermission(BarcodeScanner) {
  let { camera } = await BarcodeScanner.checkPermissions()
  if (camera !== 'granted' && camera !== 'limited') {
    ({ camera } = await BarcodeScanner.requestPermissions())
  }
  if (camera !== 'granted' && camera !== 'limited') throw new Error('permission-denied')
}

// On Android the ML Kit scanner ships as an on-demand Google Play module, absent on first use.
// Install it (once) before scanning; a no-op / not-applicable on iOS, where the check simply
// reports available. Failures here are non-fatal — scan() will surface a clearer error if it
// truly can't proceed.
async function ensureScannerModule(BarcodeScanner) {
  try {
    if (!BarcodeScanner.isGoogleBarcodeScannerModuleAvailable) return
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule()
  } catch (e) { /* let scan() decide whether it can still run */ }
}

// A File/Blob → bare base64 (no data: prefix), which Filesystem.writeFile expects.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.onload = () => {
      const s = String(r.result || '')
      const comma = s.indexOf(',')
      resolve(comma === -1 ? s : s.slice(comma + 1))
    }
    r.readAsDataURL(file)
  })
}

function extOf(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(filename || '')
  return m ? m[1].toLowerCase() : 'jpg'
}
