#!/usr/bin/env node
/* openGym MCP server — Streamable HTTP transport, for the opt-in `mcp` container in
   docker-compose.yml. It reads the same ./data the api writes (mounted read-only), and the web
   container proxies /mcp to it, so the endpoint is https://<your openGym host>/mcp: whatever
   already puts the app on the internet (a Cloudflare tunnel, a reverse proxy) carries it too.

   Every request needs an OAuth access token. The api is the authorization server (api/oauth.js):
   the client signs the person in through the app — passkey or password — and the token it gets
   stands for that one profile. This side only looks the token up in db.json, so each request
   answers for whoever it belongs to, and several people can connect to one instance. */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer } from './server.js'
import { asUser, getDb, dataDir } from './state.js'

// Must match api/oauth.js tokenHash — test/http.test.js issues a token there and checks it here.
const tokenHash = t => crypto.createHash('sha256').update('opengym-oauth:' + t).digest('hex')

// The profile an access token stands for, or null. The same checks the api makes on a refresh:
// the grant's access token is unexpired, and its profile still exists, is not disabled and has
// not signed out everywhere since.
export function uidForToken(token, now = Date.now()) {
  if (!token) return null
  const db = getDb()
  const h = tokenHash(token)
  const g = (db.oauthGrants || []).find(x => x.ah === h && x.aexp > now)
  const u = g && (db.users || []).find(x => x.id === g.uid)
  return u && !u.disabled && (u.sv || 0) === g.sv ? u.id : null
}

// `origin` is the app's public address (ORIGIN): the 401 points the client at the discovery
// document there, which is how it finds the sign-in (RFC 9728).
export function createHandler({ origin = '' } = {}) {
  const challenge = 'Bearer' + (origin ? ` resource_metadata="${origin.replace(/\/+$/, '')}/.well-known/oauth-protected-resource"` : '')
  return async (req, res) => {
    if (!/^\/mcp\/?$/.test(new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404).end(); return }
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')
    const uid = uidForToken(bearer && bearer[1])
    if (!uid) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge })
        .end(JSON.stringify({ error: 'invalid_token' }))
      return
    }
    // Stateless: a fresh server and transport per request, nothing kept between them. Every tool
    // is a read of the state file, so there is no session worth keeping, and a restart or a
    // second replica never strands a client. JSON responses rather than SSE streams, which every
    // proxy and tunnel passes through without buffering surprises.
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    try {
      await asUser(uid, async () => {
        await server.connect(transport)
        await transport.handleRequest(req, res)
      })
    } catch (e) {
      console.error(`[opengym-mcp] ${e.message}`)
      if (!res.headersSent) res.writeHead(500).end()
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(dataDir())) {
    console.error(`[opengym-mcp] OPENGYM_DATA dir does not exist: ${dataDir()}`)
    process.exit(1)
  }
  const origin = process.env.ORIGIN || ''
  if (!origin) console.error('[opengym-mcp] ORIGIN is not set — clients will not be told where to sign in')
  const port = Number(process.env.MCP_PORT) || 3001
  http.createServer(createHandler({ origin })).listen(port, () => {
    console.error(`[opengym-mcp] listening on :${port}/mcp, signing in through ${origin || '(unknown)'}`)
  })
}
