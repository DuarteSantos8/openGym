// The pictures on a printed plan (#817): one still per exercise, like the paper plan a gym hands
// out. lib/plan-share.js planPrintHTML lays them out; this file finds and loads them.
//
// LICENCE. The catalogue's pictures are licensed from Gym visual (catalogue/media/NOTICE.md).
// What may go on paper is what the web app and every self-hosted server already serve: the
// 180 px stills (lib/exercises.js imgSrc, exercise-media/still/). Never an animation, never an
// asset pack, never the larger files the store apps carry: those exist only inside the app
// package, and a PDF is a file anyone can pass on. So the source here is always imgSrc, on the
// phone too, and every loaded file is decoded and refused when it is larger than 180 px on either
// side (a fork or a build that pointed IMG_BASE at bigger files prints text instead). When a
// catalogue picture is on the page, the licence's attribution goes at the end of it (MEDIA_CREDIT).
//
// A custom exercise's own photo (or a video's poster frame) is the person's, and prints too.
//
// Every picture goes into the page as a data: URL. The page is self-contained on purpose: the
// phone's print views load it with no base URL (ios PrintPlugin.swift, android PrintPlugin.java),
// so a relative path would never load there. Loading happens before the print starts, with a
// deadline: whatever is not decoded by then is left out and that exercise prints as text.
import { EXIDX, imgSrc, figureOf, isCustomEx } from './exercises.js'
import { mediaOf } from './media-refs.js'

/** The largest catalogue picture a printout may carry, in px on either side. */
export const PRINT_PICTURE_MAX_PX = 180
/** How long the whole set of pictures may take before printing goes ahead without the rest. */
export const PRINT_PICTURES_TIMEOUT_MS = 8000
// A custom photo without a poster is used as it is only up to this size: the page crosses the
// native bridge as one string.
const CUSTOM_MAX_BYTES = 1.5 * 1024 * 1024
const CONCURRENCY = 4

// The attribution the media licence asks for, word for word as Settings shows it (agreement §8c),
// so it is not translated.
export const MEDIA_CREDIT = 'Exercise media © Aliaksandr Makatserchyk, Gym visual, gymvisual.com. Media licensed for use in openGym only.'

// A grey square: the stand-in the layout check (scripts/pdf/render-samples.mjs) and the tests
// print in place of every picture, so a page can be looked at without the licensed files.
export const PLACEHOLDER_PICTURE = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">'
  + '<rect width="180" height="180" fill="#d5d8de"/><path d="M40 130l35-45 25 30 15-18 25 33z" fill="#b3b8c2"/></svg>')

// What may stand in a printed <img src>: an image data: URL and nothing else.
export const isPrintPicture = v => typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(v)

/** The exercise ids a printout shows: one routine's, or every routine's with exercises. */
export function printedExerciseIds(S, routineId) {
  const routines = routineId
    ? (S?.routines || []).filter(r => r.id === routineId)
    : (S?.routines || [])
  const ids = new Set()
  for (const r of routines) for (const e of r?.ex || []) if (e?.id) ids.add(e.id)
  return [...ids]
}

/**
 * Where an exercise's printed picture comes from: { kind: 'catalogue', url } (the 180 px still),
 * { kind: 'custom', file } (a stored file of the person's own: the poster, else a small photo),
 * or null for nothing to print.
 */
export function printPictureSource(S, id, index = EXIDX) {
  const ex = index[id]
  if (!ex) return null
  if (isCustomEx(ex)) {
    const m = mediaOf(ex)
    if (!m) return null
    if (m.poster) return { kind: 'custom', file: m.poster }
    return m.kind === 'image' && m.size <= CUSTOM_MAX_BYTES ? { kind: 'custom', file: m } : null
  }
  if (!ex.img && !ex.fv && !ex.mv) return null
  // The still, never gifSrc or an animation pack: see the licence note at the top.
  return { kind: 'catalogue', url: imgSrc(ex, figureOf(S)) }
}

// A file as a data: URL, in plain JS (no FileReader, so it runs the same in every WebView and in
// the tests). `mime` is what the file is known to be, when the blob itself does not say.
async function blobToDataURL(blob, mime) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || mime};base64,${btoa(bin)}`
}

// Decodes the file once, in this page, and gives its size: a file that does not decode prints
// as text, and the size is the licence check. createImageBitmap where there is one, else an <img>.
async function decodedSize(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob)
      const size = { width: bmp.width, height: bmp.height }
      bmp.close?.()
      return size
    } catch { /* not decodable this way: try an <img> */ }
  }
  if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') return null
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { width: img.naturalWidth, height: img.naturalHeight }
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

async function loadOne(src, { fetchImpl, store, decode }) {
  let blob = null
  if (src.kind === 'catalogue') {
    const res = await fetchImpl(src.url, { credentials: 'same-origin' })
    if (!res || !res.ok) return null
    blob = await res.blob()
  } else {
    const rec = await store.get(src.file.hash)
    blob = rec?.blob || null
  }
  if (!blob || !blob.size) return null
  const size = await decode(blob)
  if (!size || !(size.width > 0) || !(size.height > 0)) return null
  if (src.kind === 'catalogue' && (size.width > PRINT_PICTURE_MAX_PX || size.height > PRINT_PICTURE_MAX_PX)) return null
  const url = await blobToDataURL(blob, src.kind === 'catalogue' ? 'image/webp' : src.file.mime)
  return isPrintPicture(url) ? url : null
}

/**
 * The pictures for a printout, as { [exercise id]: data URL }, ready for planPrintHTML's
 * `pictures`. Never rejects: an exercise whose picture is missing, too large, undecodable or not
 * in before `timeoutMs` is simply not in the result, and prints as text.
 *  - `routineId`   only that routine's exercises
 *  - `placeholder` a grey square for every exercise with a picture (layout checks, tests)
 *  - `fetchImpl`, `store`, `decode` for tests
 */
export async function loadPrintPictures(S, {
  routineId, placeholder = false, timeoutMs = PRINT_PICTURES_TIMEOUT_MS,
  fetchImpl = globalThis.fetch, store, decode = decodedSize, index = EXIDX,
} = {}) {
  const out = {}
  const jobs = printedExerciseIds(S, routineId)
    .map(id => [id, printPictureSource(S, id, index)])
    .filter(([, src]) => src)
  if (placeholder) {
    for (const [id] of jobs) out[id] = PLACEHOLDER_PICTURE
    return out
  }
  if (!jobs.length) return out
  let mediaStore = store
  if (!mediaStore && jobs.some(([, src]) => src.kind === 'custom')) {
    try { mediaStore = (await import('./media-store.js')).mediaStore } catch { mediaStore = null }
  }
  const deps = { fetchImpl, store: mediaStore || { get: async () => null }, decode }
  let done = false
  const queue = jobs.slice()
  const worker = async () => {
    while (!done && queue.length) {
      const [id, src] = queue.shift()
      let url = null
      try { url = await loadOne(src, deps) } catch { url = null }
      if (url && !done) out[id] = url
    }
  }
  let timer
  const deadline = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs) })
  await Promise.race([Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker)), deadline])
  clearTimeout(timer)
  done = true
  return { ...out }
}

/* ---------------------------------------------------------------- the switch, per device */
// "With pictures" in the print sheet, remembered on this device like the other print choices a
// browser would remember. Not in the profile: it is about this printer, not the plan.
export const PRINT_PICTURES_KEY = 'gym_print_pictures_v1'
export function readPrintPictures(storage = globalThis.localStorage) {
  try { return storage?.getItem(PRINT_PICTURES_KEY) !== '0' } catch { return true }
}
export function writePrintPictures(on, storage = globalThis.localStorage) {
  try { storage?.setItem(PRINT_PICTURES_KEY, on ? '1' : '0') } catch { /* private mode: this run only */ }
}
