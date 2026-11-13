#!/usr/bin/env node
/* openGym MCP over HTTPS (#781, #314): the same tools as the stdio server, as a Streamable HTTP
   endpoint for clients that cannot spawn a local process (hosted assistants, a phone, another
   machine). It runs as the optional `mcp` container (docker-compose.yml, profile `mcp`), and the
   web container proxies /mcp to it, so it lives on the app's own origin behind whatever already
   publishes the app (docs/MCP_REMOTE.md).

   It holds no data and no secret of its own. Every request carries a scoped token
   (`Authorization: Bearer ogt_…`, Settings → API tokens), and every read and write goes through
   the api with that token (remote.js), which hands it only its categories and refuses the rest
   (api/tokens.js). A paired session's token is not taken here: a full sign-in has no business in
   a hosted client's config. Stateless: no MCP session, a fresh server per request, JSON answers.

   Env: MCP_PORT (3100), OPENGYM_API_URL (http://api:3000, the api inside the compose network),
   MCP_PATH (/mcp), MCP_ALLOWED_ORIGINS (browser Origins allowed besides none; default ORIGIN). */
import http from 'node:http'
import crypto from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer, VERSION } from './server.js'
import { withProfile } from './state.js'
import { createRemoteProfile } from './remote.js'

export const MAX_BODY = 1024 * 1024
// api/oauth.js DEFAULT_SCOPE (the api is not a dependency of this package), plus a refresh token.
export const DEFAULT_SCOPE = 'workouts:view plans:apply bodyweight:view offline_access'
const TOKEN_RE = /^ogt_[A-Za-z0-9_-]{43}$/

/** A tiny fixed-window counter: take(key) → seconds to wait, 0 within budget. */
function windowCounter(max, ms, now = Date.now) {
  const m = new Map()
  return {
    take(key) {
      let e = m.get(key)
      if (!e || now() - e.start >= ms) { e = { start: now(), n: 0 }; if (m.size > 10000) m.clear() }
      e.n++
      m.set(key, e)
      return e.n > max ? Math.max(1, Math.ceil((e.start + ms - now()) / 1000)) : 0
    },
  }
}

/** The request handler, separate from listening so tests can mount it. */
export function createMcpHandler({
  apiUrl = process.env.OPENGYM_API_URL || 'http://api:3000',
  path = process.env.MCP_PATH || '/mcp',
  allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || process.env.ORIGIN || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
  fetchImpl,
  now = Date.now,
  // The app's public address, for the OAuth discovery pointer on a 401 (api/oauth.js): Claude
  // and ChatGPT start their sign-in from it. Without one the 401 says only how to make a token.
  publicOrigin = (process.env.ORIGIN || '').replace(/\/+$/, ''),
  // Under a subpath deployment the documents live below the prefix too (BASE_PATH, docs/MCP_REMOTE.md).
  basePath = String(process.env.BASE_PATH || '').replace(/\/+$/, ''),
} = {}) {
  const base = String(apiUrl).replace(/\/+$/, '')
  // One cached profile per token (by its hash), so a conversation of tool calls reads the
  // document once and then only the revision. Dropped after ten idle minutes.
  const cache = new Map()
  const IDLE = 10 * 60000
  const refused = windowCounter(30, 60000, now)   // failed sign-ins per client address
  const clientOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim()

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }
  const rpcError = (res, status, message, headers) => send(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null }, headers)
  // The pointer Claude and ChatGPT start their sign-in from (RFC 9728 5.1), and the scope they
  // should ask for when the person picks nothing else: read the training, plan it. Claude
  // requires the 401 (it ignores the header on any other status).
  const unauthorized = (res, why) => rpcError(res, 401, why, {
    'WWW-Authenticate': 'Bearer realm="openGym", error="invalid_token", error_description="sign in with openGym, or make a token in Settings, API tokens"'
      + (publicOrigin ? `, resource_metadata="${publicOrigin}${basePath}/.well-known/oauth-protected-resource/mcp", scope="${DEFAULT_SCOPE}"` : ''),
  })

  function profileFor(token) {
    const key = crypto.createHash('sha256').update(token).digest('hex')
    for (const [k, v] of cache) if (now() - v.at > IDLE) cache.delete(k)
    let hit = cache.get(key)
    if (!hit) {
      if (cache.size > 500) cache.delete(cache.keys().next().value)
      hit = { remote: createRemoteProfile({ base, token }, fetchImpl ? { fetchImpl } : {}), at: now() }
      cache.set(key, hit)
    }
    hit.at = now()
    return { key, remote: hit.remote }
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0, over = false
      const chunks = []
      req.on('data', d => {
        size += d.length
        // Drain instead of destroying: a reset socket would drop the 413 (same as api readBody).
        if (over) { if (size > 2 * MAX_BODY) req.destroy(); return }
        if (size > MAX_BODY) { over = true; chunks.length = 0; reject(Object.assign(new Error('body too large'), { status: 413 })); return }
        chunks.push(d)
      })
      req.on('end', () => {
        if (over) return
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(Object.assign(new Error('invalid json'), { status: 400 })) }
      })
      req.on('error', reject)
    })
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x')
    const p = url.pathname.replace(/\/+$/, '') || '/'
    if (p === path + '/health' || p === '/health') return send(res, 200, { ok: true, version: VERSION })
    if (p !== path) return send(res, 404, { error: 'not found' })
    // DNS rebinding (the MCP spec's own rule): a browser page on another origin is turned away.
    // Clients that are not browsers send no Origin.
    const origin = req.headers.origin
    if (origin && !allowedOrigins.includes(String(origin).replace(/\/+$/, ''))) return rpcError(res, 403, 'origin not allowed')
    if (req.method !== 'POST') return rpcError(res, 405, 'POST only: this endpoint is stateless (no GET stream, no session to delete)', { Allow: 'POST' })

    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    const who = clientOf(req)
    if (!TOKEN_RE.test(token)) {
      const wait = refused.take(who)
      if (wait) return rpcError(res, 429, 'too many refused requests, try again later', { 'Retry-After': String(wait) })
      return unauthorized(res, token ? 'that is not an openGym API token (ogt_…); a paired session is not taken here' : 'an openGym API token is needed (Authorization: Bearer ogt_…)')
    }

    let body
    try { body = await readJson(req) } catch (e) { return rpcError(res, e.status || 400, e.message) }

    const { key, remote } = profileFor(token)
    let me
    try { me = await remote.me({ fresh: true }) }
    catch (e) {
      cache.delete(key)
      if (e.code === 'EAUTH') {
        const wait = refused.take(who)
        if (wait) return rpcError(res, 429, 'too many refused requests, try again later', { 'Retry-After': String(wait) })
        return unauthorized(res, 'openGym did not accept this token: revoked, expired, or the profile signed out everywhere')
      }
      if (e.code === 'ERATE') return rpcError(res, 429, e.message, { 'Retry-After': '60' })
      return rpcError(res, 502, 'openGym could not be reached from the MCP server')
    }

    const server = buildServer({
      scopes: me.scopes || {},
      around: async fn => {
        await remote.refresh()
        return withProfile(remote.snapshot(), fn)
      },
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}) })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (e) {
      console.error('[opengym-mcp] request failed:', e?.message || e)
      if (!res.headersSent) rpcError(res, 500, 'internal error')
    }
  }
}

// Started as a program (the container's command), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +(process.env.MCP_PORT || 3100)
  const handle = createMcpHandler()
  const srv = http.createServer((req, res) => { handle(req, res).catch(e => { console.error(e); if (!res.headersSent) { res.writeHead(500); res.end() } }) })
  srv.requestTimeout = 120000
  srv.headersTimeout = 30000
  srv.listen(port, () => console.error(`[opengym-mcp] http on :${srv.address().port}${process.env.MCP_PATH || '/mcp'} -> ${process.env.OPENGYM_API_URL || 'http://api:3000'}`))
}
