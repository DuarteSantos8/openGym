#!/usr/bin/env node
/* openGym MCP server — HTTP (SSE) transport. Serves multiple profiles behind one process.
   Clients connect to GET /sse, then POST JSON-RPC messages to POST /message.

   Environment:
     OPENGYM_DATA    — path to the data directory (same as stdio mode).
     OPENGYM_UID     — default profile to serve when no ?uid= query param is provided.
     OPENGYM_HTTP_PORT — port to listen on (default 3100).
     OPENGYM_API_KEY — if set, requires an "Authorization: Bearer <key>" header on every
                       request. Acts as a simple access guard; not a substitute for TLS. */
import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { TOOLS } from './tools.js'
import { setActiveUser } from './state.js'

const PORT = Number(process.env.OPENGYM_HTTP_PORT) || 3100
const API_KEY = process.env.OPENGYM_API_KEY || null
const DEFAULT_UID = (process.env.OPENGYM_UID || '').trim()

// Track the active SSE connection so POST /message can route to it.
// Only one client at a time — sufficient for the common single-user self-host case.
let activeTransport = null
let activeServer = null

// --- HTTP handlers ---

async function handleSse(req, res) {
  // Parse query string for uid
  const url = new URL(req.url, `http://${req.headers.host}`)
  const uid = url.searchParams.get('uid') || DEFAULT_UID

  if (!uid) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('OPENGYM_UID env or ?uid= query param required')
    return
  }

  // Switch state for this user
  try {
    setActiveUser(uid)
    console.error(`[opengym-mcp] serving profile ${uid}`)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(e.message)
    return
  }

  // Close previous connection if any (SDK does not support multiple transports per server)
  if (activeServer) {
    await activeServer.close()
    activeServer = null
    activeTransport = null
  }

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

  const transport = new SSEServerTransport('/message', res)
  activeTransport = transport
  activeServer = server
  await server.connect(transport)

  res.on('close', () => {
    if (activeTransport === transport) activeTransport = null
    if (activeServer === server) activeServer = null
  })
}

async function handleMessage(req, res) {
  if (!activeTransport) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('no active SSE connection — connect to /sse first')
    return
  }

  await activeTransport.handlePostMessage(req, res)
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

// --- Server ---

const httpServer = http.createServer((req, res) => {
  if (!checkApiKey(req, res)) return

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/sse') {
    return handleSse(req, res)
  }

  if (req.method === 'POST' && url.pathname === '/message') {
    return handleMessage(req, res)
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})

httpServer.listen(PORT, () => {
  console.error(`[opengym-mcp] listening on port ${PORT}`)
})
