// What to tell someone whose scanner would not start: the reasons lib/scan.js throws, in words
// they can act on. Shared by the gym check-in (views/CheckIn.jsx) and the exercise codes
// (components/CameraScan.jsx scanOnce).
import { t } from './i18n.js'

export function scanErrorMessage(e) {
  const m = String(e && e.message)
  if (m === 'permission-denied') return t('Camera permission is needed to scan. Enable it in Settings.')
  if (m === 'unsupported') return t('Scanning is not available on this device.')
  return t('Could not start the scanner')
}
