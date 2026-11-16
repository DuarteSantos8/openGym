// How a picture leaves the app: drawn on a canvas made here, then the OS share sheet in the phone
// apps, the browser's share sheet where it can share files, or a download. Nothing is uploaded.
import { MOBILE, shareExportBlob, saveImageToPhotos } from './mobile.js'
import { t } from './i18n-core.js'

/** A canvas of the given size, its context, and a measure(text, weight, size) on it. null without canvas support. */
export function makeCanvas(width, height, family) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext?.('2d')
  if (!ctx) return null
  canvas.width = width
  canvas.height = height
  const measure = (text, weight, size) => { ctx.font = `${weight} ${size}px ${family}`; return ctx.measureText(String(text)).width }
  return { canvas, ctx, measure }
}
export const toPng = canvas => new Promise(resolve => {
  try { canvas.toBlob(resolve, 'image/png') } catch (e) { resolve(null) }
})

/** The accent the app is showing right now, read off the root element. */
export function currentAccent() {
  try { return getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#a3e635' } catch (e) { return '#a3e635' }
}
export const isRtl = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl'

/**
 * Out of the app: the OS share sheet in the phone apps (Capacitor Share, through a file in the
 * cache, as a backup goes), the browser's own share sheet where it can share files (most phones),
 * a download anywhere else. `toast` says where a download went.
 */
export async function shareImage(blob, name, title, toast) {
  if (!blob) return false
  if (MOBILE) { try { await shareExportBlob(blob, name) } catch (e) { /* share sheet dismissed */ } return true }
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null
  if (file && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }) } catch (e) { /* dismissed */ }
    return true
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  toast?.(t('Image saved'))
  return true
}

/**
 * Into the phone's Photos / gallery without the share sheet. On the web it is the download the
 * share falls back to anyway. Returns true when the picture is saved (or the share sheet took over).
 */
export async function saveImage(blob, name, title, toast) {
  if (!blob) return false
  if (!MOBILE) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast?.(t('Image saved'))
    return true
  }
  let r
  try { r = await saveImageToPhotos(blob, name) } catch (e) { toast?.(t('Could not save the picture.')); return false }
  if (r === 'saved') { toast?.(t('Saved to Photos')); return true }
  if (r === 'denied') { toast?.(t('openGym may not add pictures to Photos. You can allow it in the phone settings.')); return false }
  return shareImage(blob, name, title, toast)
}
