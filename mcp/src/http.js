#!/usr/bin/env node
/* Streamable HTTP MCP transport. It has no data-directory mount: every request is scoped by a
   bearer grant and reads/writes only through the openGym API. */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { TOOLS } from './tools.js'

const API_BASE = String(process.env.OPENGYM_API || 'http://api:3000').replace(/\/+$/, '')
const PORT = Number(process.env.MCP_PORT || 8787)
const PUBLIC_URL = process.env.MCP_PUBLIC_URL || 'https://gym.derrickserna.com/mcp'
const sessions = new Map()
const SESSION_TTL_MS = 30 * 60 * 1000
const MAX_SESSIONS = 100
function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, session] of sessions) if (session.lastSeen < cutoff) sessions.delete(id)
}
setInterval(pruneSessions, 5 * 60 * 1000).unref()
const scopes = {
  list_exercises: 'exercise:read', search_exercises: 'exercise:read', get_exercise: 'exercise:read',
  list_routines: 'routine:read', get_routine: 'routine:read', get_week_plan: 'routine:read',
  list_workouts: 'workout:read', get_workout: 'workout:read', get_bodyweight: 'bodyweight:read',
  estimate_1rm: 'progress:read', muscle_balance: 'progress:read'
}

async function apiJson(path, token, options = {}) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  const response = await fetch(API_BASE + path, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `API HTTP ${response.status}`)
    error.status = response.status; error.data = data
    throw error
  }
  return data
}

async function introspect(token) {
  return apiJson('/api/mcp/introspect', token)
}

function bearer(req) {
  const value = String(req.headers.authorization || '')
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

function unauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' })
  res.end(JSON.stringify({ error: 'invalid_token' }))
}

function makeServer(token) {
  const server = new McpServer({ name: 'opengym-remote', version: '1.0.0' })
  for (const tool of TOOLS) {
    const scope = scopes[tool.name]
    server.tool(tool.name, tool.description, tool.schema, async params => {
      try {
        const snapshot = await apiJson(`/api/mcp/state?scope=${encodeURIComponent(scope)}`, token)
        const result = tool.handler(params || {}, { state: snapshot.state, user: snapshot.user })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }] }
      }
    })
  }
  server.tool(
    'propose_routine',
    'Save a validated routine draft for review inside openGym. Approval is intentionally performed in the app, never by the model.',
    {
      routine: z.object({ name: z.string().min(1), emoji: z.string().nullable().optional(), ex: z.array(z.record(z.any())).min(1) }),
      request_id: z.string().min(1).max(200).optional()
    },
    async ({ routine, request_id }) => {
      try {
        const snapshot = await apiJson('/api/mcp/state?scope=routine:propose', token)
        const requestId = request_id || randomUUID()
        const result = await apiJson('/api/mcp/proposals', token, {
          method: 'POST', headers: {
            'Content-Type': 'application/json', 'If-Match': snapshot.revision,
            'Idempotency-Key': requestId
          }, body: JSON.stringify({ routine, request_id: requestId })
        })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }] }
      }
    }
  )
  server.tool(
    'get_routine_proposal',
    'Inspect a pending or approved routine proposal. The model cannot approve it.',
    { proposal_id: z.string().min(1) },
    async ({ proposal_id }) => {
      try {
        const result = await apiJson(`/api/mcp/proposals/${encodeURIComponent(proposal_id)}`, token)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }] }
      }
    }
  )
  return server
}

async function readJsonBody(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('request too large'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MCP_CORS_ORIGIN || 'https://gym.derrickserna.com')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate')
  res.setHeader('Vary', 'Origin')
}

async function handle(req, res) {
  cors(res)
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (url.pathname === '/.well-known/oauth-protected-resource') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    // Grants are minted and revoked in the signed-in openGym UI. This service is not an
    // OAuth authorization server, so do not advertise a made-up authorize/token endpoint.
    return res.end(JSON.stringify({ resource: PUBLIC_URL, bearer_methods_supported: ['header'], scopes_supported: [...new Set(Object.values(scopes)), 'routine:propose'] }))
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify({ error: 'oauth authorization server not configured; use a scoped openGym grant' }))
  }
  if (url.pathname !== '/mcp') { res.writeHead(404); return res.end('not found') }
  const token = bearer(req)
  if (!token) return unauthorized(res)
  const sessionId = req.headers['mcp-session-id']
  pruneSessions()
  let current = sessionId ? sessions.get(String(sessionId)) : null
  if (current && current.lastSeen < Date.now() - SESSION_TTL_MS) { sessions.delete(String(sessionId)); current = null }
  try {
    const auth = await introspect(token)
    if (current && current.token !== token) return unauthorized(res)
    if (current) current.lastSeen = Date.now()
    if (!current) {
      if (req.method !== 'POST') { res.writeHead(400); return res.end('missing session') }
      if (sessions.size >= MAX_SESSIONS) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'too many MCP sessions' })) }
      const body = await readJsonBody(req)
      if (body.method !== 'initialize') { res.writeHead(400); return res.end('initialize required') }
      let transport
      const server = makeServer(token)
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: id => sessions.set(id, { token, transport, uid: auth.user.id, lastSeen: Date.now() })
      })
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId) }
      await server.connect(transport)
      return transport.handleRequest(req, res, body)
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      return current.transport.handleRequest(req, res, body)
    }
    return current.transport.handleRequest(req, res)
  } catch (error) {
    if (!res.headersSent) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })) }
  }
}

http.createServer((req, res) => { handle(req, res).catch(error => { if (!res.headersSent) { res.writeHead(500); res.end(error.message) } }) }).listen(PORT, () => console.error(`[opengym-mcp] Streamable HTTP on :${PORT}`))
