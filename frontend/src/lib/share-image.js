// Hands a finished PNG to the person: the OS share sheet in the phone app the way a backup goes
// out, a browser that can share files (most phones) opens its own, and anything else saves the
// picture as a download.
import { MOBILE, shareExportBlob } from './mobile.js'
import { useUI } from '../store/useUI.js'
import { t } from './i18n.js'

export async function shareImage(blob, name, title) {
  if (MOBILE) { try { await shareExportBlob(blob, name) } catch (e) { /* share sheet dismissed */ } return }
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }) } catch (e) { /* dismissed */ }
    return
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  useUI.getState().toast(t('Image saved'))
}
