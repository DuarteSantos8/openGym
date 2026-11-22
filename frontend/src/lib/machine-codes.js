// Links an exercise to a QR code or NFC tag already on a gym machine.
// A code is untrusted text from outside: it is only ever data. It is never
// used as an object key (the map is exercise id -> code[]), never parsed as
// markup, and never trusted to be short or printable until cleanText has run.
import { EXIDX, canonicalExId } from './exercises.js'
import { mergedInto } from './exercise-merge.js'

const MAX_LEN = 512
const STOP = new Set(['product', 'products', 'equipment', 'machine', 'machines', 'qr', 'index', 'html', 'htm', 'php', 'en', 'de', 'fr', 'www', 'item', 'id'])

// C0 and C1 controls, bidi embeddings/overrides and bidi isolates.
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g

export function cleanText(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.normalize('NFC').replace(HIDDEN, '').trim()
  return s && s.length <= MAX_LEN ? s : null
}

export function codeFromQr(text) {
  const s = cleanText(text)
  return s ? 't:' + s : null
}

export function codeFromNfc({ uid, records } = {}) {
  const list = Array.isArray(records) ? records : []
  const pick = type => list.find(r => r && r.type === type && cleanText(r.value))
  const rec = pick('uri') || pick('text')
  if (rec) return 't:' + cleanText(rec.value)
  const id = typeof uid === 'string' ? cleanText(uid) : null
  return id ? 'uid:' + id.toUpperCase() : null
}

// A 4-byte UID starting with 08 is one the tag makes up afresh, so it can't identify a machine.
export function isRandomUid(uidHex) {
  return typeof uidHex === 'string' && /^08[0-9a-f]{6}$/i.test(uidHex.trim())
}

export function refusal(S, code, { own = false } = {}) {
  if (!code) return 'empty'
  if (own) return 'own'
  if ((S?.gymCards || []).some(c => c && 't:' + c.value === code)) return 'gym-card'
  if (code.startsWith('uid:') && isRandomUid(code.slice(4))) return 'random-uid'
  return null
}

const map = S => (S.machineCodes && typeof S.machineCodes === 'object' ? S.machineCodes : (S.machineCodes = {}))
const own = (m, key) => (Object.hasOwn(m, key) && Array.isArray(m[key]) ? m[key] : [])
// The keys an exercise's codes sit under: its id, and a drawing id (EXALIAS) of the same exercise
// that an older copy may have stored them under. Read, link and unlink all go through this.
const keysOf = (m, exId) => Object.keys(m).filter(k => k === exId || canonicalExId(k) === canonicalExId(exId))
const drop = (m, key, code) => {
  const rest = own(m, key).filter(c => c !== code)
  if (rest.length) m[key] = rest
  else delete m[key]
}

export function codesOf(S, exId) {
  const m = S?.machineCodes
  if (!m || typeof m !== 'object') return []
  const keys = keysOf(m, exId)
  return keys.length === 1 ? own(m, keys[0]) : [...new Set(keys.flatMap(k => own(m, k)))]
}

function known(S, id) {
  return !!EXIDX[canonicalExId(id)] || (S.customEx || []).some(e => e && e.id === id)
}

// An exercise merged away (lib/exercise-merge.js) answers as the one it went into.
export function exercisesFor(S, code) {
  return Object.entries(S?.machineCodes || {})
    .filter(([, codes]) => Array.isArray(codes) && codes.includes(code))
    .map(([id]) => canonicalExId(mergedInto(S, canonicalExId(id))))
    .filter((id, i, all) => known(S, id) && all.indexOf(id) === i)
}

export function unlink(S, exId, code) {
  const m = map(S)
  for (const key of keysOf(m, exId)) drop(m, key, code)
}

export function link(S, exId, code, { only = false } = {}) {
  const m = map(S)
  if (only) {
    const mine = new Set(keysOf(m, exId))
    for (const key of Object.keys(m)) if (!mine.has(key)) drop(m, key, code)
  }
  if (!codesOf(S, exId).includes(code)) m[exId] = [...own(m, exId), code]
}

export function shownCode(code, max = 40) {
  const cut = s => (s.length > max ? s.slice(0, max - 1) + '…' : s)
  if (code.startsWith('uid:')) {
    const pairs = code.slice(4).match(/.{1,2}/g) || []
    return cut('NFC ' + pairs.join(':'))
  }
  const body = code.replace(/^t:/, '').replace(/^https?:\/\/(www\.)?/i, '')
  return cut('QR ' + body)
}

export function searchHint(code) {
  if (!code.startsWith('t:')) return ''
  let url
  try { url = new URL(code.slice(2)) } catch { return '' }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  try {
    const pieces = [...url.pathname.split('/'), ...[...url.searchParams.values()]].map(decodeURIComponent)
    // searchParams already decodes; decoding the path segments is what can throw.
    const words = pieces
      .flatMap(p => p.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[/\-_.+\s]+/))
      .filter(w => /^[a-z]{3,}$/.test(w) && !STOP.has(w))
    return words.slice(0, 6).join(' ')
  } catch { return '' }
}
