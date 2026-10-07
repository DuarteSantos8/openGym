/* OAuth 2.1 authorization server for the remote MCP connector, on the MCP SDK's provider
   interface. State lives in one JSON file under OAUTH_DATA (tokens are stored hashed). The
   consent page authenticates with the app's own session cookie, verified against ./data/secret
   and db.json exactly as api/server.js does, and a connection is bound to the user who approved
   it: there is no way to grant access to anyone else's profile. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  AccessDeniedError, InvalidGrantError, InvalidRequestError,
  InvalidScopeError, InvalidTargetError, InvalidTokenError
} from '@modelcontextprotocol/sdk/server/auth/errors.js'

const ACCESS_TTL_MS = 60 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CODE_TTL_MS = 5 * 60 * 1000
const APPROVAL_TTL_MS = 10 * 60 * 1000
const ALLOWED_SCOPES = new Set(['opengym:read', 'opengym:write', 'offline_access'])
const sha256 = value => crypto.createHash('sha256').update(value).digest('base64url')
const randomToken = () => crypto.randomBytes(32).toString('base64url')

function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) } catch { return false }
}

function sessionCookie(header = '', secure = true) {
  // Same rules as cookieToken() in api/server.js: prefer __Host-, and refuse duplicates rather
  // than guess which one is real.
  for (const name of (secure ? ['__Host-gymsid', 'gymsid'] : ['gymsid'])) {
    const values = header.split(';').flatMap(part => {
      const i = part.indexOf('=')
      return i >= 0 && part.slice(0, i).trim() === name ? [part.slice(i + 1).trim()] : []
    })
    if (!values.length) continue
    return values.some(value => value !== values[0]) ? null : values[0]
  }
  return null
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])
}

export class OpenGymOAuthProvider {
  constructor({ dataDir, oauthDir, resource, authorizationUrl, issuer }) {
    this.dataDir = dataDir
    this.oauthDir = oauthDir
    this.resource = resource
    this.authorizationUrl = authorizationUrl
    this.issuer = issuer ? new URL(issuer).href : new URL('/', authorizationUrl).href
    this.storeFile = path.join(oauthDir, 'oauth.json')
    fs.mkdirSync(oauthDir, { recursive: true, mode: 0o700 })
    this.store = this.#readStore()
    this.consents = new Map() // one-use consent-form nonces; a restart invalidates open forms
    this.clientsStore = {
      getClient: async clientId => this.store.clients[clientId],
      registerClient: async client => this.#registerClient(client)
    }
  }

  #readStore() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'))
      return { clients: {}, codes: {}, access: {}, refresh: {}, connections: {}, pending: {}, ...parsed }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error // never overwrite a store we could not read
      return { clients: {}, codes: {}, access: {}, refresh: {}, connections: {}, pending: {} }
    }
  }

  #save() {
    this.#prune()
    const tmp = `${this.storeFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, this.storeFile)
    fs.chmodSync(this.storeFile, 0o600)
  }

  #prune() {
    const now = Date.now()
    for (const [key, value] of this.consents) if (value.expiresAt <= now) this.consents.delete(key)
    for (const area of ['codes', 'access', 'refresh']) {
      for (const [key, value] of Object.entries(this.store[area])) {
        if (!value.expiresAt || value.expiresAt <= now) delete this.store[area][key]
      }
    }
    for (const [key, value] of Object.entries(this.store.pending)) if (!value.expiresAt || value.expiresAt <= now) delete this.store.pending[key]
  }

  #db() {
    try { return JSON.parse(fs.readFileSync(path.join(this.dataDir, 'db.json'), 'utf8')) } catch { return { users: [] } }
  }

  #sessionUser(req) {
    const token = sessionCookie(req?.headers?.cookie, this.authorizationUrl.protocol === 'https:')
    if (!token) return null
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const payload = token.slice(0, dot)
    const mac = token.slice(dot + 1)
    let secret
    try { secret = fs.readFileSync(path.join(this.dataDir, 'secret'), 'utf8').trim() } catch { return null }
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
    if (!safeEqual(mac, expected)) return null
    const [uid, expires, version] = payload.split(':')
    if (!uid || !Number.isSafeInteger(Number(expires)) || Number(expires) <= Date.now()) return null
    const user = (this.#db().users || []).find(candidate => candidate.id === uid)
    if (!user || user.disabled) return null
    const claimedVersion = version === undefined ? 0 : Number(version)
    if (!Number.isInteger(claimedVersion) || claimedVersion !== (user.sv || 0)) return null
    return user
  }

  sessionUser(req) { return this.#sessionUser(req) }

  #connection(connectionId) {
    const connection = this.store.connections[connectionId]
    if (!connection || connection.revokedAt) return null
    return connection
  }

  manage(user) {
    return {
      endpoint: this.resource.href,
      profile: { id: user.id, name: user.name },
      connections: Object.values(this.store.connections).filter(item => item.ownerUid === user.id && !item.revokedAt)
        .map(({ id, name, scopes, createdAt, lastUsedAt }) => ({ id, name, scopes, createdAt, lastUsedAt })),
      pending: Object.values(this.store.pending).filter(item => item.ownerUid === user.id && item.expiresAt > Date.now())
        .map(({ id, tool, summary, createdAt, expiresAt }) => ({ id, tool, summary, createdAt, expiresAt }))
    }
  }

  revokeConnection(user, id) {
    const connection = this.#connection(id)
    if (!connection || connection.ownerUid !== user.id) throw Object.assign(new Error('Connection not found'), { status: 404 })
    connection.revokedAt = Date.now()
    for (const area of ['access', 'refresh']) for (const [key, grant] of Object.entries(this.store[area])) {
      if (grant.connectionId === id) delete this.store[area][key]
    }
    for (const [key, item] of Object.entries(this.store.pending)) if (item.connectionId === id) delete this.store.pending[key]
    this.#save()
  }

  requestApproval(authInfo, tool, params) {
    const connection = this.#connection(authInfo?.extra?.connectionId)
    if (!connection || connection.ownerUid !== authInfo?.extra?.userId) throw Object.assign(new Error('Connection is no longer active'), { code: 'FORBIDDEN' })
    this.#prune()
    if (Object.values(this.store.pending).filter(item => item.connectionId === connection.id).length >= 50) throw new InvalidRequestError('Too many pending approvals; wait for expiry or revoke this connection')
    const id = randomToken()
    const clean = Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'confirm'))
    const summary = Object.entries(clean).filter(([key]) => key !== 'expected_version')
      .map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`).join(', ')
    this.store.pending[id] = {
      id, connectionId: connection.id, ownerUid: connection.ownerUid, tool: tool.name, params: clean, summary,
      createdAt: Date.now(), expiresAt: Date.now() + APPROVAL_TTL_MS
    }
    this.#save()
    return { approval_required: true, approval_id: id, message: 'Open openGym Settings and approve this deletion within 10 minutes.' }
  }

  consumeApproval(user, id) {
    const item = this.store.pending[id]
    if (!item || item.ownerUid !== user.id) throw Object.assign(new Error('Approval request not found'), { status: 404 })
    delete this.store.pending[id] // one use, whatever happens next
    this.#save()
    if (item.expiresAt <= Date.now()) throw Object.assign(new Error('Approval request expired'), { status: 404 })
    const connection = this.#connection(item.connectionId)
    if (!connection || connection.ownerUid !== user.id || !connection.scopes.includes('opengym:write')) throw Object.assign(new Error('Connection no longer has permission'), { status: 403 })
    return { ...item, authInfo: { scopes: connection.scopes, extra: { userId: user.id, connectionId: connection.id, approvedRequest: item.id } } }
  }

  #validUser(uid, sessionVersion) {
    const user = (this.#db().users || []).find(candidate => candidate.id === uid)
    return !!user && !user.disabled && (user.sv || 0) === sessionVersion
  }

  async #registerClient(client) {
    if (Object.keys(this.store.clients).length >= 1000) throw new InvalidRequestError('Client registration limit reached; contact the installation administrator')
    if (!client.client_id || !Array.isArray(client.redirect_uris) || !client.redirect_uris.length || client.redirect_uris.length > 10) {
      throw new InvalidRequestError('Invalid client registration')
    }
    for (const value of client.redirect_uris) {
      const uri = new URL(value)
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)
      if (uri.hash || uri.username || uri.password || (uri.protocol !== 'https:' && !(loopback && uri.protocol === 'http:'))) {
        throw new InvalidRequestError('Redirect URIs must use HTTPS, except HTTP loopback callbacks')
      }
    }
    this.store.clients[client.client_id] = client
    this.#save()
    return client
  }

  #validateGrant(scopes, resource) {
    const actualScopes = scopes?.length ? scopes : ['opengym:read', 'opengym:write']
    if (actualScopes.some(scope => !ALLOWED_SCOPES.has(scope))) throw new InvalidScopeError('Only opengym:read and opengym:write are supported')
    if (!actualScopes.includes('opengym:read')) throw new InvalidScopeError('opengym:read is required')
    if (resource && resource.href.replace(/\/$/, '') !== this.resource.href.replace(/\/$/, '')) {
      throw new InvalidTargetError('The requested resource is not this openGym MCP server')
    }
    return actualScopes
  }

  async authorize(client, params, res) {
    this.#prune()
    let scopes = this.#validateGrant(params.scopes, params.resource)
    if (!client.redirect_uris.includes(params.redirectUri)) throw new InvalidRequestError('Unregistered redirect_uri')
    const user = this.#sessionUser(res.req)
    const query = new URLSearchParams({
      client_id: client.client_id, redirect_uri: params.redirectUri, response_type: 'code',
      code_challenge: params.codeChallenge, code_challenge_method: 'S256', scope: scopes.join(' ')
    })
    if (params.state !== undefined) query.set('state', params.state)
    if (params.resource) query.set('resource', params.resource.href)
    const retry = `${this.authorizationUrl.href}?${query}`
    res.set?.('Referrer-Policy', 'no-referrer')
    res.set?.('Cache-Control', 'no-store')
    if (!user) {
      res.status(401).type('html')
      res.set?.('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
      res.send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect to openGym</title><style>body{font:16px system-ui;max-width:34rem;margin:12vh auto;padding:1.5rem;background:#101310;color:#eef2e9}a{display:inline-block;margin:.5rem .5rem .5rem 0;padding:.8rem 1rem;border-radius:.6rem;background:#b7f34a;color:#111;text-decoration:none}p{line-height:1.5}</style><h1>Connect to openGym</h1><p>Sign in to openGym with your passkey. Then return here and choose Continue.</p><a href="/" target="_blank" rel="noopener">Open openGym</a><a href="${escapeHtml(retry)}">Continue</a></html>`)
      return
    }
    if (res.req.body?.approve !== 'yes') {
      if (this.consents.size >= 1000) throw new InvalidRequestError('Too many authorization requests; try again later')
      const nonce = randomToken()
      this.consents.set(nonce, { uid: user.id, sv: user.sv || 0, query: query.toString(), expiresAt: Date.now() + CODE_TTL_MS })
      const hidden = [...query, ['consent_nonce', nonce]].map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('')
      const canWrite = scopes.includes('opengym:write')
      res.status(200)
      // No form-action here: browsers apply it to the redirects that follow the submission
      // too, and the 303 below goes to the client's own (already validated) redirect_uri.
      res.set?.('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
      res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize connection</title><style>body{font:16px system-ui;max-width:34rem;margin:8vh auto;padding:1.5rem;background:#101310;color:#eef2e9}label{display:block;padding:.65rem 0;min-height:28px}input{accent-color:#b7f34a}fieldset{margin:1rem 0;border:1px solid #59634f;border-radius:.7rem}button{min-height:44px;padding:.85rem 1.1rem;border:0;border-radius:.6rem;background:#b7f34a;color:#111;font-weight:700}.warn{line-height:1.5;padding:1rem;border:1px solid #6f7d61;border-radius:.7rem}a{color:#b7f34a}</style><h1>Connect to openGym</h1><p><strong>${escapeHtml(client.client_name || 'MCP client')}</strong> requests access. Its callback is <strong>${escapeHtml(new URL(params.redirectUri).host)}</strong>. Only authorize a client you recognize.</p><p>This connects your own openGym profile, <strong>${escapeHtml(user.name)}</strong>. No other account on this instance is ever reachable through this connection.</p><form method="post" action="${escapeHtml(this.authorizationUrl.href)}">${hidden}<fieldset><legend>Permission</legend><label><input type="radio" name="mode" value="read" checked> Read only</label>${canWrite ? '<label><input type="radio" name="mode" value="write"> Read and write</label>' : ''}</fieldset><p class="warn">Write access can change training data. Deletions still require separate approval in openGym.</p><button name="approve" value="yes">Authorize connection</button> <a href="/settings">Cancel</a></form></html>`)
      return
    }
    const nonce = res.req.body.consent_nonce
    const consent = this.consents.get(nonce)
    const site = res.req.headers['sec-fetch-site']
    // Sec-Fetch-Site decides when the browser sends it. Origin is only the fallback: Safari
    // sends `Origin: null` for this very POST when the page was opened by a redirect from the
    // client's site, which is how every hosted client starts the flow.
    const sameOrigin = site !== undefined
      ? ['same-origin', 'none'].includes(site)
      : res.req.headers.origin === this.authorizationUrl.origin
    if (res.req.method !== 'POST' || !sameOrigin || !consent || consent.uid !== user.id || consent.sv !== (user.sv || 0) || consent.query !== query.toString()) throw new AccessDeniedError('Invalid or expired consent; open the authorization page again')
    this.consents.delete(nonce)
    if (Object.values(this.store.connections).filter(item => item.ownerUid === user.id && !item.revokedAt).length >= 100) throw new InvalidRequestError('Connection limit reached; revoke an unused connection first')
    if (res.req.body.mode !== 'write') scopes = scopes.filter(scope => scope !== 'opengym:write')
    const connectionId = randomToken()
    this.store.connections[connectionId] = {
      id: connectionId, ownerUid: user.id, scopes,
      clientId: client.client_id, name: client.client_name || 'MCP client', createdAt: Date.now(), lastUsedAt: null, revokedAt: null
    }
    const code = randomToken()
    this.store.codes[sha256(code)] = {
      clientId: client.client_id, redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge, scopes, uid: user.id,
      sessionVersion: user.sv || 0, resource: params.resource?.href || this.resource.href,
      connectionId, expiresAt: Date.now() + CODE_TTL_MS
    }
    this.#save()
    const target = new URL(params.redirectUri)
    target.searchParams.set('code', code)
    if (params.state !== undefined) target.searchParams.set('state', params.state)
    // RFC 9207: lets the client check the response came from the issuer it discovered.
    target.searchParams.set('iss', this.issuer)
    // 303 so the client's callback is fetched with GET after this POST.
    res.redirect(303, target.href)
  }

  async challengeForAuthorizationCode(client, code) {
    const grant = this.store.codes[sha256(code)]
    if (!grant || grant.expiresAt <= Date.now() || grant.clientId !== client.client_id) throw new InvalidGrantError('Invalid or expired authorization code')
    return grant.codeChallenge
  }

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const key = sha256(code)
    const grant = this.store.codes[key]
    delete this.store.codes[key]
    if (!grant || grant.expiresAt <= Date.now() || grant.clientId !== client.client_id || (redirectUri && redirectUri !== grant.redirectUri)) {
      this.#save()
      throw new InvalidGrantError('Invalid or expired authorization code')
    }
    if (!this.#connection(grant.connectionId) || !this.#validUser(grant.uid, grant.sessionVersion)) throw new AccessDeniedError('The openGym session or connection is no longer valid')
    this.#validateGrant(grant.scopes, resource)
    return this.#issueTokens(grant)
  }

  #issueTokens(grant) {
    const access = randomToken()
    const refresh = randomToken()
    const now = Date.now()
    const common = { clientId: grant.clientId, scopes: grant.scopes, uid: grant.uid, connectionId: grant.connectionId, sessionVersion: grant.sessionVersion, resource: grant.resource }
    this.store.access[sha256(access)] = { ...common, expiresAt: now + ACCESS_TTL_MS }
    this.store.refresh[sha256(refresh)] = { ...common, expiresAt: now + REFRESH_TTL_MS }
    this.#save()
    return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: ACCESS_TTL_MS / 1000, scope: grant.scopes.join(' ') }
  }

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const key = sha256(refreshToken)
    const grant = this.store.refresh[key]
    delete this.store.refresh[key]
    if (!grant || !this.#connection(grant.connectionId) || grant.expiresAt <= Date.now() || grant.clientId !== client.client_id || !this.#validUser(grant.uid, grant.sessionVersion)) {
      this.#save()
      throw new InvalidGrantError('Invalid or expired refresh token')
    }
    const requested = scopes?.length ? scopes : grant.scopes
    if (requested.some(scope => !grant.scopes.includes(scope))) throw new InvalidScopeError('Refresh scope exceeds the original grant')
    this.#validateGrant(requested, resource)
    return this.#issueTokens({ ...grant, scopes: requested })
  }

  async verifyAccessToken(token) {
    const grant = this.store.access[sha256(token)]
    const connection = grant && this.#connection(grant.connectionId)
    if (!grant || !connection || grant.expiresAt <= Date.now() || !this.#validUser(grant.uid, grant.sessionVersion)) throw new InvalidTokenError('Invalid or expired access token')
    if (!connection.lastUsedAt || Date.now() - connection.lastUsedAt > 60_000) {
      connection.lastUsedAt = Date.now()
      this.#save()
    }
    return {
      token, clientId: grant.clientId, scopes: grant.scopes.filter(scope => connection.scopes.includes(scope)),
      expiresAt: Math.floor(grant.expiresAt / 1000), resource: new URL(grant.resource),
      extra: { userId: grant.uid, connectionId: connection.id }
    }
  }

  async revokeToken(client, request) {
    for (const area of ['access', 'refresh']) {
      const key = sha256(request.token)
      if (this.store[area][key]?.clientId === client.client_id) delete this.store[area][key]
    }
    this.#save()
  }
}
