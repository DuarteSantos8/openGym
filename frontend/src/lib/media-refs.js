/* The photo, GIF or video of a custom exercise, and the photos and videos of a logged workout,
 * as the state holds them — and an exercise's link.
 *
 * The state never carries the bytes, only a MediaRef of a few hundred bytes (see the shape
 * below). The bytes live in the device's local media store (lib/media-store.js) and, signed in,
 * on the server under DATA_DIR/uploads/<uid>/<sha256>.<ext> (api/media.js). Everything here is
 * pure and has no imports, so the store, the sync, the editor and the tests can all use it.
 *
 *   MediaRef = { kind: 'image'|'gif'|'video', hash, mime, size, width, height,
 *                dur?, codec?, poster?: { hash, mime, size, width, height }, at }
 *
 * A ref comes from outside whenever a state does: another device, a backup file, a plan file, a
 * hand-edited profile. So nothing trusts one as it stands. normalizeMediaRef() is the gate every
 * reader goes through, and anything it refuses is shown as "no media". cleanUrl() is the same
 * gate for the link, and it runs both when a link is saved and when one is opened.
 */

export const HASH_RE = /^[0-9a-f]{64}$/

/* The seven types that are ever stored, the same list as api/media.js MEDIA_TYPES. `playExt` is
   the name a file gets in the phone's own folder: the WebView's local server types a file by its
   extension, and it hands out .mov as something the <video> element will not play, while the same
   bytes named .mp4 play (a MOV and an MP4 are the same container). */
export const MEDIA_MIMES = {
  'image/jpeg': { kind: 'image', category: 'still', ext: 'jpg', playExt: 'jpg' },
  'image/png': { kind: 'image', category: 'still', ext: 'png', playExt: 'png' },
  'image/webp': { kind: 'image', category: 'still', ext: 'webp', playExt: 'webp' },
  'image/gif': { kind: 'gif', category: 'still', ext: 'gif', playExt: 'gif' },
  'video/mp4': { kind: 'video', category: 'video', ext: 'mp4', playExt: 'mp4' },
  'video/quicktime': { kind: 'video', category: 'video', ext: 'mov', playExt: 'mp4' },
  'video/webm': { kind: 'video', category: 'video', ext: 'webm', playExt: 'webm' }
}
// A poster is always a still this app encoded itself, so only the two formats the encoder writes.
const POSTER_MIMES = new Set(['image/webp', 'image/jpeg'])
export const CODECS = ['avc1', 'hvc1', 'av01', 'vp09', 'vp8', 'vp9', 'other']

const MB = 1024 * 1024
const MAX_SIZE = 200 * MB
const MAX_EDGE = 16384
const MAX_DUR = 3600
const MAX_URL = 2048

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

function cleanPoster(p) {
  if (!p || typeof p !== 'object') return null
  if (typeof p.hash !== 'string' || !HASH_RE.test(p.hash)) return null
  if (!POSTER_MIMES.has(p.mime)) return null
  if (!intIn(p.size, 1, MAX_SIZE) || !intIn(p.width, 1, MAX_EDGE) || !intIn(p.height, 1, MAX_EDGE)) return null
  return { hash: p.hash, mime: p.mime, size: p.size, width: p.width, height: p.height }
}

/**
 * A well-formed MediaRef, rebuilt from its known fields only, or null. null means "no media" to
 * every reader: a bad hash, a mime outside the allowlist or one that does not match `kind`, a
 * size outside 1 B..200 MB, a dimension outside 1..16384, a length outside 0..3600 s, or a codec
 * nobody knows. A malformed poster is dropped on its own; the main file still stands.
 */
export function normalizeMediaRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null
  const type = typeof ref.mime === 'string' ? MEDIA_MIMES[ref.mime] : null
  if (!type || ref.kind !== type.kind) return null
  if (typeof ref.hash !== 'string' || !HASH_RE.test(ref.hash)) return null
  if (!intIn(ref.size, 1, MAX_SIZE) || !intIn(ref.width, 1, MAX_EDGE) || !intIn(ref.height, 1, MAX_EDGE)) return null
  const out = { kind: ref.kind, hash: ref.hash, mime: ref.mime, size: ref.size, width: ref.width, height: ref.height }
  if (ref.dur != null) {
    if (typeof ref.dur !== 'number' || !Number.isFinite(ref.dur) || ref.dur < 0 || ref.dur > MAX_DUR) return null
    out.dur = Math.round(ref.dur * 10) / 10
  }
  if (ref.codec != null) {
    if (ref.kind !== 'video' || !CODECS.includes(ref.codec)) return null
    out.codec = ref.codec
  }
  const poster = cleanPoster(ref.poster)
  if (poster) out.poster = poster
  out.at = typeof ref.at === 'number' && Number.isFinite(ref.at) && ref.at > 0 ? Math.round(ref.at) : 0
  return out
}

/** The media of a custom exercise as it may be shown, or null. */
export const mediaOf = ex => (ex && ex.media ? normalizeMediaRef(ex.media) : null)

/**
 * How many photos and videos one logged workout keeps. Every ref travels in the whole-document
 * push that each of the account's devices downloads (about 300 bytes each, plus its poster's
 * files on every device that shows it), so the list is bounded like everything else in the
 * state: six is a progress photo from a few angles plus a couple of form-check clips, one or two
 * rows of thumbnails on a phone. A workout with more has to drop one first.
 */
export const WORKOUT_MEDIA_MAX = 6

/**
 * The photos and videos of a logged workout as they may be shown: each passes normalizeMediaRef,
 * a file listed twice shows once, and never more than `max` — WORKOUT_MEDIA_MAX unless the
 * caller asks otherwise (a hand-edited or foreign copy can hold anything). Oldest first, the
 * order they were added in. A reading, never a rewrite: the list on the record keeps whatever
 * this leaves out (lib/workout-media.js edits it as it stands).
 */
export function workoutMediaOf(w, max = WORKOUT_MEDIA_MAX) {
  const raw = w && typeof w === 'object' && Array.isArray(w.media) ? w.media : []
  const out = []
  const seen = new Set()
  for (const r of raw) {
    const m = normalizeMediaRef(r)
    if (!m || seen.has(m.hash)) continue
    seen.add(m.hash)
    out.push(m)
    if (out.length >= max) break
  }
  return out
}

/**
 * Every MediaRef-like object a state holds, as it stands (not normalised): each custom
 * exercise's `media` and each entry of each logged workout's `media` list. The one walk behind
 * referencedHashes, referencedFiles and the owed count, so they can never disagree about where
 * media live. The session in progress is not walked: it never syncs (the server drops `active`),
 * media are only ever attached to a saved workout, and the history editor's copy of one leaves
 * them on the saved record (lib/session-edit.js).
 */
export function stateMediaRefs(state) {
  const out = []
  if (!state || typeof state !== 'object') return out
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
  for (const c of Array.isArray(state.customEx) ? state.customEx : []) {
    if (isObj(c) && isObj(c.media)) out.push(c.media)
  }
  for (const w of Array.isArray(state.workouts) ? state.workouts : []) {
    if (!isObj(w) || !Array.isArray(w.media)) continue
    for (const m of w.media) if (isObj(m)) out.push(m)
  }
  return out
}

/**
 * Every blob hash a state refers to, the same answer as api/media.js referencedHashes (the shared
 * fixture api/test/fixtures/media-refs.json pins both): customEx[].media and every entry of
 * workouts[].media. Deliberately looser than normalizeMediaRef and workoutMediaOf: each hash and
 * poster hash counts on its own as long as it is well-formed, and a workout's list counts past
 * its cap, because this set decides what is KEPT, and keeping too much is the safe side.
 */
export function referencedHashes(state) {
  const out = new Set()
  const add = r => { if (r && typeof r === 'object' && typeof r.hash === 'string' && HASH_RE.test(r.hash)) out.add(r.hash) }
  for (const m of stateMediaRefs(state)) {
    add(m)
    add(m.poster)
  }
  return out
}

/**
 * The same hashes in the order the sync wants them, posters first: a poster is what every list
 * shows, so it is the file another device most wants soon, and it is small. Each hash comes with
 * what the state says about it — { hash, mime, size, poster } — which is what a download is
 * checked against. The first ref that names a hash decides; two exercises with the same file
 * describe it the same way unless someone edited one by hand (an exercise's picture added to a
 * workout too is one file).
 */
export function referencedFiles(state) {
  const posters = new Map()
  const mains = new Map()
  for (const m of stateMediaRefs(state)) {
    const p = m.poster
    if (p && typeof p === 'object' && typeof p.hash === 'string' && HASH_RE.test(p.hash) && !posters.has(p.hash)) {
      posters.set(p.hash, { hash: p.hash, mime: p.mime, size: p.size, poster: true })
    }
    if (typeof m.hash === 'string' && HASH_RE.test(m.hash) && !mains.has(m.hash)) {
      mains.set(m.hash, { hash: m.hash, mime: m.mime, size: m.size, poster: false })
    }
  }
  for (const h of posters.keys()) mains.delete(h)
  return [...posters.values(), ...mains.values()]
}

/**
 * A link as it may be stored and opened: http(s) only, no user name or password in it, at most
 * 2048 characters — or null. A bare "youtube.com/watch?v=…" gets https:// in front, the way people
 * paste links (#246). Anything else with a scheme of its own (javascript:, data:, mailto:, a
 * custom app scheme) is refused rather than guessed at. It runs at save and again at render,
 * because a plan file or a backup can bring any string in.
 */
export function cleanUrl(raw) {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s || s.length > MAX_URL) return null
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9+.-]+:/i.test(s)) return null
    s = 'https://' + s
  }
  // Chrome's URL parser takes "https://not a url" and percent-encodes the spaces into the host,
  // so "not a url" typed into the link field was saved as a link (QA 1.3.9). The host has to
  // be one a browser could reach: no whitespace in what was typed, and a dotted name,
  // localhost or an IP address.
  const authority = /^https?:\/\/([^/?#]*)/i.exec(s)?.[1] || ''
  if (/\s/.test(authority)) return null
  let u
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname || u.username || u.password) return null
  if (!plausibleHost(u.hostname)) return null
  return u.href.length <= MAX_URL ? u.href : null
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i
function plausibleHost(host) {
  if (host.startsWith('[') && host.endsWith(']')) return true               // IPv6
  const h = host.replace(/\.$/, '').toLowerCase()
  if (h === 'localhost') return true
  const labels = h.split('.')
  // xn-- names are how the parser writes an international domain, so they pass as letters.
  return labels.length >= 2 && labels.every(l => LABEL.test(l))
}

// Hosts whose pages are, in practice, a video: the card then says "Watch video" instead of
// "Open link". Only the wording changes — nothing is fetched or embedded either way.
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'instagram.com']

/** 'video' for a link to a video site, 'link' for anything else, null for no usable link. */
export function linkKind(url) {
  const u = cleanUrl(url)
  if (!u) return null
  const host = new URL(u).hostname.toLowerCase()
  return VIDEO_HOSTS.some(d => host === d || host.endsWith('.' + d)) ? 'video' : 'link'
}

/** m:ss for a length in seconds ("0:07", "1:05"). */
export function fmtClip(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}
