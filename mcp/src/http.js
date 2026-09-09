#!/usr/bin/env node
/* Streamable HTTP MCP transport. It has no data-directory mount: every request is scoped by a
   bearer grant and reads/writes only through the openGym API. */
import http from 'node:http'
import crypto from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { TOOLS } from './tools.js'

const API_BASE = String(process.env.OPENGYM_API || 'http://api:3000').replace(/\/+$/, '')
const PORT = Number(process.env.MCP_PORT || 8787)
const PUBLIC_URL = process.env.MCP_PUBLIC_URL || 'https://gym.derrickserna.com/mcp'
const ISSUER = String(process.env.MCP_ISSUER || (() => { try { return new URL(PUBLIC_URL).origin } catch { return 'https://gym.derrickserna.com' } })()).replace(/\/+$/, '')
const RESOURCE_METADATA = `${ISSUER}/.well-known/oauth-protected-resource`
const AUTHORIZATION_METADATA = `${ISSUER}/.well-known/oauth-authorization-server`
const sessions = new Map()
const SESSION_TTL_MS = 30 * 60 * 1000
const MAX_SESSIONS = 100
const oauthPending = new Map()
const oauthCodes = new Map()
const OAUTH_TTL_MS = 5 * 60 * 1000
const OAUTH_MAX_ENTRIES = 1000
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
const OAUTH_SCOPES = [...new Set([...Object.values(scopes), 'routine:propose'])]

function jsonResponse(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function htmlResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'"
  })
  res.end(body)
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

function formScope(value) {
  const raw = Array.isArray(value) ? value : [value]
  return [...new Set(raw.flatMap(v => String(v || '').trim().split(/\s+/).filter(Boolean)))]
}

function base64urlDigest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url')
}

function pruneOAuth() {
  const cutoff = Date.now()
  for (const [key, item] of oauthPending) if (item.expiresAt <= cutoff) oauthPending.delete(key)
  for (const [key, item] of oauthCodes) if (item.expiresAt <= cutoff || item.used) oauthCodes.delete(key)
  while (oauthPending.size > OAUTH_MAX_ENTRIES) oauthPending.delete(oauthPending.keys().next().value)
  while (oauthCodes.size > OAUTH_MAX_ENTRIES) oauthCodes.delete(oauthCodes.keys().next().value)
}
setInterval(pruneOAuth, 60 * 1000).unref()

async function apiPublic(pathname, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) }
  const response = await fetch(API_BASE + pathname, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `API HTTP ${response.status}`)
    error.status = response.status; error.data = data
    throw error
  }
  return data
}

async function apiCookie(pathname, cookie, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) }
  if (cookie) headers.Cookie = cookie
  return apiPublic(pathname, { ...options, headers })
}

async function oauthClient(clientId) {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(String(clientId || ''))) return null
  try { return await apiPublic(`/api/oauth/clients/${encodeURIComponent(clientId)}`) }
  catch (error) { if (error.status === 404) return null; throw error }
}

function oauthMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: OAUTH_SCOPES
  }
}

async function authorizationRequest(url) {
  const p = url.searchParams
  const responseType = p.get('response_type')
  const clientId = p.get('client_id')
  const redirectUri = p.get('redirect_uri')
  const challenge = p.get('code_challenge')
  const method = p.get('code_challenge_method')
  const resource = p.get('resource') || PUBLIC_URL
  const state = p.get('state') || ''
  if (responseType !== 'code' || !clientId || !redirectUri || !challenge || method !== 'S256') {
    const error = new Error('invalid authorization request'); error.status = 400; throw error
  }
  if (resource !== PUBLIC_URL) {
    const error = new Error('resource does not match this MCP service'); error.status = 400; throw error
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    const error = new Error('invalid code challenge'); error.status = 400; throw error
  }
  const client = await oauthClient(clientId)
  if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) {
    const error = new Error('unknown client or redirect_uri'); error.status = 400; throw error
  }
  const requested = formScope(p.get('scope') || client.scope)
  if (!requested.length || requested.some(scope => !OAUTH_SCOPES.includes(scope))) {
    const error = new Error('invalid scope'); error.status = 400; throw error
  }
  return { client, clientId, redirectUri, challenge, method, resource, state, requested }
}

async function readFormBody(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw Object.assign(new Error('request too large'), { status: 413 })
    chunks.push(chunk)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
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
  const data = await apiJson('/api/mcp/introspect', token)
  if (data.grant?.audience && data.grant.audience !== PUBLIC_URL) {
    const error = new Error('token audience does not match this MCP resource')
    error.status = 401
    throw error
  }
  return data
}

function bearer(req) {
  const value = String(req.headers.authorization || '')
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

function unauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${RESOURCE_METADATA}"`
  })
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
        const requestId = request_id || crypto.randomUUID()
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

async function handleOAuthRegister(req, res) {
  let body
  try { body = await readJsonBody(req) }
  catch (error) { return jsonResponse(res, error.status || 400, { error: 'invalid_client_metadata' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse(res, 400, { error: 'invalid_client_metadata' })
  try {
    const result = await apiPublic('/api/oauth/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    return jsonResponse(res, 201, result)
  } catch (error) {
    return jsonResponse(res, error.status || 502, { error: error.message || 'registration_failed' })
  }
}

function authorizeForm(data, csrf, user) {
  const scopeInputs = data.requested.map(scope => `
      <label><input type="checkbox" name="scope" value="${htmlEscape(scope)}" checked> ${htmlEscape(scope)}</label>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>openGym access</title></head><body>
    <main><h1>Allow ${htmlEscape(data.client.client_name || 'MCP client')} to access openGym?</h1>
    <p>Signed in as ${htmlEscape(user?.name || user?.id || 'openGym user')}.</p>
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="csrf" value="${htmlEscape(csrf)}">
      <input type="hidden" name="client_id" value="${htmlEscape(data.clientId)}">
      <input type="hidden" name="redirect_uri" value="${htmlEscape(data.redirectUri)}">
      <input type="hidden" name="response_type" value="code">
      <input type="hidden" name="code_challenge" value="${htmlEscape(data.challenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <input type="hidden" name="resource" value="${htmlEscape(data.resource)}">
      <input type="hidden" name="state" value="${htmlEscape(data.state)}">
      <fieldset><legend>Requested permissions</legend>${scopeInputs}</fieldset>
      <button type="submit">Allow</button>
    </form></main></body></html>`
}

async function handleOAuthAuthorizeGet(req, res, url) {
  let data
  try { data = await authorizationRequest(url) }
  catch (error) { return jsonResponse(res, error.status || 400, { error: error.message || 'invalid_request' }) }
  const cookie = String(req.headers.cookie || '')
  if (!cookie) return htmlResponse(res, 401, '<!doctype html><p>Sign in to openGym, then retry this authorization request.</p>')
  let me
  try { me = await apiCookie('/api/me', cookie) }
  catch { return htmlResponse(res, 401, '<!doctype html><p>Sign in to openGym, then retry this authorization request.</p>') }
  pruneOAuth()
  const csrf = crypto.randomBytes(24).toString('base64url')
  oauthPending.set(csrf, { ...data, uid: me.user?.id || null, expiresAt: Date.now() + OAUTH_TTL_MS })
  return htmlResponse(res, 200, authorizeForm(data, csrf, me.user))
}

function authFormUrl(form) {
  const out = new URL(`${ISSUER}/oauth/authorize`)
  for (const key of ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'state']) {
    const value = form.get(key)
    if (value != null && value !== '') out.searchParams.set(key, value)
  }
  const scope = formScope(form.getAll('scope'))
  if (scope.length) out.searchParams.set('scope', scope.join(' '))
  return out
}

async function handleOAuthAuthorizePost(req, res) {
  let form
  try { form = await readFormBody(req) }
  catch (error) { return jsonResponse(res, error.status || 400, { error: 'invalid_request' }) }
  const csrf = String(form.get('csrf') || '')
  const pending = oauthPending.get(csrf)
  if (!pending || pending.expiresAt <= Date.now()) return jsonResponse(res, 400, { error: 'authorization request expired' })
  let data
  try { data = await authorizationRequest(authFormUrl(form)) }
  catch (error) { return jsonResponse(res, error.status || 400, { error: error.message || 'invalid_request' }) }
  if (data.clientId !== pending.clientId || data.redirectUri !== pending.redirectUri || data.challenge !== pending.challenge || data.resource !== pending.resource || data.state !== pending.state) {
    return jsonResponse(res, 400, { error: 'authorization request changed' })
  }
  const selected = formScope(form.getAll('scope'))
  if (!selected.length || selected.some(scope => !pending.requested.includes(scope))) return jsonResponse(res, 400, { error: 'invalid_scope' })
  const cookie = String(req.headers.cookie || '')
  if (!cookie) return jsonResponse(res, 401, { error: 'not signed in' })
  let me
  try { me = await apiCookie('/api/me', cookie) }
  catch { return jsonResponse(res, 401, { error: 'not signed in' }) }
  if (pending.uid && pending.uid !== me.user?.id) return jsonResponse(res, 403, { error: 'session changed' })
  let grant
  try {
    const requestedTtl = Number(process.env.OAUTH_GRANT_TTL_SECONDS || 2592000)
    const expiresIn = Number.isFinite(requestedTtl) ? Math.max(1, Math.min(365 * 86400, Math.floor(requestedTtl))) : 2592000
    grant = await apiCookie('/api/mcp/grants', cookie, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `OAuth: ${data.client.client_name}`, scopes: selected, audience: PUBLIC_URL, expires_in: expiresIn })
    })
  } catch (error) {
    return jsonResponse(res, error.status || 502, { error: error.message || 'grant_failed' })
  }
  pruneOAuth()
  const code = crypto.randomBytes(32).toString('base64url')
  oauthCodes.set(code, {
    clientId: data.clientId, redirectUri: data.redirectUri, challenge: data.challenge,
    method: data.method, resource: data.resource, scope: selected, token: grant.token, grantExpiresAt: grant.grant?.expires || null,
    expiresAt: Date.now() + OAUTH_TTL_MS, used: false
  })
  oauthPending.delete(csrf)
  const redirect = new URL(data.redirectUri)
  redirect.searchParams.set('code', code)
  if (data.state) redirect.searchParams.set('state', data.state)
  res.writeHead(302, { Location: redirect.toString(), 'Cache-Control': 'no-store' })
  return res.end()
}

async function handleOAuthToken(req, res) {
  let form
  try { form = await readFormBody(req) }
  catch (error) { return jsonResponse(res, error.status || 400, { error: 'invalid_request' }) }
  if (form.get('grant_type') !== 'authorization_code') return jsonResponse(res, 400, { error: 'unsupported_grant_type' })
  const code = String(form.get('code') || '')
  const clientId = String(form.get('client_id') || '')
  const redirectUri = String(form.get('redirect_uri') || '')
  const resource = String(form.get('resource') || PUBLIC_URL)
  const verifier = String(form.get('code_verifier') || '')
  const client = await oauthClient(clientId).catch(() => null)
  const record = oauthCodes.get(code)
  const invalid = () => jsonResponse(res, 400, { error: 'invalid_grant' })
  if (!client || !record || record.used || record.expiresAt <= Date.now() || record.clientId !== clientId || record.redirectUri !== redirectUri || resource !== record.resource) return invalid()
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || base64urlDigest(verifier) !== record.challenge) return invalid()
  record.used = true
  oauthCodes.delete(code)
  const expiresIn = record.grantExpiresAt ? Math.max(0, Math.ceil((record.grantExpiresAt - Date.now()) / 1000)) : 0
  return jsonResponse(res, 200, {
    access_token: record.token, token_type: 'Bearer', expires_in: expiresIn,
    scope: record.scope.join(' '), resource: record.resource
  })
}

async function handle(req, res) {
  cors(res)
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (url.pathname === '/oauth/register' && req.method === 'POST') return handleOAuthRegister(req, res)
  if (url.pathname === '/oauth/authorize' && req.method === 'GET') return handleOAuthAuthorizeGet(req, res, url)
  if (url.pathname === '/oauth/authorize' && req.method === 'POST') return handleOAuthAuthorizePost(req, res)
  if (url.pathname === '/oauth/token' && req.method === 'POST') return handleOAuthToken(req, res)
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
    return jsonResponse(res, 200, {
      resource: PUBLIC_URL, authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'], scopes_supported: OAUTH_SCOPES
    })
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return jsonResponse(res, 200, oauthMetadata())
  }
  if (url.pathname === '/mcp/.well-known/oauth-protected-resource') {
    return jsonResponse(res, 200, {
      resource: PUBLIC_URL, authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'], scopes_supported: OAUTH_SCOPES
    })
  }
  if (url.pathname === '/mcp/.well-known/oauth-authorization-server') return jsonResponse(res, 200, oauthMetadata())
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
        sessionIdGenerator: () => crypto.randomUUID(),
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
    if (res.headersSent) return
    if (error.status === 401) return unauthorized(res)
    jsonResponse(res, error.status || 500, { error: error.message })
  }
}

http.createServer((req, res) => { handle(req, res).catch(error => { if (!res.headersSent) { res.writeHead(500); res.end(error.message) } }) }).listen(PORT, () => console.error(`[opengym-mcp] Streamable HTTP on :${PORT}`))
