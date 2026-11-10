// "Share with a friend" (v1.4.4): one routine as a link, https://opengym.ch/r#<payload>.
//
// The payload is a plan file (lib/plan-share.js buildPlanBundle) holding just that routine, so it
// carries the same `opengym_plan` format version and the receiving app reads it with the same
// parsePlan/mergePlan as an imported file: catalogue ids travel as they are, custom exercises
// travel by name and body part and are created on import, nothing already there is touched.
//
//   <payload> = <link format>.<encoding>.<base64url>      e.g. 1.d.q1YqzkxRslIqS...
//   encoding  d = deflate-raw (CompressionStream), j = plain JSON (a browser without one)
//
// It lives in the URL FRAGMENT: browsers never send that part to a server, so opengym.ch only
// serves the page (website/r/index.html) and never sees the routine. The same payload opens the
// app as opengym://r#<payload>, Android's https://opengym.ch/r filter, or a web app at
// <server>/#/r/<payload>.
//
// Besides the plan file, the bundle carries two things an older app simply ignores: `from`, the
// sender's name when they chose to add it, and `names`, the English catalogue names of the
// exercises, so the website can show the routine without the exercise database.
import { EXIDX, isCustomEx } from './exercises.js'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
import { t } from './i18n-core.js'

export const LINK_FMT = 1
export const LINK_BASE = 'https://opengym.ch/r'
// Past this a link starts breaking in chat apps and SMS: the share falls back to a plan file.
export const MAX_LINK = 2000
// What a link may hold at all, before and after inflating: far past any real routine.
const MAX_PAYLOAD = 16000
const MAX_JSON = 256 * 1024
export const FROM_MAX = 40

const linkError = code => Object.assign(new Error(code), { code, routineLink: true })

/* ------------------------------- base64url ------------------------------- */

export function toBase64Url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw linkError('bad-link')
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  let bin
  try { bin = atob(b64) } catch { throw linkError('bad-link') }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* ------------------------------- compression ------------------------------- */

const canStream = kind => {
  const C = kind === 'in' ? globalThis.DecompressionStream : globalThis.CompressionStream
  if (typeof C !== 'function') return false
  try { new C('deflate-raw'); return true } catch { return false }
}

// Through the stream by hand (no Blob or Response, which not every runtime pairs with these).
// Read in pieces and stopped past `max`: a link is someone else's data, and a tiny one can
// inflate to something huge.
async function pipe(stream, bytes, max) {
  const writer = stream.writable.getWriter()
  writer.write(bytes).catch(() => {})
  writer.close().catch(() => {})
  const reader = stream.readable.getReader()
  const parts = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) { reader.cancel().catch(() => {}); throw linkError('too-big') }
      parts.push(value)
    }
  } catch (e) {
    if (e?.routineLink) throw e
    throw linkError('bad-link')
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const deflate = bytes => pipe(new CompressionStream('deflate-raw'), bytes, Infinity)
const inflate = bytes => pipe(new DecompressionStream('deflate-raw'), bytes, MAX_JSON)

/* ------------------------------- the bundle ------------------------------- */

export const cleanFrom = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, FROM_MAX) : '')

const stripWeights = e => {
  const { weight, pyramidWeight, ...rest } = e
  return rest
}

/**
 * One routine as the link's plan file. `weights` keeps the sender's weights (off: sets, reps,
 * times, rest and the rest of the prescription only); `from` is the sender's name, or nothing.
 */
export function routineLinkBundle(S, routine, { weights = false, from = '' } = {}) {
  if (!routine || !Array.isArray(routine.ex) || !routine.ex.length) throw linkError('empty')
  const sub = { ...S, routines: [routine], week: {}, programmes: {} }
  const b = buildPlanBundle(sub, routine.name || '')
  const out = { opengym_plan: b.opengym_plan, name: b.name, unit: b.unit, routines: b.routines, customEx: b.customEx }
  if (!out.customEx.length) delete out.customEx
  if (b.exUnit) out.exUnit = b.exUnit
  if (!weights) out.routines = out.routines.map(r => ({ ...r, ex: r.ex.map(stripWeights) }))
  const names = {}
  for (const e of out.routines[0].ex) {
    const ex = EXIDX[e.id]
    if (ex && !isCustomEx(ex) && ex.n) names[e.id] = ex.n
  }
  if (Object.keys(names).length) out.names = names
  const name = cleanFrom(from)
  if (name) out.from = name
  return out
}

/* ------------------------------- encode / decode ------------------------------- */

/** The bundle as a payload string; `compress: false` forces the plain form (tests, old browsers). */
export async function encodePayload(bundle, { compress = true } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle))
  if (compress && canStream('out')) {
    try { return `${LINK_FMT}.d.${toBase64Url(await deflate(bytes))}` } catch { /* fall through to plain */ }
  }
  return `${LINK_FMT}.j.${toBase64Url(bytes)}`
}

/**
 * A payload back to its bundle (raw, not yet parsePlan'd). Throws an Error with `code`:
 * 'bad-link' (not ours, cut off, garbled), 'too-new' (a newer link format than this app reads),
 * 'too-big', 'no-inflate' (compressed, and this browser can't inflate).
 */
export async function decodePayload(payload) {
  if (typeof payload !== 'string') throw linkError('bad-link')
  const p = payload.trim()
  if (p.length > MAX_PAYLOAD) throw linkError('too-big')
  const m = /^(\d{1,4})\.([a-z])\.([A-Za-z0-9_-]+)$/.exec(p)
  if (!m) throw linkError('bad-link')
  if (Number(m[1]) > LINK_FMT) throw linkError('too-new')
  if (Number(m[1]) < 1) throw linkError('bad-link')
  let bytes = fromBase64Url(m[3])
  if (m[2] === 'd') {
    if (!canStream('in')) throw linkError('no-inflate')
    bytes = await inflate(bytes)
  } else if (m[2] !== 'j') throw linkError('too-new')
  if (bytes.length > MAX_JSON) throw linkError('too-big')
  let data
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw linkError('bad-link') }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.opengym_plan || !Array.isArray(data.routines)) throw linkError('bad-link')
  return data
}

export const linkFor = payload => `${LINK_BASE}#${payload}`

/**
 * The link for a routine, or `{ tooLong: true }` when it would pass MAX_LINK (the caller shares a
 * plan file instead). { url, length, payload, bundle }.
 */
export async function routineLink(S, routine, opts = {}) {
  const bundle = routineLinkBundle(S, routine, opts)
  const payload = await encodePayload(bundle, opts)
  const url = linkFor(payload)
  return url.length > MAX_LINK ? { tooLong: true, length: url.length, bundle } : { url, length: url.length, payload, bundle }
}

/* ------------------------------- reading a link ------------------------------- */

const PAYLOAD_RE = /^\d{1,4}\.[a-z]\.[A-Za-z0-9_-]+$/

/**
 * The payload of a routine link, or null for anything else. Never throws. Reads
 *   https://opengym.ch/r#P  https://opengym.ch/r/#P  (www. too)
 *   opengym://r#P  opengym://r/#P
 *   any web app's  .../#/r/P  (the hash route the website's "Open in the web app" uses)
 */
export function routinePayloadFromUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PAYLOAD + 512) return null
  let u
  try { u = new URL(raw.trim()) } catch { return null }
  const hash = (u.hash || '').replace(/^#/, '')
  const ok = s => (PAYLOAD_RE.test(s) && s.length <= MAX_PAYLOAD ? s : null)
  const proto = u.protocol.toLowerCase()
  const route = /^\/r\/([^/?#]+)\/?$/.exec(hash)
  if (route) return ok(route[1])
  if (proto === 'https:' || proto === 'http:') {
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (host !== 'opengym.ch') return null
    if (u.pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '') !== '/r') return null
    return ok(hash)
  }
  if (proto !== 'opengym:') return null
  const host = (u.hostname || '').toLowerCase()
  const rest = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (host !== 'r' || rest) return null
  return ok(hash)
}

/**
 * A decoded bundle, checked the way a plan file is (parsePlan), plus who sent it. Exactly one
 * routine with at least one exercise this app knows, or it throws { code: 'bad-link' | 'empty' }.
 */
export function readRoutineBundle(data, unit = 'kg') {
  let parsed
  try { parsed = parsePlan(data, unit) } catch { throw linkError('bad-link') }
  parsed.routines = parsed.routines.slice(0, 1)
  const r = parsed.routines[0]
  if (!r || !r.ex.length) throw linkError('empty')
  parsed.routineCount = 1
  parsed.exerciseCount = r.ex.length
  parsed.week = {}
  parsed.scheduledDays = 0
  parsed.programmes = []
  return { ...parsed, from: cleanFrom(data.from) }
}

/** The name the routine gets here: the sender's suffix ("(from Alex)") when they said who they
 *  are, and never a name already taken ("Push Day 2"), so nothing reads as overwritten. */
export function importedRoutineName(name, suffix = '', taken = []) {
  const base = (String(name || '').trim() || t('Shared routine')) + (suffix ? ' ' + suffix : '')
  const used = new Set(taken.map(n => String(n || '').trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let i = 2; i < 1000; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
  return base
}

/**
 * Adds the shared routine to the draft state `s` (inside store.update) as a NEW routine, never
 * over one already there. Returns the new routine's id.
 */
export function importRoutineLink(s, parsed) {
  const r = parsed.routines[0]
  const suffix = parsed.from ? t('(from {0})', parsed.from) : ''
  const name = importedRoutineName(r.name, suffix, (s.routines || []).map(x => x.name))
  const res = mergePlan(s, { ...parsed, routines: [{ ...r, name }], week: {}, programmes: [] }, { schedule: false })
  return res.ids[0]
}
