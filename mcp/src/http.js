#!/usr/bin/env node
/* openGym MCP server — Streamable HTTP transport (the current MCP HTTP spec; replaces the
   deprecated HTTP+SSE transport this file previously spoke). One process serves many
   concurrent sessions, each pinned to one profile.

   Endpoint:  POST   /mcp   — JSON-RPC; session id lives in the Mcp-Session-Id response/request
                              header (the SDK manages it).
              DELETE /mcp   — terminate the session (Mcp-Session-Id header required).
              GET    /mcp   — 405: the server never initiates messages, so the optional
                              standalone SSE stream would carry nothing.
              GET|HEAD /health — unauthenticated liveness probe for container healthchecks.

   Environment:
     OPENGYM_DATA      — path to the data directory (same as stdio mode).
     OPENGYM_UID       — default profile when no ?uid= query param is given.
     OPENGYM_HTTP_PORT — port to listen on (default 3100).
     OPENGYM_API_KEY   — if set, requires an "Authorization: Bearer <key>" header on /mcp.
                         Acts as a simple access guard; not a substitute for TLS. */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { TOOLS } from './tools.js'
import { setActiveUser, resolveUid, activeUid } from './state.js'

const PORT = Number(process.env.OPENGYM_HTTP_PORT) || 3100
const API_KEY = process.env.OPENGYM_API_KEY || null
const DEFAULT_UID = (process.env.OPENGYM_UID || '').trim()

// sessionId -> { transport, server }. The SDK mints the id on the initialize request and
// reports it through onsessioninitialized; it is removed again on DELETE (onsessionclosed)
// or whenever the transport closes (onclose).
const sessions = new Map()

// One McpServer per session, with that session's tools bound to its uid. state.js keys the
// data directory off a single process-wide active uid, so every tool call re-selects this
// session's profile first: the swap and the (synchronous) handler run in one tick with no
// await between them, so a concurrent session's request cannot interleave in between.
function createServer(uid) {
  const server = new McpServer({
    name: 'opengym',
    version: '0.1.0'
  })

  for (const t of TOOLS) {
    server.tool(
      t.name,
      t.description,
      t.schema,
      async (params) => {
        try {
          if (activeUid() !== uid) setActiveUser(uid)
          const result = t.handler(params || {})
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (err) {
          const code = err.code || 'ERROR'
          return {
            isError: true,
            content: [{ type: 'text', text: `${code}: ${err.message}` }]
          }
        }
      }
    )
  }
  return server
}

// First request of a session — must be an initialize POST without an Mcp-Session-Id header.
// The uid comes from ?uid=, then OPENGYM_UID, then the same auto-detection stdio uses
// (single state file / single db.json user), so a single-user instance needs no query param.
async function handleNewSession(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)

  let uid = url.searchParams.get('uid') || DEFAULT_UID
  if (!uid) {
    try {
      uid = resolveUid()
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end(e.message)
      return
    }
  }

  const server = createServer(uid)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { transport, server, uid })
      console.error(`[opengym-mcp] session ${sessionId} open — serving profile ${uid}`)
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId)
      console.error(`[opengym-mcp] session ${sessionId} closed`)
    }
  })
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId)
  }

  try {
    setActiveUser(uid)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(e.message)
    return
  }

  await server.connect(transport)
  await transport.handleRequest(req, res)

  // A rejected initialize (bad Accept header, malformed body, …) never mints a session —
  // drop the connected transport/server so a failed handshake doesn't leak one per retry.
  if (transport.sessionId === undefined) {
    await server.close().catch(() => {})
  }
}

function checkApiKey(req, res) {
  if (!API_KEY) return true
  const auth = req.headers.authorization || ''
  if (auth !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { 'Content-Type': 'text/plain' })
    res.end('unauthorized')
    return false
  }
  return true
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end()
    return
  }

  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  if (!checkApiKey(req, res)) return

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'POST, DELETE' })
    res.end('method not allowed — this server speaks Streamable HTTP: POST /mcp')
    return
  }

  const sessionId = req.headers['mcp-session-id']

  if (sessionId) {
    const session = sessions.get(sessionId)
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('unknown session')
      return
    }
    await session.transport.handleRequest(req, res)
    return
  }

  if (req.method === 'DELETE') {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Mcp-Session-Id header required')
    return
  }

  await handleNewSession(req, res)
}

// --- Server ---

const httpServer = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error('[opengym-mcp] request failed:', err)
    if (res.headersSent) res.end()
    else {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('internal error')
    }
  })
})

httpServer.listen(PORT, () => {
  console.error(`[opengym-mcp] listening on port ${PORT} — Streamable HTTP on POST /mcp`)
})
