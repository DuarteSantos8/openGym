#!/usr/bin/env node
/* Streamable HTTP MCP transport. It has no data-directory mount: every request is scoped by a
   bearer grant and reads/writes only through the openGym API. */
import http from 'node:http'
import crypto from 'node:crypto'
import net from 'node:net'
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
// A browser or connector may retry a successful form POST when the redirect response is lost.
// Keep only the exact, same-session result for the short OAuth lifetime; the pending nonce is
// still consumed synchronously so concurrent requests cannot mint two grants.
const oauthReplay = new Map()
const OAUTH_TTL_MS = 5 * 60 * 1000
const OAUTH_MAX_ENTRIES = 1000
function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, session] of sessions) if (session.lastSeen < cutoff) sessions.delete(id)
}
setInterval(pruneSessions, 5 * 60 * 1000).unref()
const scopes = {
  list_exercises: 'exercise:read', search_exercises: 'exercise:read', get_exercise: 'exercise:read',
  list_routines: 'routine:read', get_routine: 'routine:read', preview_session: 'routine:read', get_week_plan: 'routine:read',
  list_workouts: 'workout:read', get_workout: 'workout:read', get_bodyweight: 'bodyweight:read',
  estimate_1rm: 'progress:read', muscle_balance: 'progress:read', create_workout: 'workout:write'
}
const OAUTH_SCOPES = [...new Set([...Object.values(scopes), 'routine:propose'])]

function jsonResponse(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function htmlResponse(res, status, body, { formActionOrigin = '' } = {}) {
  const formAction = formActionOrigin ? `'self' ${formActionOrigin}` : "'self'"
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; form-action ${formAction}; style-src 'unsafe-inline'`
  })
  res.end(body)
}

const RELAY_CSP = "default-src 'none'; form-action 'self'; base-uri 'none'; style-src 'unsafe-inline'"

function oauthRelayResponse(res, location) {
  const escapedLocation = htmlEscape(location)
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=${escapedLocation}"><title>Returning to the requesting client</title><style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202124; background: #f7f7f5; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: #f7f7f5; } .oauth-card { width: min(100%, 520px); padding: clamp(24px, 6vw, 42px); border: 1px solid #deded8; border-radius: 16px; background: #fff; box-shadow: 0 14px 40px rgba(32, 33, 36, .10); } h1 { margin: 0 0 14px; font-size: 1.7rem; overflow-wrap: anywhere; } p { line-height: 1.5; color: #4b4f52; } a { display: inline-flex; align-items: center; min-height: 44px; margin-top: 10px; padding: 10px 16px; border-radius: 9px; background: #164e63; color: #fff; font-weight: 750; text-decoration: none; } a:focus-visible { outline: 3px solid #164e63; outline-offset: 2px; }
  </style></head><body><main class="oauth-card" role="status"><h1>Authorization complete</h1><p>Continue to the requesting client.</p><a href="${escapedLocation}">Continue to the requesting client</a></main></body></html>`
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': RELAY_CSP, 'Referrer-Policy': 'no-referrer'
  })
  res.end(body)
}

function oauthLoginRedirect(res, url) {
  // Keep the exact authorize path/query on this origin while the browser establishes its
  // openGym session. Login must validate the continuation again before navigating, and this
  // fixed root target means a caller cannot turn the gateway response into an open redirect.
  const target = url.pathname + url.search
  const location = '/?oauth_return=' + encodeURIComponent(target)
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' })
  return res.end()
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
  for (const [key, item] of oauthReplay) if (item.expiresAt <= cutoff) oauthReplay.delete(key)
  while (oauthPending.size > OAUTH_MAX_ENTRIES) oauthPending.delete(oauthPending.keys().next().value)
  while (oauthCodes.size > OAUTH_MAX_ENTRIES) oauthCodes.delete(oauthCodes.keys().next().value)
  while (oauthReplay.size > OAUTH_MAX_ENTRIES) oauthReplay.delete(oauthReplay.keys().next().value)
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

// The web proxy overwrites forwarding headers with the peer it observed. Normalize
// again at this boundary so the API limiter never receives an unbounded raw value.
// Direct local MCP callers fall back to the socket peer; production is exposed via
// nginx, which owns the trust boundary for these headers.
function normalizedClientIp(raw) {
  const value = String(raw || '').trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '')
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const octets = value.split('.').map(Number)
    return octets.every(n => n >= 0 && n <= 255) ? octets.join('.') : null
  }
  return /^[0-9a-f:]{2,45}$/i.test(value) ? value.toLowerCase() : null
}

function requestClientIp(req) {
  const raw = String(req.headers['x-opengym-client-ip'] || '').trim()
    || String(req.headers['cf-connecting-ip'] || '').trim()
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '').trim()
    || String(req.socket?.remoteAddress || '').trim()
  return normalizedClientIp(raw) || 'unknown'
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
  const callback = callbackInfo(redirectUri)
  if (!client || (client.client_expires_at && client.client_expires_at <= Math.floor(Date.now() / 1000)) || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri) || !callback) {
    const error = new Error('unknown client or redirect_uri'); error.status = 400; throw error
  }
  const requested = formScope(p.get('scope') || client.scope)
  const registered = formScope(client.scope)
  if (!registered.length || !requested.length || requested.some(scope => !OAUTH_SCOPES.includes(scope) || !registered.includes(scope))) {
    const error = new Error('invalid scope'); error.status = 400; throw error
  }
  return { client, clientId, redirectUri, callback, challenge, method, resource, state, requested }
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

function makeServer(token, grantedScopes = []) {
  const server = new McpServer({ name: 'opengym-remote', version: '1.0.0' })
  for (const tool of TOOLS) {
    const scope = scopes[tool.name]
    server.tool(tool.name, tool.description, tool.schema, async params => {
      try {
        let snapshot
        let remoteState
        if (tool.name === 'preview_session') {
          // Preview uses the same inputs as the app's session builder, but each remains
          // independently scoped: routine plan, progression history/confirmed weights, and
          // bodyweight. A routine-only grant must not receive a plausible but incomplete preview.
          const [routine, progress, bodyweight] = await Promise.all([
            apiJson('/api/mcp/state?scope=routine:read', token),
            apiJson('/api/mcp/state?scope=progress:read', token),
            apiJson('/api/mcp/state?scope=bodyweight:read', token)
          ])
          snapshot = routine
          remoteState = routine.state
            ? { ...routine.state, ...(progress.state || {}), ...(bodyweight.state || {}) }
            : null
        } else {
          snapshot = await apiJson(`/api/mcp/state?scope=${encodeURIComponent(scope)}`, token)
          remoteState = snapshot.state
        }
        const result = tool.handler(params || {}, { state: remoteState, user: snapshot.user })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }] }
      }
    })
  }
  if (grantedScopes.includes('workout:write')) {
    const workoutSetSchema = z.object({
      done: z.literal(true).describe('Completed set; create_workout records finished sets only.'),
      w: z.number().finite().min(0).max(100000).optional().describe('Load in the profile unit.'),
      r: z.number().int().min(0).max(10000).optional().describe('Completed repetitions.'),
      sec: z.number().finite().min(0).max(86400).optional().describe('Completed hold seconds for time mode.'),
      min: z.number().finite().min(0).max(100000).optional().describe('Completed minutes for cardio mode.'),
      speed: z.number().finite().min(0).max(10000).optional().describe('Cardio speed.'),
      rir: z.number().finite().min(0).max(10).optional(),
      rpe: z.number().finite().min(0).max(10).optional(),
      phase: z.enum(['work', 'warmup', 'warm-up', 'warm_up']).optional().describe('Work or warmup; legacy warmup spellings normalize to warmup.'),
      warmup: z.boolean().optional().describe('Legacy warmup marker; normalized server-side.'),
      type: z.literal('straight').optional().describe('Only standard straight sets are accepted; drops/clusters/sides are rejected.')
    }).strict()
    const workoutTargetSchema = z.object({
      mode: z.enum(['reps', 'time', 'cardio']).optional(),
      sets: z.number().int().min(0).max(100000).optional(),
      reps: z.number().int().min(0).max(100000).optional(),
      repsMin: z.number().int().min(0).max(100000).optional(),
      repsMax: z.number().int().min(0).max(100000).optional(),
      sec: z.number().finite().min(0).max(100000).optional(),
      min: z.number().finite().min(0).max(100000).optional(),
      speed: z.number().finite().min(0).max(100000).optional(),
      weight: z.number().finite().min(0).max(100000).optional(),
      inc: z.number().finite().min(0).max(100000).optional(),
      bw: z.number().finite().min(0).max(100000).optional(),
      restSec: z.number().finite().min(0).max(100000).optional(),
      deloadFactor: z.number().finite().min(0).max(100000).optional(),
      sg: z.string().max(120).optional(),
      policy: z.string().max(120).optional(),
      prog: z.string().max(120).optional(),
      note: z.string().max(120).optional()
    }).strict()
    const workoutEntrySchema = z.object({
      id: z.string().min(1).max(120).describe('Known built-in or custom exercise ID.'),
      sets: z.array(workoutSetSchema).min(1).max(200),
      target: workoutTargetSchema.optional(),
      rid: z.string().min(1).max(120).optional().describe('Routine ID; must be present in workout.routineIds and the profile.'),
      noProg: z.boolean().optional().describe('Exclude this entry from PR/progression calculations.'),
      note: z.string().max(2000).optional(),
      notePin: z.boolean().optional(),
      topW: z.number().finite().min(0).max(100000).optional().describe('Legacy hint ignored; server derives topW from completed work sets.')
    }).strict()
    const completedWorkoutSchema = z.object({
      id: z.string().min(1).max(120).optional().describe('Stable workout ID; omitted IDs are generated.'),
      d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Workout date (YYYY-MM-DD).'),
      start: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      end: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      routineIds: z.array(z.string().min(1).max(120)).max(50).optional().describe('Profile routine IDs represented by entries.'),
      routineId: z.string().min(1).max(120).nullable().optional().describe('Optional primary routine ID; must be in routineIds.'),
      name: z.string().max(120).nullable().optional(),
      bw: z.number().finite().min(0).max(1000).nullable().optional().describe('Bodyweight at the session.'),
      note: z.string().max(2000).nullable().optional(),
      entries: z.array(workoutEntrySchema).min(1).max(200),
      backfill: z.boolean().optional().describe('Historical control only; not persisted, no PR/exWeights side effects, chronological insertion.'),
      prs: z.array(z.string()).optional().describe('Legacy hint ignored; PRs are derived by the API.'),
      vol: z.number().finite().min(0).optional().describe('Legacy hint ignored; volume is derived by the API.'),
      excludeFromProgression: z.boolean().optional().describe('Legacy hint ignored unless all entries carry noProg.')
    }).strict()
    server.tool(
      'create_workout',
      'Record exactly one completed workout in the signed-in openGym profile. Use only known built-in/custom exercise IDs, standard reps/time/cardio targets, straight completed sets, and routine IDs that match each entry rid. The API derives topW, volume, PRs and progression, requires If-Match, and fetches a fresh revision before writing. Reuse the same request_id/Idempotency-Key only for an exact retry; a changed payload is rejected. backfill is a control-only historical insert: it is not persisted, claims no PR, and leaves exWeights unchanged.',
      {
        workout: completedWorkoutSchema,
        request_id: z.string().min(1).max(200).describe('Stable retry key; reuse only with byte-identical workout payload.')
      },
      async ({ workout, request_id }) => {
        try {
          const snapshot = await apiJson('/api/mcp/state?scope=workout:write', token)
          const result = await apiJson('/api/mcp/workouts', token, {
            method: 'POST', headers: {
              'Content-Type': 'application/json', 'If-Match': snapshot.revision,
              'Idempotency-Key': request_id
            }, body: JSON.stringify({ workout, request_id })
          })
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }] }
        }
      }
    )
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenGym-Client-IP': requestClientIp(req)
      },
      body: JSON.stringify(body)
    })
    return jsonResponse(res, 201, result)
  } catch (error) {
    return jsonResponse(res, error.status || 502, { error: error.message || 'registration_failed' })
  }
}

const scopeCopy = {
  'exercise:read': ['View exercises', 'Browse the OpenGym exercise catalogue.'],
  'routine:read': ['View routines', 'See your saved routines and training plans.'],
  'workout:read': ['View workout history', 'Review completed workouts and session details.'],
  'bodyweight:read': ['View bodyweight', 'Read your bodyweight measurements.'],
  'progress:read': ['View progress', 'Read progress trends and training insights.'],
  'workout:write': ['Create workouts', 'Record completed workouts in your OpenGym account.'],
  'routine:propose': ['Propose routines for your review', 'Save routine drafts for you to review in OpenGym.']
}

function validCallbackHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  if (!host || host.includes('*') || host.includes('_')) return false
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (net.isIP(literal)) return true
  if (host.length > 253) return false
  return host.split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}

function callbackInfo(redirectUri) {
  try {
    const raw = String(redirectUri)
    const url = new URL(raw)
    const host = String(url.hostname || '').toLowerCase()
    const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
    const ipVersion = net.isIP(literal)
    const authority = url.href.slice(url.protocol.length + 2).split(/[\/?#]/, 1)[0]
    const rawAuthority = /^[a-z][a-z\d+.-]*:\/\/([^\/?#]*)/i.exec(raw)?.[1] || ''
    if (!['https:', 'http:'].includes(url.protocol) || authority.includes('@') || rawAuthority.includes('@') || url.username || url.password || raw.includes('#') || !validCallbackHost(host)) return null
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(host)) return null
    if (url.origin === 'null') return null
    const relay = ipVersion === 6 || (ipVersion === 4 && url.protocol === 'https:' && host !== '127.0.0.1')
    return { origin: relay ? '' : url.origin, relay }
  } catch { return null }
}

function callbackOrigin(redirectUri) {
  return callbackInfo(redirectUri)?.origin || ''
}

function authorizeForm(data, csrf, user) {
  const scopeInputs = data.requested.map(scope => {
    const [label, description] = scopeCopy[scope] || [scope, 'Access the requested OpenGym permission.']
    return `
        <label class="permission-row"><input type="checkbox" name="scope" value="${htmlEscape(scope)}" checked><span><strong>${htmlEscape(label)}</strong><small>${htmlEscape(description)}</small><code>${htmlEscape(scope)}</code></span></label>`
  }).join('')
  const clientName = data.client.client_name || 'MCP client'
  const accountName = user?.name || user?.id || 'openGym user'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect ${htmlEscape(clientName)} to openGym</title><style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202124; background: #f7f7f5; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: #f7f7f5; }
    .oauth-card { width: min(100%, 520px); border: 1px solid #deded8; border-radius: 16px; background: #fff; box-shadow: 0 14px 40px rgba(32, 33, 36, .10); padding: clamp(24px, 6vw, 42px); }
    .opengym-mark { display: inline-flex; align-items: center; gap: 8px; color: #164e63; font-weight: 800; letter-spacing: -.02em; font-size: 1.12rem; }
    .opengym-mark::before { content: "OG"; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #fff; background: #164e63; font-size: .72rem; letter-spacing: .04em; }
    .eyebrow { margin: 28px 0 8px; color: #5f6368; font-size: .9rem; font-weight: 650; }
    h1 { margin: 0; font-size: clamp(1.65rem, 5vw, 2.15rem); line-height: 1.12; letter-spacing: -.035em; overflow-wrap: anywhere; }
    .lead { margin: 18px 0 20px; color: #4b4f52; line-height: 1.5; }
    .notice { border-left: 4px solid #d97706; border-radius: 8px; background: #fff8eb; color: #603a05; padding: 12px 14px; line-height: 1.45; }
    .account { display: grid; gap: 4px; margin: 20px 0; padding: 14px 16px; border: 1px solid #e2e3e5; border-radius: 10px; background: #fafafa; }
    .account span { color: #5f6368; font-size: .82rem; }
    .account strong { overflow-wrap: anywhere; }
    fieldset { margin: 0; padding: 0; border: 0; }
    legend { margin-bottom: 10px; font-size: 1.05rem; font-weight: 750; }
    .permission-list { display: grid; gap: 8px; }
    .permission-row { display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: start; padding: 12px; border: 1px solid #e2e3e5; border-radius: 10px; cursor: pointer; }
    .permission-row:has(input:checked) { border-color: #9ab8c2; background: #f4fafb; }
    .permission-row input { width: 18px; height: 18px; margin: 3px 0; accent-color: #164e63; }
    .permission-row span { display: grid; gap: 3px; min-width: 0; }
    .permission-row small { color: #4b4f52; line-height: 1.35; }
    .permission-row code { color: #687078; font-size: .78rem; overflow-wrap: anywhere; }
    .destination { margin: 20px 0 0; color: #5f6368; font-size: .88rem; line-height: 1.45; }
    .destination code { display: block; margin-top: 4px; color: #30353a; overflow-wrap: anywhere; }
    .oauth-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; margin-top: 26px; }
    button { min-height: 44px; border: 1px solid #ccd0d3; border-radius: 9px; padding: 10px 16px; font: inherit; font-weight: 750; cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 3px solid #164e63; outline-offset: 2px; }
    .deny { background: #fff; color: #30353a; }
    .allow { border-color: #164e63; background: #164e63; color: #fff; }
    .fine-print { margin: 18px 0 0; color: #687078; font-size: .82rem; line-height: 1.45; }
    @media (max-width: 380px) { body { padding: 12px 8px; } .oauth-card { padding: 22px 16px; border-radius: 12px; } .oauth-actions { grid-template-columns: 1fr; } }
  </style></head><body><main class="oauth-card" aria-labelledby="oauth-title">
    <span class="opengym-mark" aria-label="openGym">openGym</span>
    <p class="eyebrow">Account connection</p>
    <h1 id="oauth-title">${htmlEscape(clientName)} wants to connect to your openGym account</h1>
    <p class="lead">Choose what this client can access. You can revoke access at any time from your openGym account.</p>
    <p class="notice"><strong>Unverified client.</strong> This name was supplied by the client and is not endorsed by openGym. Continue only if you trust it.</p>
    <div class="account"><span>Signed in as</span><strong>${htmlEscape(accountName)}</strong></div>
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="csrf" value="${htmlEscape(csrf)}">
      <input type="hidden" name="client_id" value="${htmlEscape(data.clientId)}">
      <input type="hidden" name="redirect_uri" value="${htmlEscape(data.redirectUri)}">
      <input type="hidden" name="response_type" value="code">
      <input type="hidden" name="code_challenge" value="${htmlEscape(data.challenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <input type="hidden" name="resource" value="${htmlEscape(data.resource)}">
      <input type="hidden" name="state" value="${htmlEscape(data.state)}">
      <fieldset><legend>Permissions requested</legend><div class="permission-list">${scopeInputs}</div></fieldset>
      <p class="destination">After allowing access, you will return to:<code>${htmlEscape(data.redirectUri)}</code></p>
      <div class="oauth-actions"><button class="deny" type="submit" name="decision" value="deny">Cancel</button><button class="allow" type="submit" name="decision" value="allow">Allow access</button></div>
    </form>
    <p class="fine-print">Access is limited to the permissions listed above. Authorization codes are short-lived and cannot be used without the requesting client’s PKCE verifier.</p>
  </main></body></html>`
}

const browserErrorCopy = {
  'authorization request expired': 'This authorization request has expired.',
  'authorization request changed': 'The authorization request changed before it was submitted.',
  'not signed in': 'Your OpenGym sign-in is no longer valid.',
  'session changed': 'Your OpenGym session changed while this request was open.',
  invalid_scope: 'The requested permissions are no longer valid.',
  invalid_request: 'This authorization request is not valid.'
}

function browserRequest(req) {
  return /\btext\/html\b/i.test(String(req.headers.accept || '')) || String(req.headers['sec-fetch-dest'] || '') === 'document'
}

function oauthPostError(req, res, status, error) {
  if (!browserRequest(req)) return jsonResponse(res, status, { error })
  const detail = browserErrorCopy[error] || 'This authorization request could not be completed.'
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenGym authorization</title><style>
    :root { color: #202124; background: #f7f7f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: #f7f7f5; } .oauth-card { width: min(100%, 520px); padding: clamp(24px, 6vw, 42px); border: 1px solid #deded8; border-radius: 16px; background: #fff; box-shadow: 0 14px 40px rgba(32, 33, 36, .10); } .oauth-error { border-top: 5px solid #b42318; } h1 { margin: 0 0 14px; font-size: 1.7rem; } p { line-height: 1.5; color: #4b4f52; } .back { margin-top: 20px; min-height: 44px; padding: 10px 16px; border: 0; border-radius: 9px; background: #164e63; color: #fff; font: inherit; font-weight: 750; }
  </style></head><body><main class="oauth-card oauth-error" role="alert"><h1>Authorization could not continue</h1><p>${htmlEscape(detail)}</p><p>Return to the requesting client and try again. Do not reuse this page or any old authorization request.</p></main></body></html>`
  return htmlResponse(res, status, body)
}

async function handleOAuthAuthorizeGet(req, res, url) {
  let data
  try { data = await authorizationRequest(url) }
  catch (error) { return jsonResponse(res, error.status || 400, { error: error.message || 'invalid_request' }) }
  const cookie = String(req.headers.cookie || '')
  const sessionValue = sessionCookieValue(cookie)
  if (!sessionValue) return oauthLoginRedirect(res, url)
  let me
  try { me = await apiCookie('/api/me', cookie) }
  catch { return oauthLoginRedirect(res, url) }
  pruneOAuth()
  const csrf = crypto.randomBytes(24).toString('base64url')
  oauthPending.set(csrf, { ...data, uid: me.user?.id || null, sessionHash: base64urlDigest(sessionValue), expiresAt: Date.now() + OAUTH_TTL_MS })
  return htmlResponse(res, 200, authorizeForm(data, csrf, me.user), { formActionOrigin: callbackOrigin(data.redirectUri) })
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

function sessionCookieValue(cookie) {
  const values = name => String(cookie || '').split(';').flatMap(part => {
    const index = part.indexOf('=')
    return index >= 0 && part.slice(0, index).trim() === name ? [part.slice(index + 1).trim()] : []
  })
  const host = values('__Host-gymsid')
  const selected = host.length ? host : values('gymsid')
  if (!selected.length || selected.some(value => value !== selected[0])) return ''
  return selected[0]
}

function oauthFormHash(form) {
  const url = authFormUrl(form)
  const scope = formScope(form.getAll('scope')).sort()
  if (scope.length) url.searchParams.set('scope', scope.join(' '))
  const decision = String(form.get('decision') || 'allow')
  return base64urlDigest(JSON.stringify({ csrf: String(form.get('csrf') || ''), decision, query: url.searchParams.toString() }))
}

function oauthResultResponse(req, res, result) {
  if (result?.status === 302) {
    if (result.relay) return oauthRelayResponse(res, result.location)
    res.writeHead(302, { Location: result.location, 'Cache-Control': 'no-store' })
    return res.end()
  }
  const body = result?.body || { error: 'authorization failed' }
  return oauthPostError(req, res, result?.status || 500, body.error || 'authorization failed')
}

async function handleOAuthAuthorizePost(req, res) {
  let form
  try { form = await readFormBody(req) }
  catch (error) { return oauthPostError(req, res, error.status || 400, 'invalid_request') }
  const decision = String(form.get('decision') || 'allow')
  if (!['allow', 'deny'].includes(decision)) return oauthPostError(req, res, 400, 'invalid_request')
  const csrf = String(form.get('csrf') || '')
  pruneOAuth()
  const formHash = oauthFormHash(form)
  const existingReplay = oauthReplay.get(csrf)
  if (!oauthPending.has(csrf)) {
    if (!existingReplay || existingReplay.expiresAt <= Date.now()) return oauthPostError(req, res, 400, 'authorization request expired')
    if (existingReplay.formHash !== formHash) return oauthPostError(req, res, 400, 'authorization request changed')
    const cookie = String(req.headers.cookie || '')
    const sessionValue = sessionCookieValue(cookie)
    if (!sessionValue) return oauthPostError(req, res, 401, 'not signed in')
    let me
    try { me = await apiCookie('/api/me', cookie) }
    catch { return oauthPostError(req, res, 401, 'not signed in') }
    const sessionHash = base64urlDigest(sessionValue)
    if ((existingReplay.uid && existingReplay.uid !== me.user?.id) || (existingReplay.sessionHash && existingReplay.sessionHash !== sessionHash)) {
      return oauthPostError(req, res, 403, 'session changed')
    }
    const result = existingReplay.status === 'processing' ? await existingReplay.promise : existingReplay.result
    if (existingReplay.sessionHash && existingReplay.sessionHash !== sessionHash) return oauthPostError(req, res, 403, 'session changed')
    return oauthResultResponse(req, res, result)
  }
  const pending = oauthPending.get(csrf)
  if (!pending || pending.expiresAt <= Date.now()) {
    oauthPending.delete(csrf)
    return oauthPostError(req, res, 400, 'authorization request expired')
  }
  // Consume the browser nonce before any await. Two concurrent POSTs therefore cannot both pass
  // the check and mint two grants. The bounded replay record lets a lost redirect be retried
  // without weakening that one-time nonce or minting a second bearer grant.
  oauthPending.delete(csrf)
  let resolveReplay
  const replay = {
    formHash, uid: pending.uid, sessionHash: null, status: 'processing', result: null,
    expiresAt: Date.now() + OAUTH_TTL_MS,
    promise: new Promise(resolve => { resolveReplay = resolve })
  }
  oauthReplay.set(csrf, replay)
  const finish = result => {
    if (replay.status === 'processing') {
      replay.status = 'complete'
      replay.result = result
      resolveReplay(result)
      if (result?.status !== 302) oauthReplay.delete(csrf)
    }
    return oauthResultResponse(req, res, result)
  }
  let data
  try { data = await authorizationRequest(authFormUrl(form)) }
  catch (error) { return finish({ status: error.status || 400, body: { error: error.message || 'invalid_request' } }) }
  if (data.clientId !== pending.clientId || data.redirectUri !== pending.redirectUri || data.challenge !== pending.challenge || data.resource !== pending.resource || data.state !== pending.state) {
    return finish({ status: 400, body: { error: 'authorization request changed' } })
  }
  const selected = formScope(form.getAll('scope'))
  if (decision === 'allow' && (!selected.length || selected.some(scope => !pending.requested.includes(scope)))) return finish({ status: 400, body: { error: 'invalid_scope' } })
  const cookie = String(req.headers.cookie || '')
  const sessionValue = sessionCookieValue(cookie)
  if (!sessionValue) return finish({ status: 401, body: { error: 'not signed in' } })
  let me
  try { me = await apiCookie('/api/me', cookie) }
  catch { return finish({ status: 401, body: { error: 'not signed in' } }) }
  replay.sessionHash = base64urlDigest(sessionValue)
  if (pending.uid && pending.uid !== me.user?.id) return finish({ status: 403, body: { error: 'session changed' } })
  if (pending.sessionHash && pending.sessionHash !== replay.sessionHash) return finish({ status: 403, body: { error: 'session changed' } })
  if (decision === 'deny') {
    const redirect = new URL(data.redirectUri)
    redirect.searchParams.set('error', 'access_denied')
    if (data.state) redirect.searchParams.set('state', data.state)
    return finish({ status: 302, location: redirect.toString(), relay: !!data.callback?.relay })
  }
  let grant
  try {
    const requestedTtl = Number(process.env.OAUTH_GRANT_TTL_SECONDS || 2592000)
    const expiresIn = Number.isFinite(requestedTtl) ? Math.max(1, Math.min(365 * 86400, Math.floor(requestedTtl))) : 2592000
    grant = await apiCookie('/api/mcp/grants', cookie, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `OAuth: ${data.client.client_name}`, scopes: selected, audience: PUBLIC_URL, expires_in: expiresIn })
    })
  } catch (error) {
    return finish({ status: error.status || 502, body: { error: error.message || 'grant_failed' } })
  }
  pruneOAuth()
  const code = crypto.randomBytes(32).toString('base64url')
  oauthCodes.set(code, {
    clientId: data.clientId, redirectUri: data.redirectUri, challenge: data.challenge,
    method: data.method, resource: data.resource, scope: selected, token: grant.token, grantExpiresAt: grant.grant?.expires || null,
    expiresAt: Date.now() + OAUTH_TTL_MS, used: false
  })
  const redirect = new URL(data.redirectUri)
  redirect.searchParams.set('code', code)
  if (data.state) redirect.searchParams.set('state', data.state)
  return finish({ status: 302, location: redirect.toString(), relay: !!data.callback?.relay })
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
      const server = makeServer(token, auth.grant?.scopes || [])
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
