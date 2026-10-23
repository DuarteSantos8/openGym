import crypto from 'node:crypto'
import { openBearer } from './openGymSession.js'
import {
  ACCESS_TTL_MS, CODE_TTL_MS, GRANT_MAX_MS, MAX_CLIENT_REDIRECTS, REFRESH_TTL_MS,
  clientKey, openClient, pkceChallengeOk, redirectAllowed, sealClient,
} from './oauth.js'

export class GrantError extends Error {
  constructor(code) {
    super(code)
    this.name = 'GrantError'
    this.code = code
  }
}

const fail = code => { throw new GrantError(code) }
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
const MAX_REGISTER_URIS = 10
const MAX_ME = 8192

const sha = s => crypto.createHash('sha256').update(s).digest('base64url')
function mint(map) {
  let t
  do { t = crypto.randomBytes(32).toString('base64url') } while (map.has(sha(t)))
  return t
}

// Everything lives in memory: a restart revokes every grant (fail closed). Codes and tokens are
// kept only as SHA-256 hashes of 256-bit random values, so the stores are useless if dumped.
// `connections` is the Task 2 store ({userId, sealed}); a grant is bound to one connection and
// takes its openGym user from that stored record, never from anything the browser sent.
export function createGrants({
  connections, key, apiBase, now = Date.now,
  codes = new Map(), access = new Map(), refreshTokens = new Map(),
} = {}) {
  if (!connections || typeof connections.get !== 'function') throw new TypeError('connections required')
  const subkey = clientKey(key) // also validates the key up front
  const grants = new Map()
  const usedRefresh = new Map() // hash of a rotated-out refresh token -> { grantId, exp }
  const bound = new Set() // connection ids that already back a code or a grant
  const t = () => (typeof now === 'function' ? now() : now)

  function kill(grantId) {
    const g = grants.get(grantId)
    grants.delete(grantId)
    if (g) { connections.delete(g.connectionId); bound.delete(g.connectionId) }
    for (const m of [access, refreshTokens, usedRefresh]) for (const [h, r] of m) if (r.grantId === grantId) m.delete(h)
  }

  function sweep() {
    const ts = t()
    for (const [h, r] of [...codes]) if (r.exp <= ts) { codes.delete(h); connections.delete(r.connectionId); bound.delete(r.connectionId) }
    for (const [h, r] of [...access]) if (r.exp <= ts) access.delete(h)
    for (const [h, r] of [...usedRefresh]) if (r.exp <= ts) usedRefresh.delete(h)
    for (const [, r] of [...refreshTokens]) if (r.exp <= ts) kill(r.grantId)
    for (const [id, g] of [...grants]) if (g.exp <= ts) kill(id)
  }

  function tokensFor(grantId) {
    const g = grants.get(grantId)
    const at = mint(access), rt = mint(refreshTokens), ts = t()
    access.set(sha(at), { grantId, exp: ts + ACCESS_TTL_MS })
    refreshTokens.set(sha(rt), { grantId, exp: Math.min(ts + REFRESH_TTL_MS, g.exp) })
    return { access_token: at, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: rt }
  }

  // The registered redirects for a client_id, or invalid_client. Nothing is looked up or stored.
  const clientRedirects = clientId => openClient(clientId, subkey) || fail('invalid_client')

  function registerClient(meta = {}) {
    const uris = meta && meta.redirect_uris
    if (!Array.isArray(uris) || !uris.length || uris.length > MAX_REGISTER_URIS || uris.some(u => !redirectAllowed(u, false))) fail('invalid_client_metadata')
    const redirect_uris = [...new Set(uris)]
    if (redirect_uris.length > MAX_CLIENT_REDIRECTS) fail('invalid_client_metadata')
    if ((meta.token_endpoint_auth_method ?? 'none') !== 'none') fail('invalid_client_metadata')
    return {
      client_id: sealClient(redirect_uris, subkey), redirect_uris, token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    }
  }

  // Pure: validates, mutates nothing.
  function checkAuthorizeRequest({ clientId, redirectUri, codeChallenge, codeChallengeMethod } = {}) {
    const redirects = clientRedirects(clientId)
    if (typeof redirectUri !== 'string' || !redirects.includes(redirectUri)) fail('invalid_client')
    if (codeChallengeMethod !== undefined && codeChallengeMethod !== 'S256') fail('invalid_request')
    if (typeof codeChallenge !== 'string' || !TOKEN.test(codeChallenge)) fail('invalid_request')
  }

  function issueAuthorizationCode({ connectionId, clientId, redirectUri, codeChallenge, codeChallengeMethod } = {}) {
    sweep()
    try { checkAuthorizeRequest({ clientId, redirectUri, codeChallenge, codeChallengeMethod }) } catch (e) {
      if (typeof connectionId === 'string' && !bound.has(connectionId)) connections.delete(connectionId)
      fail(e.code === 'invalid_client' ? 'invalid_request' : e.code)
    }
    if (typeof connectionId === 'string' && bound.has(connectionId)) fail('invalid_grant')
    const conn = typeof connectionId === 'string' ? connections.get(connectionId) : null
    if (!conn || typeof conn.userId !== 'string' || !conn.userId) {
      if (typeof connectionId === 'string') connections.delete(connectionId)
      fail('invalid_grant')
    }
    bound.add(connectionId)
    const code = mint(codes)
    codes.set(sha(code), { clientId, redirectUri, challenge: codeChallenge, connectionId, userId: conn.userId, exp: t() + CODE_TTL_MS })
    return code
  }

  function exchangeCode({ code, clientId, redirectUri, codeVerifier } = {}) {
    sweep()
    clientRedirects(clientId)
    if (typeof code !== 'string' || !TOKEN.test(code)) fail('invalid_grant')
    const h = sha(code)
    const rec = codes.get(h)
    if (!rec) fail('invalid_grant')
    codes.delete(h) // one try: any failure below also discards the connection it was minted for
    const ok = rec.clientId === clientId && rec.redirectUri === redirectUri
      && typeof codeVerifier === 'string' && VERIFIER.test(codeVerifier) && pkceChallengeOk(codeVerifier, rec.challenge)
    const conn = connections.get(rec.connectionId)
    if (!ok || !conn || conn.userId !== rec.userId) {
      connections.delete(rec.connectionId)
      bound.delete(rec.connectionId)
      fail('invalid_grant')
    }
    const grantId = crypto.randomBytes(16).toString('base64url')
    grants.set(grantId, { clientId, connectionId: rec.connectionId, userId: rec.userId, exp: t() + GRANT_MAX_MS })
    return tokensFor(grantId)
  }

  async function refresh({ refreshToken, clientId } = {}) {
    sweep()
    clientRedirects(clientId)
    if (typeof refreshToken !== 'string' || !TOKEN.test(refreshToken)) fail('invalid_grant')
    const h = sha(refreshToken)
    const used = usedRefresh.get(h)
    if (used) { kill(used.grantId); fail('invalid_grant') } // replay: the family is compromised
    const rec = refreshTokens.get(h)
    const g = rec && grants.get(rec.grantId)
    if (!rec || !g || g.clientId !== clientId) fail('invalid_grant')
    refreshTokens.delete(h)
    usedRefresh.set(h, { grantId: rec.grantId, exp: rec.exp })
    for (const [ah, a] of access) if (a.grantId === rec.grantId) access.delete(ah)
    return tokensFor(rec.grantId)
  }

  // RFC 7009 shape: never says whether the token was known. Only the owning client can revoke.
  async function revoke({ token, clientId } = {}) {
    clientRedirects(clientId)
    if (typeof token !== 'string' || !TOKEN.test(token)) return
    const h = sha(token)
    const rec = access.get(h) || refreshTokens.get(h)
    const g = rec && grants.get(rec.grantId)
    if (g && g.clientId === clientId) kill(rec.grantId)
  }

  // The openGym bearer for a live access token, or null. Every call re-asks openGym who the bearer
  // is: "sign out everywhere" and a disabled account both make it 401, and either revokes the grant
  // for good (re-enabling the account must not revive access). Network trouble or a 5xx only fails
  // this call.
  async function bearerForAccessToken(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null
    sweep()
    const rec = access.get(sha(token))
    const g = rec && grants.get(rec.grantId)
    if (!rec || !g) return null
    const conn = connections.get(g.connectionId)
    let bearer
    try { bearer = conn && conn.userId === g.userId ? openBearer(conn.sealed, key, g.userId) : null } catch { bearer = null }
    if (!bearer) { kill(rec.grantId); return null }
    // Only the status and the user id matter. The body is streamed under a hard cap; a transport
    // failure (network, timeout, mid-body reset) is transient, but a 200 whose identity cannot be
    // read (oversized, not JSON, no id) is not something to keep a grant on.
    let status, data = null, text = ''
    try {
      const res = await fetch(`${apiBase}/api/me`, {
        headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
        redirect: 'manual', signal: AbortSignal.timeout(10000),
      })
      status = res.status
      if (status === 200) {
        const chunks = []
        let n = 0, over = false
        if (res.body) {
          const reader = res.body.getReader()
          for (;;) {
            const step = await reader.read()
            if (step.done) break
            n += step.value.length
            if (n > MAX_ME) { over = true; await reader.cancel().catch(() => {}); break }
            chunks.push(step.value)
          }
        }
        if (over) { kill(rec.grantId); return null }
        text = Buffer.concat(chunks).toString('utf8')
      } else if (res.body) await res.body.cancel().catch(() => {})
    } catch { return null }
    if (status === 200) { try { data = JSON.parse(text) } catch { data = null } }
    if (status === 200 && data && data.user && data.user.id === g.userId) return grants.get(rec.grantId) === g ? bearer : null
    if (status === 200 || status === 401 || status === 403 || (status >= 300 && status < 400)) kill(rec.grantId)
    return null
  }

  return {
    registerClient, checkAuthorizeRequest, issueAuthorizationCode, exchangeCode, refresh, revoke, bearerForAccessToken,
  }
}
