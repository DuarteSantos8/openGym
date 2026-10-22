import crypto from 'node:crypto'

// Lifetimes (conservative; nothing in the spec fixes them). Refresh is sliding: each rotation
// restarts the idle window, and replay of a used refresh token revokes the whole grant.
export const CODE_TTL_MS = 60_000
export const ACCESS_TTL_MS = 10 * 60_000
export const REFRESH_TTL_MS = 30 * 86_400_000
export const GRANT_MAX_MS = 90 * 86_400_000 // absolute cap: a passkey sign-in is needed again after this
export const AUTH_TTL_MS = 5 * 60_000
export const MAX_STATE = 256

const AUTH_AAD = Buffer.from('opengym-connector:authz:v1', 'utf8')

function assertKey(key) {
  if (!key || typeof key !== 'object' || typeof key.length !== 'number' || key.length !== 32) {
    throw new TypeError('AES-256-GCM key must be 32 bytes')
  }
}

// The one redirect allowlist. Self-contained on purpose: the server inlines this function's own
// source into connect.html, so the browser and the server cannot disagree. Exact Claude callback, or
// http loopback with an explicit port and the exact path /callback. No userinfo, fragment, backslash,
// '..' or percent-encoding in the part before '?'. `withParams` also allows the server-appended
// ?code=&state= (each at most once, nothing else).
export function redirectAllowed(uri, withParams) {
  if (typeof uri !== 'string' || uri.length > 4096) return false
  const q = uri.indexOf('?')
  const head = q < 0 ? uri : uri.slice(0, q)
  if (/[\\%#]|\.\./.test(head) || (q >= 0 && (!withParams || /[#\\]/.test(uri.slice(q))))) return false
  let u
  try { u = new URL(uri) } catch { return false }
  if (u.username || u.password || u.hash || head !== u.origin + u.pathname) return false
  if (q >= 0) {
    const keys = [...u.searchParams.keys()]
    if (!keys.length || keys.length !== new Set(keys).size || keys.some(k => k !== 'code' && k !== 'state')) return false
  }
  if (head === 'https://claude.ai/api/mcp/auth_callback') return true
  return u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)
    && /^[1-9][0-9]{0,4}$/.test(u.port) && Number(u.port) <= 65535 && u.pathname === '/callback'
}

export function pkceChallengeOk(verifier, challenge) {
  const a = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'))
  const b = Buffer.from(String(challenge))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function sealAuth(obj, key) {
  assertKey(key)
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(AUTH_AAD)
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
  return Buffer.concat([iv, enc, c.getAuthTag()]).toString('base64url')
}

export function openAuth(sealed, key, now = Date.now) {
  try {
    assertKey(key)
    const buf = Buffer.from(String(sealed), 'base64url')
    if (buf.length < 29 || buf.length > 2048) return null
    const iv = buf.subarray(0, 12), tag = buf.subarray(buf.length - 16), enc = buf.subarray(12, buf.length - 16)
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
    d.setAAD(AUTH_AAD)
    d.setAuthTag(tag)
    const obj = JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'))
    const t = typeof now === 'function' ? now() : now
    if (!obj || typeof obj !== 'object' || typeof obj.id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(obj.id)) return null
    if (typeof obj.clientId !== 'string' || typeof obj.codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(obj.codeChallenge)) return null
    if (typeof obj.exp !== 'number' || t >= obj.exp) return null
    if (!redirectAllowed(obj.redirectUri, false)) return null
    if (obj.state != null && (typeof obj.state !== 'string' || obj.state.length > MAX_STATE)) return null
    return obj
  } catch { return null }
}

// RFC 9728 protected-resource + RFC 8414 authorization-server metadata.
export function discovery({ origin, prefix }) {
  const issuer = `${origin}${prefix}`
  return {
    issuer,
    mcpUrl: `${issuer}/mcp`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    protectedResource: {
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
    },
    authorizationServer: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
      revocation_endpoint_auth_methods_supported: ['none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      // Non-standard hint: refresh tokens are single-use (public client); replay revokes the grant.
      refresh_token_rotation: true,
    },
  }
}
