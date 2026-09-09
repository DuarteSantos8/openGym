#!/usr/bin/env node
/*
 * Disposable OAuth 2.1/PKCE + MCP acceptance harness. It uses a temporary data directory and a
 * signed staging session only; it never reads /opt/opengym, prints a bearer token, or contacts the
 * production hostname. The output is intentionally receipt-shaped because the release transcript
 * is the audit surface for this local proof.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-oauth-'))
const uid = 'oauth-user'
const otherUid = 'oauth-other'
const secret = 'oauth-staging-secret'
const writeJson = (name, value) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2))
const state = { unit: 'kg', routines: [{ id: 'oauth-routine', name: 'Staging routine', ex: [{ id: '0001', sets: 3, reps: 5, weight: 50 }] }], week: {}, dayPlan: {}, workouts: [{ id: 'oauth-workout', d: '2026-09-08', entries: [{ id: '0001', sets: [{ w: 50, r: 5, done: true }] }] }], bodyweight: [], customEx: [{ id: 'oauth-custom', n: 'OAuth custom', bp: 'chest', custom: true }] }
writeJson('db.json', { users: [{ id: uid, name: 'OAuth staging user' }, { id: otherUid, name: 'Other user' }], creds: [], subs: [], invites: [] })
writeJson(`state-${uid}.json`, state)
writeJson(`state-${otherUid}.json`, { unit: 'kg', routines: [], workouts: [], customEx: [] })
fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 })

const session = (() => {
  const payload = `${uid}:${Date.now() + 3600000}:0`
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`
})()
const bearer = token => ({ Authorization: `Bearer ${token}` })

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function start(command, args, env) {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`process exited before startup: ${output}`)
    if (output.includes('gym-api on') || output.includes('Streamable HTTP')) return child
    await wait(25)
  }
  throw new Error(`process did not start: ${output}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  for (let i = 0; i < 60 && child.exitCode === null; i++) await wait(25)
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function responseData(response) {
  const text = await response.text()
  if (!text) return {}
  const line = text.split('\n').filter(Boolean).pop() || '{}'
  const json = line.startsWith('data:') ? line.slice(5).trim() : line
  try { return JSON.parse(json) } catch { return {} }
}

async function request(base, endpoint, options = {}) {
  const response = await fetch(base + endpoint, { ...options, headers: { ...(options.headers || {}) } })
  const data = await responseData(response)
  return { response, data }
}

const jsonBody = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const formBody = form => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item))
    else params.set(key, value)
  }
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }
}
const hashVerifier = verifier => crypto.createHash('sha256').update(verifier).digest('base64url')
function status(result, expected, label) { assert.equal(result.response.status, expected, `${label}: ${result.response.status}`); return result }
function print(label, value) { console.log(`${label}=${typeof value === 'string' ? value : JSON.stringify(value)}`) }

const apiPort = await freePort()
const mcpPort = await freePort()
const apiBase = `http://127.0.0.1:${apiPort}`
const mcpBase = `http://127.0.0.1:${mcpPort}`
const resource = 'https://gym.example.test/mcp'
let apiChild; let mcpChild
try {
  apiChild = await start('node', ['api/server.js'], {
    PORT: apiPort, DATA_DIR: dataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost',
    MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0'
  })
  mcpChild = await start('node', ['mcp/src/http.js'], {
    MCP_PORT: mcpPort, OPENGYM_API: apiBase, MCP_PUBLIC_URL: resource, MCP_CORS_ORIGIN: 'http://127.0.0.1'
  })

  const protectedMetadata = status(await request(mcpBase, '/.well-known/oauth-protected-resource'), 200, 'protected-resource metadata').data
  assert.equal(protectedMetadata.resource, resource)
  assert.deepEqual(protectedMetadata.authorization_servers, ['https://gym.example.test'])
  const protectedMetadataPath = status(await request(mcpBase, '/.well-known/oauth-protected-resource/mcp'), 200, 'path protected-resource metadata').data
  assert.deepEqual(protectedMetadataPath, protectedMetadata)
  const authorizationMetadata = status(await request(mcpBase, '/.well-known/oauth-authorization-server'), 200, 'authorization-server metadata').data
  assert.equal(authorizationMetadata.authorization_endpoint, 'https://gym.example.test/oauth/authorize')
  assert.equal(authorizationMetadata.token_endpoint, 'https://gym.example.test/oauth/token')
  assert.equal(authorizationMetadata.registration_endpoint, 'https://gym.example.test/oauth/register')
  assert.deepEqual(authorizationMetadata.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(authorizationMetadata.token_endpoint_auth_methods_supported, ['none'])
  print('oauth_protected_resource_metadata', 'PASS')
  print('oauth_authorization_server_metadata', 'PASS')

  const registration = status(await request(mcpBase, '/oauth/register', jsonBody({
    client_name: 'Claude staging client', redirect_uris: ['https://client.example.test/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none',
    scope: 'exercise:read routine:read progress:read'
  })), 201, 'dynamic client registration').data
  assert.ok(registration.client_id)
  assert.equal(registration.token_endpoint_auth_method, 'none')
  assert.equal(registration.client_secret_expires_at, 0)
  assert.ok(registration.client_expires_at > Math.floor(Date.now() / 1000))
  assert.deepEqual(registration.redirect_uris, ['https://client.example.test/callback'])
  const stored = status(await request(apiBase, `/api/oauth/clients/${registration.client_id}`), 200, 'stored client metadata').data
  assert.equal(stored.client_id, registration.client_id)
  // The API applies a bounded, normalized-IP registration limiter before the persistent cap.
  // Fill only the disposable window (not the client cap) and prove the next request is rejected.
  for (let i = 0; i < 19; i++) {
    status(await request(mcpBase, '/oauth/register', jsonBody({
      client_name: `rate fixture ${i}`, redirect_uris: [`https://rate-${i}.example.test/callback`],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
    })), 201, `rate fixture ${i}`)
  }
  const rateLimited = await request(mcpBase, '/oauth/register', jsonBody({
    client_name: 'rate limited', redirect_uris: ['https://rate-limit.example.test/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }))
  assert.equal(rateLimited.response.status, 429)
  print('oauth_dynamic_registration', 'PASS')
  print('oauth_client_secret_issued', false)
  print('oauth_dcr_rate_limit_status', 429)

  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = hashVerifier(verifier)
  const authorizeQuery = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
    scope: 'exercise:read routine:read progress:read', code_challenge: challenge,
    code_challenge_method: 'S256', resource, state: 'oauth-state-1'
  })
  const consentResponse = await fetch(mcpBase + `/oauth/authorize?${authorizeQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const consentHtml = await consentResponse.text()
  assert.equal(consentResponse.status, 200)
  assert.match(consentHtml, /Unverified client/)
  assert.match(consentHtml, /https:\/\/client\.example\.test\/callback/)
  const csrf = /name="csrf" value="([^"]+)"/.exec(consentHtml)?.[1]
  assert.ok(csrf)
  print('oauth_consent_unverified_redirect_display', 'PASS')
  const authorization = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'oauth-state-1', scope: ['exercise:read', 'routine:read', 'progress:read'] }),
    headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  assert.equal(authorization.status, 302)
  const location = authorization.headers.get('location')
  assert.ok(location)
  const redirect = new URL(location)
  assert.equal(redirect.searchParams.get('state'), 'oauth-state-1')
  const code = redirect.searchParams.get('code')
  assert.ok(code)
  print('oauth_pkce_authorization_consent', 'PASS')

  const wrongResourceToken = await request(mcpBase, '/oauth/token', formBody({
    grant_type: 'authorization_code', code, client_id: registration.client_id,
    redirect_uri: registration.redirect_uris[0], resource: 'https://other.example.test/mcp', code_verifier: verifier
  }))
  assert.equal(wrongResourceToken.response.status, 400)
  print('oauth_token_resource_mismatch_status', 400)
  const tokenResult = status(await request(mcpBase, '/oauth/token', formBody({
    grant_type: 'authorization_code', code, client_id: registration.client_id,
    redirect_uri: registration.redirect_uris[0], resource, code_verifier: verifier
  })), 200, 'authorization-code token').data
  assert.ok(tokenResult.access_token)
  assert.equal(tokenResult.token_type, 'Bearer')
  assert.equal(tokenResult.resource, resource)
  assert.match(tokenResult.scope, /exercise:read/)
  const reused = await request(mcpBase, '/oauth/token', formBody({
    grant_type: 'authorization_code', code, client_id: registration.client_id,
    redirect_uri: registration.redirect_uris[0], code_verifier: verifier
  }))
  assert.equal(reused.response.status, 400)
  print('oauth_pkce_token_one_time', 'PASS')

  const grant = status(await request(apiBase, '/api/mcp/introspect', { headers: bearer(tokenResult.access_token) }), 200, 'token introspection').data.grant
  assert.equal(grant.audience, resource)
  assert.ok(grant.expires > Date.now())
  print('oauth_token_resource_audience', grant.audience)
  print('oauth_token_expiry_future', true)

  async function mcpCall(token, sessionId, id, method, params = {}) {
    const response = await fetch(mcpBase + '/mcp', {
      method: 'POST', headers: { ...bearer(token), Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    })
    return { response, data: await responseData(response) }
  }
  const initialized = await mcpCall(tokenResult.access_token, null, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Claude staging client', version: '1' } })
  status(initialized, 200, 'MCP initialize')
  const mcpSession = initialized.response.headers.get('mcp-session-id')
  assert.ok(mcpSession)
  const initializedNotification = await mcpCall(tokenResult.access_token, mcpSession, 2, 'notifications/initialized')
  assert.ok([200, 202].includes(initializedNotification.response.status), `MCP initialized notification: ${initializedNotification.response.status}`)
  const toolsList = status(await mcpCall(tokenResult.access_token, mcpSession, 3, 'tools/list'), 200, 'MCP tools/list').data
  const toolNames = toolsList.result?.tools?.map(tool => tool.name) || []
  assert.ok(toolNames.includes('list_exercises') && toolNames.includes('search_exercises') && toolNames.includes('get_exercise'))
  const list = status(await mcpCall(tokenResult.access_token, mcpSession, 4, 'tools/call', { name: 'list_exercises', arguments: { offset: 0, limit: 5 } }), 200, 'MCP list_exercises').data
  const listPayload = JSON.parse(list.result?.content?.[0]?.text || '{}')
  print('oauth_mcp_list_total_observed', listPayload.total)
  assert.ok(listPayload.total >= 1325)
  const search = status(await mcpCall(tokenResult.access_token, mcpSession, 5, 'tools/call', { name: 'search_exercises', arguments: { query: 'OAuth custom' } }), 200, 'MCP search_exercises').data
  const searchPayload = JSON.parse(search.result?.content?.[0]?.text || '{}')
  assert.ok(searchPayload.exercises?.some(exercise => exercise.id === 'oauth-custom'))
  const exercise = status(await mcpCall(tokenResult.access_token, mcpSession, 6, 'tools/call', { name: 'get_exercise', arguments: { exercise_id: 'oauth-custom' } }), 200, 'MCP get_exercise').data
  const exercisePayload = JSON.parse(exercise.result?.content?.[0]?.text || '{}')
  assert.equal(exercisePayload.id, 'oauth-custom')
  print('oauth_mcp_initialize', 'PASS')
  print('oauth_mcp_catalog_tools', ['list_exercises', 'search_exercises', 'get_exercise'])
  print('oauth_mcp_catalog_traversal', { list: true, search: true, get: true, total: listPayload.total })

  const wrongAudience = status(await request(apiBase, '/api/mcp/grants', { ...jsonBody({ name: 'wrong audience', scopes: ['exercise:read'], audience: 'https://other.example.test/mcp', expires_in: 60 }), headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/json' } }), 201, 'wrong audience grant').data
  const wrongAudienceMcp = await mcpCall(wrongAudience.token, null, 9, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wrong audience', version: '1' } })
  assert.equal(wrongAudienceMcp.response.status, 401)
  assert.match(wrongAudienceMcp.response.headers.get('www-authenticate') || '', /invalid_token/)
  print('oauth_negative_audience_status', 401)
  const revoke = status(await request(apiBase, '/api/mcp/grants/revoke', { ...jsonBody({ id: grant.id }), headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/json' } }), 200, 'grant revoke')
  assert.equal(revoke.data.revoked, true)
  const revoked = await mcpCall(tokenResult.access_token, null, 7, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'revoked', version: '1' } })
  assert.equal(revoked.response.status, 401)
  assert.match(revoked.response.headers.get('www-authenticate') || '', /resource_metadata/)
  print('oauth_revoked_grant_status', 401)

  const shortGrant = status(await request(apiBase, '/api/mcp/grants', { ...jsonBody({ name: 'expiry fixture', scopes: ['exercise:read'], audience: resource, expires_in: 1 }), headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/json' } }), 201, 'short-lived grant').data
  await wait(1250)
  const expired = await mcpCall(shortGrant.token, null, 8, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'expired', version: '1' } })
  assert.equal(expired.response.status, 401)
  assert.match(expired.response.headers.get('www-authenticate') || '', /invalid_token/)
  print('oauth_token_expiry_enforced', 401)
  print('OAUTH_STAGING', 'PASS')
} finally {
  await stop(mcpChild)
  await stop(apiChild)
  fs.rmSync(dataDir, { recursive: true, force: true })
}
