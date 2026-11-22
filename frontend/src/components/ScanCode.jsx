// Plan > Scan a QR code: the gym check-in's scanner (lib/scan.js: ML Kit in the phone apps,
// components/CameraScan.jsx with jsQR in a browser and the F-Droid build), pointed at openGym's
// own codes. What it read goes where a tap on the same link would go (lib/scan-route.js): a
// friend's routine to its preview, a library routine to the import sheet, a sticker link to the
// sticker's action. Anything else is shown back, so you can see what the camera actually saw.
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { scanCode, webScanner, MODULE_MISSING } from '../lib/scan.js'
import { routeScannedText, shownText } from '../lib/scan-route.js'
import { openRoutinePayload } from './RoutineShare.jsx'
import { openLibraryLink } from './LibraryLink.jsx'
import { handleTagLink } from './Nfc.jsx'
import { exerciseDetailSheet } from '../sheets.jsx'
import { EXIDX } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { nfcReadSupport } from '../lib/nfc.js'
import CameraScan from './CameraScan.jsx'

const ui = () => useUI.getState()

export async function indexAddress() {
  try { return (await import('../lib/routine-library.js')).indexUrl() } catch { return null }
}

/** Sends what a scan read to its handler. Resolves the route it took (tests read it). */
export async function handleScannedText(text, { indexAddress: at } = {}) {
  const route = routeScannedText(text, { indexAddress: at === undefined ? await indexAddress() : at, S: useStore.getState().S })
  if (route.kind === 'routine-link') await openRoutinePayload(route.payload)
  else if (route.kind === 'library') await openLibraryLink(route.link)
  else if (route.kind === 'tag') handleTagLink(route.url)
  else if (route.kind === 'machine') {
    // Outside a workout a machine is its exercise's details; several exercises ask which first.
    const open = id => EXIDX[id] && exerciseDetailSheet(EXIDX[id])
    if (route.ids.length === 1) open(route.ids[0])
    else (await import('./ScanMachine.jsx')).whichExerciseSheet({ ids: route.ids, onExercise: open })
  } else ui().toast(t('That’s not an openGym code: {0}', shownText(route.text) || '?'))
  return route
}

function scanErrorMessage(e) {
  const m = String(e && e.message)
  if (m === 'permission-denied') return t('Camera permission is needed to scan. Enable it in Settings.')
  if (m === 'unsupported') return t('Scanning is not available on this device.')
  return t('Could not start the scanner')
}

/** Opens the camera, reads one code and gives its text to `onText`. */
export async function scanQrWith(onText) {
  const camera = () => ui().openSheet(close => <CameraScan importPhoto onImportError={msg => ui().toast(msg)} onCancel={close} onFound={code => { close(); onText(code?.value) }} />)
  if (await webScanner()) { camera(); return }
  try {
    const code = await scanCode()
    if (code) await onText(code.value)
  } catch (e) {
    // Google's scanner isn't on this phone yet (a Play services download): our own camera instead.
    if (e && e.message === MODULE_MISSING) { camera(); return }
    ui().toast(scanErrorMessage(e))
  }
}

/** Opens the camera, reads one code and handles it. */
export const scanQrCode = () => scanQrWith(handleScannedText)

/** Plan's scan: a device that reads NFC gets the Scan a machine sheet (camera or tag), others the camera. */
export async function scanFromPlan() {
  if ((await nfcReadSupport()).supported) {
    const { scanMachineSheet } = await import('./ScanMachine.jsx')
    scanMachineSheet({ onExercise: id => EXIDX[id] && exerciseDetailSheet(EXIDX[id]), live: null })
    return
  }
  await scanQrCode()
}
