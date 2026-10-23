import http from 'node:http'
import crypto, { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTH_TTL_MS, MAX_STATE, discovery, redirectAllowed, sealAuth, openAuth } from './oauth.js'
import { createGrants, GrantError } from './grants.js'
import { connect, createPending, pickAssertion, sameOrigin } from './openGymSession.js'

const connectPage = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'web/connect.html'))
const COOKIE = '__Host-gym-oauth'
const MAX_BODY = 8192
const MAX_SPENT = 10000

function oauthCookie(req) {
  const values = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${COOKIE}=`)).map(s => s.slice(COOKIE.length + 1))
  return values.length === 1 && /^[A-Za-z0-9_-]{80,2048}$/.test(values[0]) ? values[0] : null
}

function bodyOf(req) {
  return new Promise((resolve, reject) => {
    let length = 0, chunks = []
    req.on('data', chunk => {
      length += chunk.length
      if (length > MAX_BODY) { reject(new Error('too_large')); req.resume(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        if (!['application/json', 'application/x-www-form-urlencoded'].includes((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase())) throw new Error('invalid_request')
        const text = Buffer.concat(chunks).toString('utf8')
        const data = req.headers['content-type'].toLowerCase().startsWith('application/json') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text))
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_request')
        resolve(data)
      } catch { reject(new Error('invalid_request')) }
    })
    req.on('error', reject)
  })
}

export function createServer({ origin, prefix, apiBase, key = crypto.randomBytes(32) } = {}) {
  const d = discovery({ origin, prefix })
  const pending = new Map(), connections = new Map(), spent = new Map()
  const grants = createGrants({ connections, key, apiBase })
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }
  // POST handlers deliberately receive no Cookie or Authorization from the browser. The only
  // cookie consumed is the connector's own pending ID on /connect, never an openGym session.
  return http.createServer(async (req, res) => {
    try {
      if (req.url.length > 4096) return send(res, 414, { error: 'invalid_request' })
      const url = new URL(req.url, 'http://x')
      const { pathname } = url
      if (req.method === 'GET') {
        if (pathname === `${prefix}/.well-known/oauth-protected-resource`) return send(res, 200, d.protectedResource)
        if (pathname === `/.well-known/oauth-authorization-server${prefix}`) return send(res, 200, d.authorizationServer)
        if (pathname === `${prefix}/authorize`) {
          const allowed = new Set(['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'resource'])
          if ([...url.searchParams.keys()].some(k => !allowed.has(k) || url.searchParams.getAll(k).length !== 1)) return send(res, 400, { error: 'invalid_request' })
          if (url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256' || url.searchParams.get('resource') !== d.mcpUrl) return send(res, 400, { error: 'invalid_request' })
          const clientId = url.searchParams.get('client_id'), redirectUri = url.searchParams.get('redirect_uri')
          const codeChallenge = url.searchParams.get('code_challenge')
          grants.checkAuthorizeRequest({ clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256' })
          const state = url.searchParams.get('state')
          if (state != null && state.length > MAX_STATE) return send(res, 400, { error: 'invalid_request' })
          // Authorization request state is AEAD-sealed into an HttpOnly cookie; GET /authorize does
          // not allocate server state. A temporary Map is used solely for createPending()'s ID mint.
          const id = createPending(new Map())
          const sealed = sealAuth({ id, clientId, redirectUri, codeChallenge, state, exp: Date.now() + AUTH_TTL_MS }, key)
          res.writeHead(303, { location: `${prefix}/connect`, 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=${sealed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300` })
          return res.end()
        }
        if (pathname === `${prefix}/connect`) {
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          })
          return res.end(connectPage)
        }
      }
      if (req.method === 'POST' && pathname === `${prefix}/connect`) {
        if (!sameOrigin(req.headers, origin)) return send(res, 403, { error: 'forbidden' })
        const raw = oauthCookie(req), p = raw && openAuth(raw, key)
        if (!p) return send(res, 403, { error: 'invalid_request' })
        if (Number(req.headers['content-length']) > MAX_BODY) return send(res, 413, { error: 'too_large' })
        // Spend the cookie's nonce before any await so a concurrent twin fails immediately.
        const id = p.id, hash = createHash('sha256').update(id).digest('base64url')
        const now = Date.now()
        for (const [h, exp] of spent) if (exp <= now) spent.delete(h)
        if (spent.has(hash) || spent.size >= MAX_SPENT) return send(res, spent.has(hash) ? 403 : 503, { error: spent.has(hash) ? 'invalid_request' : 'temporarily_unavailable' })
        spent.set(hash, p.exp)
        pending.set(id, { exp: p.exp })
        try {
          let assertion
          try { assertion = pickAssertion(await bodyOf(req)) } catch (e) { spent.delete(hash); throw e }
          await connect(assertion, { pending, pendingId: id, store: connections, apiBase, key })
          // Build and validate the final URL with a same-shape placeholder BEFORE minting, so nothing
          // that can still fail runs after issueAuthorizationCode (no orphaned code or bound connection).
          const build = code => {
            const u = new URL(p.redirectUri)
            u.searchParams.set('code', code)
            if (p.state !== null) u.searchParams.set('state', p.state)
            return u.href
          }
          if (!redirectAllowed(build('x'.repeat(43)), true)) throw new Error('invalid_request')
          const code = grants.issueAuthorizationCode({ connectionId: id, clientId: p.clientId, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge, codeChallengeMethod: 'S256' })
          return send(res, 200, { redirect: build(code) }, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` })
        } catch (e) { connections.delete(id); throw e }
        finally { pending.delete(id) }
      }
      if (req.method === 'POST' && pathname === `${prefix}/register`) {
        const body = await bodyOf(req)
        return send(res, 201, grants.registerClient(body))
      }
      if (req.method === 'POST' && pathname === `${prefix}/token`) {
        const b = await bodyOf(req)
        const result = b.grant_type === 'authorization_code'
          ? grants.exchangeCode({ code: b.code, clientId: b.client_id, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier })
          : b.grant_type === 'refresh_token'
            ? await grants.refresh({ refreshToken: b.refresh_token, clientId: b.client_id })
            : null
        if (!result) return send(res, 400, { error: 'unsupported_grant_type' })
        return send(res, 200, result)
      }
      if (req.method === 'POST' && pathname === `${prefix}/revoke`) {
        const b = await bodyOf(req)
        await grants.revoke({ token: b.token, clientId: b.client_id })
        return send(res, 200, {})
      }
      // ponytail: stub MCP endpoint, no token validation yet -> always 401 (fails closed). Task 10 wires it.
      if (pathname === `${prefix}/mcp`) {
        return send(res, 401, { error: 'unauthorized' }, {
          'www-authenticate': `Bearer resource_metadata="${d.resourceMetadataUrl}"`,
        })
      }
      send(res, 404, { error: 'not_found' })
    } catch (e) {
      if (res.headersSent) return
      const status = e.message === 'too_large' ? 413 : 400
      send(res, status, { error: e instanceof GrantError ? e.code : 'invalid_request' })
    }
  })
}
