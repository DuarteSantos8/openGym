/* A profile picture of one's own (Settings → Account, v1.4.5; asked for on Discord by dreeper999).
 *
 *   S.avatar = { m }            m: a MediaRef of kind 'image', a 256 px square this device encoded
 *   S.avatar = { preset: id }   one of AVATAR_PRESETS, an openGym icon on the accent's tint
 *   (absent)                    the first letter of the name, as before
 *
 * The bytes never go into the state: it is one document every device downloads whole, and the
 * server rewrites it on every save. The picture lives where every other photo of the profile does,
 * in the device's media store (lib/media-store.js), and signed in on the server under the profile's
 * own uploads folder (api/media.js, whose GC keeps state.avatar.m). Only the hash travels in the
 * state, so the picture follows the account to every device, and the stamped settings merge
 * (lib/sync-merge.js stampEdits) keeps the one set last. A server that does not say it keeps
 * avatars (media.avatar in GET /api/config), or one with uploads off, never gets the file: the
 * picture stays on the device that has it, and the others show the letter.
 *
 * Nobody but the account sees it: GET /api/media/{hash} only ever looks in the caller's own folder,
 * and the admin's views of a profile carry no media refs at all.
 *
 * Nothing leaves the device as it was picked. The photo is decoded and drawn on a canvas twice
 * (once into a working copy at most WORK_EDGE px, once into the square), and the square is encoded
 * as WebP, or JPEG where the browser cannot write WebP. A canvas has no EXIF, GPS or camera details
 * to give back, and hasImageMetadata checks the bytes anyway before anything is stored.
 */
import { sniffKind, imageDims } from './media-sniff.js'
import { normalizeMediaRef } from './media-refs.js'
import { sha256Hex } from './sha256.js'
import { MB, MAX_PHOTO_MP, DEFAULT_LIMITS } from './media-limits.js'
import { MediaError, decodeImage, encodeImage } from './media-ingest.js'

export const AVATAR_EDGE = 256              // px, the stored square
export const AVATAR_MAX_BYTES = 32 * 1024   // the stored file; a 256 px face is 8 to 20 KB as WebP
export const WORK_EDGE = 1280               // px, the working copy the crop step draws from
export const ZOOM_MAX = 4

// Built-in pictures for people who would rather not use a photo: openGym's icon, or the emoji
// with Settings → Icons on emoji (components/Glyph.jsx).
export const AVATAR_PRESETS = [
  { id: 'lifter', icon: 'figureStrength', emoji: '🏋️' },
  { id: 'arm', icon: 'arm', emoji: '💪' },
  { id: 'kettlebell', icon: 'kettlebell', emoji: '🔔' },
  { id: 'runner', icon: 'figureRun', emoji: '🏃' },
  { id: 'flame', icon: 'flame', emoji: '🔥' },
  { id: 'bolt', icon: 'bolt', emoji: '⚡' },
  { id: 'rocket', icon: 'rocket', emoji: '🚀' },
  { id: 'crown', icon: 'crown', emoji: '👑' },
  { id: 'heart', icon: 'heart', emoji: '❤️' },
  { id: 'moon', icon: 'moon', emoji: '🌙' },
  { id: 'smile', icon: 'smile', emoji: '🙂' },
  { id: 'trophy', icon: 'trophy', emoji: '🏆' }
]
const PRESET = Object.fromEntries(AVATAR_PRESETS.map(p => [p.id, p]))

/** The profile's picture as it may be shown: { type: 'photo', m } | { type: 'preset', ...preset } | null. */
export function avatarOf (S) {
  const a = S && typeof S === 'object' ? S.avatar : null
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null
  if (a.m) {
    const m = normalizeMediaRef(a.m)
    return m && m.kind === 'image' ? { type: 'photo', m } : null
  }
  if (typeof a.preset === 'string' && PRESET[a.preset]) return { type: 'preset', ...PRESET[a.preset] }
  return null
}

/** The letter shown without a picture (or while it cannot load): the name's first character. */
export function initialOf (name) {
  const s = String(name ?? '').trim()
  if (!s) return null
  const first = Array.from(s)[0]
  return first.toLocaleUpperCase()
}

export function setAvatarPhoto (s, m) { s.avatar = { m } }
export function setAvatarPreset (s, id) { if (PRESET[id]) s.avatar = { preset: id } }
export function clearAvatar (s) { delete s.avatar }

/** A backup's avatar through the same gate as everywhere else (lib/backup-media.js); mutates. */
export function sanitizeAvatar (state) {
  if (!state || typeof state !== 'object' || !('avatar' in state)) return state
  const a = avatarOf(state)
  if (!a) delete state.avatar
  else state.avatar = a.type === 'photo' ? { m: a.m } : { preset: a.id }
  return state
}

/* ---------------------------------------------------------------- the crop */
/* The crop step shows the picture in a square viewport of `view` CSS px, covering it at zoom 1.
 * `crop` = { x, y, zoom }: the picture's centre offset from the viewport's centre in CSS px, and
 * the zoom over that cover scale. Pure, so the sheet and the tests share one answer. */

export const coverScale = (pic, view) => view / Math.min(pic.width, pic.height)

/** The crop kept inside the picture: zoom in 1..ZOOM_MAX, the picture always covering the viewport. */
export function clampCrop (pic, view, { x = 0, y = 0, zoom = 1 } = {}) {
  const z = Math.min(ZOOM_MAX, Math.max(1, Number.isFinite(zoom) ? zoom : 1))
  const s = coverScale(pic, view) * z
  const mx = Math.max(0, (pic.width * s - view) / 2)
  const my = Math.max(0, (pic.height * s - view) / 2)
  const c = (v, m) => Math.min(m, Math.max(-m, Number.isFinite(v) ? v : 0))
  return { x: c(x, mx), y: c(y, my), zoom: z }
}

/** The square of the picture (in its own pixels) that the viewport shows: { sx, sy, side }. */
export function sourceRect (pic, view, crop) {
  const k = clampCrop(pic, view, crop)
  const s = coverScale(pic, view) * k.zoom
  const side = view / s
  return { sx: pic.width / 2 - k.x / s - side / 2, sy: pic.height / 2 - k.y / s - side / 2, side }
}

/** Zoom by `factor` around a point (px from the viewport centre), so what is under the fingers stays there. */
export function zoomAround (pic, view, crop, factor, px = 0, py = 0) {
  const z = Math.min(ZOOM_MAX, Math.max(1, crop.zoom * factor))
  const r = z / crop.zoom
  return clampCrop(pic, view, { x: px - (px - crop.x) * r, y: py - (py - crop.y) * r, zoom: z })
}

/* ---------------------------------------------------------------- metadata */

const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n))

/**
 * Whether encoded image bytes still carry metadata about the photo or the person: a JPEG's APP1
 * (EXIF or XMP), APP13 (IPTC), COM, or an APP2 that is not the colour profile (FlashPix, MPF); a
 * WebP's EXIF or XMP chunk; a PNG's eXIf, tEXt, iTXt or zTXt. A colour profile is allowed: Chrome's
 * canvas encoder writes its own sRGB one into every WebP and JPEG (checked in headless Chrome), and
 * it says nothing about where or with what the photo was taken. What a canvas writes has none of
 * the rest; this is the check that it stays that way.
 */
export function hasImageMetadata (bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return false
      const mk = b[i + 1]
      if (mk === 0xda || mk === 0xd9) return false          // the image data starts: no more headers
      if (mk === 0xe1 || mk === 0xed || mk === 0xfe) return true
      if (mk === 0xe2 && ascii(b, i + 4, 11) !== 'ICC_PROFILE') return true
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
    return false
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    let i = 12
    while (i + 8 <= b.length) {
      const id = ascii(b, i, 4)
      if (id === 'EXIF' || id === 'XMP ') return true
      const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)
      i += 8 + len + (len & 1)
    }
    return false
  }
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    let i = 8
    while (i + 8 <= b.length) {
      const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
      const id = ascii(b, i + 4, 4)
      if (id === 'eXIf' || id === 'tEXt' || id === 'iTXt' || id === 'zTXt') return true
      if (id === 'IEND') return false
      i += 12 + len
    }
  }
  return false
}

/* ---------------------------------------------------------------- picking and encoding */

const defaultDeps = { decodeImage, encodeImage, doc: globalThis.document }

/**
 * A picked file → a working copy to crop from: { source (a canvas), width, height, close() }.
 * Refused with MediaError: 'type' (not a still image), 'too-large', 'photo-too-big', 'unreadable'.
 * The decoded original is drawn once into the working canvas and let go right away.
 */
export async function openAvatarImage (file, deps = {}) {
  const d = { ...defaultDeps, ...deps }
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const sniffed = sniffKind(head)
  if (!sniffed || sniffed.category !== 'still') throw new MediaError('type')
  if (file.size > DEFAULT_LIMITS.rawPhotoMB * MB) throw new MediaError('too-large', { mb: DEFAULT_LIMITS.rawPhotoMB })
  if (!sniffed.input) {
    const dims = imageDims(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()))
    if (dims && dims.width * dims.height > MAX_PHOTO_MP * 1e6) throw new MediaError('photo-too-big')
  }
  const pic = await d.decodeImage(file, sniffed.mime, d)
  try {
    if (pic.width * pic.height > MAX_PHOTO_MP * 1e6) throw new MediaError('photo-too-big')
    const scale = Math.min(1, WORK_EDGE / Math.max(pic.width, pic.height))
    const w = Math.max(1, Math.round(pic.width * scale))
    const h = Math.max(1, Math.round(pic.height * scale))
    const canvas = d.doc.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(pic.source, 0, 0, w, h)
    return { source: canvas, width: w, height: h, close: () => { canvas.width = 0; canvas.height = 0 } }
  } finally { pic.close() }
}

/**
 * The crop drawn into the AVATAR_EDGE square and encoded under AVATAR_MAX_BYTES:
 * { blob, media } with media a MediaRef ready for setAvatarPhoto. Quality steps down, then the
 * edge, before it gives up ('too-large'). Refuses bytes that carry metadata ('unreadable').
 */
export async function renderAvatar (pic, view, crop, deps = {}) {
  const d = { ...defaultDeps, ...deps }
  const r = sourceRect(pic, view, crop)
  const canvas = d.doc.createElement('canvas')
  canvas.width = AVATAR_EDGE
  canvas.height = AVATAR_EDGE
  try {
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(pic.source, r.sx, r.sy, r.side, r.side, 0, 0, AVATAR_EDGE, AVATAR_EDGE)
    const square = { source: canvas, width: AVATAR_EDGE, height: AVATAR_EDGE }
    for (const [edge, q] of [[256, 0.82], [256, 0.7], [256, 0.55], [192, 0.6], [192, 0.45]]) {
      const out = await d.encodeImage(square, edge, q, d)
      if (out.blob.size > AVATAR_MAX_BYTES) continue
      const bytes = new Uint8Array(await out.blob.arrayBuffer())
      if (hasImageMetadata(bytes)) throw new MediaError('unreadable')
      const hash = await sha256Hex(bytes)
      const media = normalizeMediaRef({ kind: 'image', hash, mime: out.mime, size: bytes.length, width: out.width, height: out.height, at: Date.now() })
      if (!media) throw new MediaError('unreadable')
      return { blob: new Blob([bytes], { type: out.mime }), media }
    }
    throw new MediaError('too-large', { mb: Math.round(AVATAR_MAX_BYTES / 1024) / 1024 })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
