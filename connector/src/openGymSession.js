import crypto from 'node:crypto'

const PAIR_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/
const MAX_BODY = 8192
const HOST_COOKIE = '__Host-gymsid'
const LEGACY_COOKIE = 'gymsid'

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

function sessionCookieHeader(jar) {
  let host, legacy
  if (typeof jar === 'string') {
    for (const part of jar.split(';')) {
      const i = part.indexOf('=')
      if (i < 0) continue
      const name = part.slice(0, i).trim()
      const val = part.slice(i + 1).trim()
      if (!val) continue
      if (name === HOST_COOKIE) host = val
      else if (name === LEGACY_COOKIE) legacy = val
    }
  } else if (jar && typeof jar === 'object') {
    const h = jar[HOST_COOKIE], l = jar[LEGACY_COOKIE]
    if (typeof h === 'string' && h) host = h
    if (typeof l === 'string' && l) legacy = l
  }
  if (host) return `${HOST_COOKIE}=${host}`
  if (legacy) return `${LEGACY_COOKIE}=${legacy}`
  return null
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
  return { status: res.status, data }
}

function closed(status, data, which) {
  if (status === 403 && data && data.code === 'disabled') throw new HandoffError('disabled')
  if (which === 'create' && status === 401) throw new HandoffError('not-signed-in')
  if (which === 'redeem' && status === 400) throw new HandoffError('expired')
  throw new HandoffError('upstream')
}

function pickUser(u) {
  if (!u || typeof u !== 'object' || typeof u.id !== 'string' || !u.id) return null
  return { id: u.id, name: typeof u.name === 'string' ? u.name : '', admin: !!u.admin }
}

export async function establishSession(cookieJar, { apiBase, loginUserId, timeoutMs } = {}) {
  if (typeof loginUserId !== 'string' || !loginUserId) throw new HandoffError('mismatch')
  const cookie = sessionCookieHeader(cookieJar)
  if (!cookie) throw new HandoffError('not-signed-in')

  const created = await post(apiBase, '/api/pair/create', { cookie, timeoutMs })
  if (created.status !== 200 || !PAIR_RE.test(created.data && created.data.code)) closed(created.status, created.data, 'create')

  const redeemed = await post(apiBase, '/api/pair/redeem', { json: { code: created.data.code }, timeoutMs })
  const user = pickUser(redeemed.data && redeemed.data.user)
  const bearer = redeemed.data && redeemed.data.token
  if (redeemed.status !== 200 || !user || typeof bearer !== 'string' || !bearer) closed(redeemed.status, redeemed.data, 'redeem')
  if (user.id !== loginUserId) throw new HandoffError('mismatch')
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

export async function connect(cookieJar, { apiBase, loginUserId, key, store } = {}) {
  assertKey(key)
  const { user, bearer } = await establishSession(cookieJar, { apiBase, loginUserId })
  const connectionId = crypto.randomBytes(18).toString('base64url')
  store.set(connectionId, { userId: user.id, sealed: sealBearer(bearer, key, user.id) })
  return { connectionId }
}

export function sameOrigin(headers, origin) {
  const site = headers['sec-fetch-site']
  if (site) return site === 'same-origin'
  const o = headers.origin
  if (!o) return false
  return o.replace(/\/+$/, '') === String(origin).replace(/\/+$/, '')
}
