import crypto from 'node:crypto'

const PAIR_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/
const PENDING_ID = /^[A-Za-z0-9_-]{43}$/
const MAX_BODY = 8192
const MAX_CID = 128
const HOST_COOKIE = '__Host-gymsid'
const LEGACY_COOKIE = 'gymsid'
const PENDING_TTL = 5 * 60_000

export class HandoffError extends Error {
  constructor(code) {
    super(code)
    this.name = 'HandoffError'
    this.code = code
  }
}

function assertKey(key) {
  if (!key || typeof key !== 'object' || typeof key.length !== 'number' || key.length !== 32) {
    throw new TypeError('AES-256-GCM key must be 32 bytes')
  }
}

export function pickAssertion(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new HandoffError('bad-assertion')
  const { cid, credential } = a
  if (typeof cid !== 'string' || !cid || cid.length > MAX_CID) throw new HandoffError('bad-assertion')
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) throw new HandoffError('bad-assertion')
  return { cid, credential }
}

function pickUser(u) {
  if (!u || typeof u !== 'object' || typeof u.id !== 'string' || !u.id) return null
  return { id: u.id, name: typeof u.name === 'string' ? u.name : '', admin: !!u.admin }
}

// Same rule as api/server.js cookieToken: one name, one value. Differing duplicates fail closed.
function pickSessionCookie(setCookie) {
  const byName = { [HOST_COOKIE]: [], [LEGACY_COOKIE]: [] }
  for (const line of setCookie || []) {
    const i = String(line).indexOf('=')
    if (i < 0) continue
    const name = String(line).slice(0, i).trim()
    const rest = String(line).slice(i + 1)
    const semi = rest.indexOf(';')
    const val = (semi < 0 ? rest : rest.slice(0, semi)).trim()
    if (name === HOST_COOKIE || name === LEGACY_COOKIE) byName[name].push(val)
  }
  for (const name of [HOST_COOKIE, LEGACY_COOKIE]) {
    const vals = byName[name].filter(Boolean)
    if (!vals.length) continue
    if (vals.some(v => v !== vals[0]) || /[\s,]/.test(vals[0])) throw new HandoffError('upstream')
    return `${name}=${vals[0]}`
  }
  throw new HandoffError('upstream')
}

async function post(apiBase, path, { cookie, json, timeoutMs = 10000 } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' }
  if (cookie) headers.cookie = cookie
  let res, text
  try {
    res = await fetch(`${apiBase}${path}`, {
      method: 'POST', headers, body: JSON.stringify(json ?? {}), redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    text = await res.text()
  } catch {
    throw new HandoffError('upstream')
  }
  if (res.status >= 300 && res.status < 400) throw new HandoffError('upstream')
  if (text.length > MAX_BODY) throw new HandoffError('upstream')
  let data
  try { data = text ? JSON.parse(text) : {} } catch { throw new HandoffError('upstream') }
  return { status: res.status, data, cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] }
}

function closed(status, data, which) {
  if (status === 403 && data && data.code === 'disabled') throw new HandoffError('disabled')
  if (which === 'login' && (status === 400 || status === 404)) throw new HandoffError('login-failed')
  if (which === 'create' && status === 401) throw new HandoffError('not-signed-in')
  if (which === 'redeem' && status === 400) throw new HandoffError('expired')
  throw new HandoffError('upstream')
}

// A confirmation owns its login challenge. No browser-supplied cid/challenge is trusted until
// it matches the challenge we minted and the WebAuthn clientDataJSON from this origin.
export async function mintLoginOptions({ apiBase, timeoutMs } = {}) {
  const result = await post(apiBase, '/api/login/options', { timeoutMs })
  const { cid, options } = result.data || {}
  if (result.status !== 200 || typeof cid !== 'string' || !cid || cid.length > MAX_CID ||
    !options || typeof options !== 'object' || typeof options.challenge !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(options.challenge)) throw new HandoffError('upstream')
  return { cid, options }
}

export async function verifyFreshPasskey(assertion, { apiBase, origin, challenge, cid, timeoutMs } = {}) {
  const body = pickAssertion(assertion)
  let client
  try {
    const data = body.credential.response?.clientDataJSON
    if (typeof data !== 'string' || !/^[A-Za-z0-9_-]{1,8192}$/.test(data)) throw new Error('invalid')
    const buf = Buffer.from(data, 'base64url')
    if (buf.toString('base64url') !== data || buf.length > 4096) throw new Error('invalid')
    client = JSON.parse(buf.toString('utf8'))
  } catch { throw new HandoffError('bad-assertion') }
  if (body.cid !== cid || !client || client.type !== 'webauthn.get' ||
    client.challenge !== challenge || client.origin !== origin) throw new HandoffError('bad-assertion')
  const verified = await post(apiBase, '/api/login/verify', { json: body, timeoutMs })
  const user = pickUser(verified.data && verified.data.user)
  if (verified.status !== 200 || !user) closed(verified.status, verified.data, 'login')
  // Set-Cookie from login/verify is intentionally ignored, including malformed cookie headers.
  return { user }
}

export async function establishSession(assertion, { apiBase, timeoutMs } = {}) {
  const body = pickAssertion(assertion)
  const verified = await post(apiBase, '/api/login/verify', { json: body, timeoutMs })
  const loginUser = pickUser(verified.data && verified.data.user)
  if (verified.status !== 200 || !loginUser) closed(verified.status, verified.data, 'login')
  const cookie = pickSessionCookie(verified.cookies)

  const created = await post(apiBase, '/api/pair/create', { cookie, timeoutMs })
  if (created.status !== 200 || !PAIR_RE.test(created.data && created.data.code)) closed(created.status, created.data, 'create')

  const redeemed = await post(apiBase, '/api/pair/redeem', { json: { code: created.data.code }, timeoutMs })
  const user = pickUser(redeemed.data && redeemed.data.user)
  const bearer = redeemed.data && redeemed.data.token
  if (redeemed.status !== 200 || !user || typeof bearer !== 'string' || !bearer) closed(redeemed.status, redeemed.data, 'redeem')
  if (user.id !== loginUser.id) throw new HandoffError('mismatch')
  return { user, bearer }
}

export function sealBearer(bearer, key, userId) {
  assertKey(key)
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(String(userId), 'utf8'))
  const enc = Buffer.concat([c.update(bearer, 'utf8'), c.final()])
  return Buffer.concat([iv, enc, c.getAuthTag()]).toString('base64url')
}

export function openBearer(sealed, key, userId) {
  assertKey(key)
  const buf = Buffer.from(String(sealed), 'base64url')
  if (buf.length < 29) throw new Error('bad record')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const enc = buf.subarray(12, buf.length - 16)
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAAD(Buffer.from(String(userId), 'utf8'))
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

export function createPending(pending, { ttlMs = PENDING_TTL, now = Date.now } = {}) {
  const t = typeof now === 'function' ? now() : now
  let id
  do { id = crypto.randomBytes(32).toString('base64url') } while (pending.has(id))
  pending.set(id, { exp: t + ttlMs })
  return id
}

function takePending(pending, pendingId, now) {
  if (typeof pendingId !== 'string' || !PENDING_ID.test(pendingId) || !pending || typeof pending.delete !== 'function') {
    throw new HandoffError('pending')
  }
  const rec = pending.get(pendingId)
  if (!rec) throw new HandoffError('pending')
  pending.delete(pendingId)
  const t = typeof now === 'function' ? now() : Date.now()
  if (typeof rec.exp !== 'number' || t >= rec.exp) throw new HandoffError('pending')
}

export async function connect(assertion, { apiBase, key, store, pending, pendingId, now, timeoutMs } = {}) {
  assertKey(key)
  pickAssertion(assertion)
  takePending(pending, pendingId, now)
  if (store.has(pendingId)) throw new HandoffError('pending')
  const { user, bearer } = await establishSession(assertion, { apiBase, timeoutMs })
  if (store.has(pendingId)) throw new HandoffError('pending')
  store.set(pendingId, { userId: user.id, sealed: sealBearer(bearer, key, user.id) })
  return { connectionId: pendingId }
}

export function sameOrigin(headers, origin) {
  const site = headers['sec-fetch-site']
  if (site) return site === 'same-origin'
  const o = headers.origin
  if (!o) return false
  return o.replace(/\/+$/, '') === String(origin).replace(/\/+$/, '')
}
