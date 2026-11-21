// The body picker's own photos (components/BodyFocus.jsx): one from the front, one from the back.
//
// They never leave this device. They live in their own IndexedDB database, apart from the media
// store (lib/media-store.js), so nothing that syncs, uploads, backs up or cleans media ever sees
// them. Each record keeps the photo's bytes as an ArrayBuffer (WebKit loses large Blobs kept in
// IndexedDB, see lib/media-store-idb.js) and the pose landmarks found in it once, when it was
// added, so opening Today never runs the model.
//
// The landmarks come from the pose model this build already ships for the Movement Lab
// (scripts/stage-mediapipe.mjs): loaded from the app's own files, only when a photo is added,
// and run on the device on that one still image.
import { WASM_PATH, MODEL_PATH } from './pose-session.js'

const DB = 'ironvane-body'
const STORE = 'photos'
export const MAX_SIDE = 1280

/** The size a photo is kept at: its longest side at most `max` pixels. */
export function fitSize(w, h, max = MAX_SIDE) {
  const s = Math.min(1, max / Math.max(w, h))
  return { w: Math.round(w * s), h: Math.round(h * s) }
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d
/** The model's landmarks as kept: x and y (0-1 of the photo) and how sure it was. */
export function toLandmarks(list) {
  if (!Array.isArray(list)) return null
  return list.map(p => ({ x: round(p.x, 5), y: round(p.y, 5), visibility: round(p.visibility ?? 1, 3) }))
}

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error || new Error('aborted'))
})

/**
 * { open, get(view), put(record), remove(view) }. A record is
 * { view: 'front'|'back', data: ArrayBuffer, mime, w, h, lm: landmarks, at }.
 * Where IndexedDB cannot open (some private windows), the photos are kept in memory until the
 * page closes; open() answers false so the screen can say so.
 */
export function photoStore({ idb = globalThis.indexedDB } = {}) {
  let db = null
  const mem = new Map()
  let opening = null
  const open = () => opening || (opening = (async () => {
    if (!idb) return false
    try {
      db = await new Promise((resolve, reject) => {
        const r = idb.open(DB, 1)
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'view' }) }
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
        r.onblocked = () => reject(new Error('blocked'))
      })
      db.onversionchange = () => { try { db.close() } catch { /* closed */ } db = null }
      return true
    } catch {
      db = null
      return false
    }
  })())
  return {
    open,
    async get(view) {
      await open()
      if (!db) return mem.get(view) || null
      return (await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(view))) || null
    },
    async put(record) {
      await open()
      if (!db) { mem.set(record.view, record); return }
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record)
      await done(tx)
    },
    async remove(view) {
      await open()
      if (!db) { mem.delete(view); return }
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(view)
      await done(tx)
    },
  }
}

/**
 * A picked file drawn upright and shrunk onto a canvas, and the JPEG it is kept as.
 * Resolves { canvas, w, h, data, mime }; rejects when the file is not a picture the browser reads.
 */
export async function preparePhoto(file, { doc = globalThis.document } = {}) {
  let src, cleanup = () => {}
  if (typeof globalThis.createImageBitmap === 'function') {
    src = await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' })
    cleanup = () => src.close?.()
  } else {
    const url = URL.createObjectURL(file)
    src = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('unreadable'))
      img.src = url
    })
    cleanup = () => URL.revokeObjectURL(url)
  }
  try {
    const { w, h } = fitSize(src.width, src.height)
    const canvas = doc.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(src, 0, 0, w, h)
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.86))
    return { canvas, w, h, data: await blob.arrayBuffer(), mime: 'image/jpeg' }
  } finally { cleanup() }
}

/**
 * The pose in one still image (a canvas or an image), or null when no body is in it. The model
 * is created for this image and closed again; the GPU is tried first, the CPU when it fails.
 */
export async function detectPose(source, {
  base = import.meta.env?.BASE_URL || './', loadVision = () => import('@mediapipe/tasks-vision'),
} = {}) {
  const { FilesetResolver, PoseLandmarker } = await loadVision()
  const fileset = await FilesetResolver.forVisionTasks(base + WASM_PATH)
  let landmarker = null, last
  for (const delegate of ['GPU', 'CPU']) {
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + MODEL_PATH, delegate },
        runningMode: 'IMAGE', numPoses: 1,
      })
      break
    } catch (e) { last = e }
  }
  if (!landmarker) throw last || new Error('model')
  try {
    const res = landmarker.detect(source)
    return toLandmarks(res?.landmarks?.[0]) || null
  } finally {
    try { landmarker.close() } catch { /* already gone */ }
  }
}
