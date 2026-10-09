import { imgSrc } from './exercises.js'
import { mediaOf } from './media-refs.js'
import { mediaStore } from './media-store.js'
import { fetchToStore, mayFetch } from './media-sync.js'

export function watchThumbnailFor(ex) {
  if (!ex?.custom) return ex?.img ? { key: `builtin:${imgSrc(ex)}`, url: imgSrc(ex) } : null
  const media = mediaOf(ex)
  const file = media?.poster || (media?.kind === 'image' || media?.kind === 'gif' ? media : null)
  return file ? { key: `custom:${file.hash}`, file } : null
}

async function stillBytes(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Thumbnail timeout')), 8000)
      image.onload = () => { clearTimeout(timeout); resolve() }
      image.onerror = () => { clearTimeout(timeout); reject(new Error('Thumbnail unavailable')) }
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 96
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 96, 96)
    const scale = Math.min(96 / image.naturalWidth, 96 / image.naturalHeight)
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale
    context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height)
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
  } finally { URL.revokeObjectURL(url) }
}

export async function syncWatchThumbnails(native, store, descriptors) {
  // Send only files the Watch has not acknowledged, rather than repeating images on every set.
  const { missing = [] } = await native.missingThumbnails({ keys: descriptors.map(d => d.key) })
  const needed = new Set(missing)
  for (const descriptor of descriptors) {
    if (!needed.has(descriptor.key)) continue
    try {
      if (descriptor.url) {
        await native.sendThumbnail({ key: descriptor.key, url: descriptor.url })
      } else {
        const { file } = descriptor
        let record = await mediaStore.get(file.hash)
        const state = store.getState()
        if (!record && state.user && state.config?.media && mayFetch(file.hash)) {
          await fetchToStore(file.hash, file)
          record = await mediaStore.get(file.hash)
        }
        if (record?.blob) await native.sendThumbnail({ key: descriptor.key, data: await stillBytes(record.blob) })
      }
    } catch { /* An unavailable image leaves the exercise's neutral thumbnail. */ }
  }
}
