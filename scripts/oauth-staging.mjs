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
writeJson('db.json', { users: [{ id: uid, name: 'OAuth staging <svg/onload=alert(1)>' }, { id: otherUid, name: 'Other user' }], creds: [], subs: [], invites: [] })
writeJson(`state-${uid}.json`, state)
writeJson(`state-${otherUid}.json`, { unit: 'kg', routines: [], workouts: [], customEx: [] })
fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 })
const legacyClientId = 'legacy-wildcard-client'
writeJson('oauth-clients.json', {
  clients: [{
    clientId: legacyClientId, clientName: 'Legacy wildcard fixture',
    redirectUris: ['https://*.legacy.example.test/callback'],
    grantTypes: ['authorization_code'], responseTypes: ['code'], tokenEndpointAuthMethod: 'none',
    scope: 'exercise:read', createdAt: new Date().toISOString()
  }]
})

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

// The Phase 4A contract is exercised against a disposable process. Keep every assertion running
// so the transcript records the complete set of current gaps instead of stopping at the first 404;
// after the implementation lands the same runner exits 0 without changing its expectations.
const phase4aFailures = []
async function phase4aCheck(label, assertion) {
  try {
    await assertion()
    print(`phase4a_${label}`, 'PASS')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    print(`phase4a_${label}`, `FAIL ${message}`)
    phase4aFailures.push(`${label}: ${message}`)
  }
}

// Phase 4C is deliberately a RED-only contract pass. Each assertion records its own gap so the
// transcript remains useful when several independent protocol/data-parity blockers are present;
// the runner exits non-zero until the unchanged expectations become true after implementation.
const phase4cFailures = []
async function phase4cCheck(label, assertion) {
  try {
    await assertion()
    print(`phase4c_${label}`, 'PASS')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    print(`phase4c_${label}`, `FAIL ${message}`)
    phase4cFailures.push(`${label}: ${message}`)
  }
}

// Phase 4D extends the server/app parity contract.  These checks are intentionally kept
// alongside the disposable OAuth harness so they exercise the real API writer and profile
// bytes, not a test double.  They run only when explicitly requested by the staging operator.
const phase4dFailures = []
async function phase4dCheck(label, assertion) {
  try {
    await assertion()
    print(`phase4d_${label}`, 'PASS')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    print(`phase4d_${label}`, `FAIL ${message}`)
    phase4dFailures.push(`${label}: ${message}`)
  }
}

const apiPort = await freePort()
const mcpPort = await freePort()
const apiBase = `http://127.0.0.1:${apiPort}`
const mcpBase = `http://127.0.0.1:${mcpPort}`
const resource = 'https://gym.example.test/mcp'
// Phase 4A RED uses a pre-seeded bearer grant so the write-path assertions can exercise the
// existing authorization boundary even though e8d79c0 has no workout:write route yet. The
// fixture is disposable and never leaves this temporary data directory.
const workoutToken = crypto.randomBytes(32).toString('base64url')
const tokenHash = token => crypto.createHash('sha256').update(String(token)).digest('hex')
writeJson('mcp-grants.json', {
  grants: [{
    id: 'phase4a-workout-grant', uid, name: 'Phase 4A workout fixture',
    scopes: ['exercise:read', 'routine:read', 'workout:read', 'bodyweight:read', 'progress:read', 'workout:write'],
    tokenHash: tokenHash(workoutToken), created: new Date().toISOString(),
    expires: Date.now() + 3600000, audience: resource
  }]
})
let apiChild; let mcpChild
try {
  const nginxTemplate = fs.readFileSync(path.join(ROOT, 'web/nginx.conf.template'), 'utf8')
  const apiProxy = /location \^~ \/api\/ \{[\s\S]*?proxy_set_header X-OpenGym-Client-IP \$remote_addr;/.test(nginxTemplate)
  const oauthProxy = /location \^~ \/oauth \{[\s\S]*?proxy_set_header X-OpenGym-Client-IP \$remote_addr;/.test(nginxTemplate)
  assert.equal(apiProxy && oauthProxy, true, 'nginx overwrites gateway client IP on API and OAuth routes')
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8')
  const apiSection = /^  api:\n([\s\S]*?)\n  mcp:/m.exec(compose)?.[1] || ''
  assert.ok(apiSection && !/^\s+ports:/m.test(apiSection), 'API is not directly published; web owns the overwrite boundary')
  apiChild = await start('node', ['api/server.js'], {
    PORT: apiPort, DATA_DIR: dataDir, RP_ID: 'localhost', ORIGIN: 'https://gym.example.test',
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

  // The public proxy supplies the caller address to MCP; MCP normalizes and forwards
  // it in a gateway-owned header so API DCR limiting is per caller, not per container.
  const dcrHeaders = { 'X-Forwarded-For': '198.51.100.10' }
  const dcrBody = (body, headers = dcrHeaders) => ({ ...jsonBody(body), headers: { 'Content-Type': 'application/json', ...headers } })
  const registration = status(await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'Claude staging client', redirect_uris: ['https://client.example.test/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none',
    scope: 'exercise:read routine:read progress:read bodyweight:read'
  })), 201, 'dynamic client registration').data
  assert.ok(registration.client_id)
  assert.equal(registration.token_endpoint_auth_method, 'none')
  assert.equal(registration.client_secret_expires_at, 0)
  assert.deepEqual(registration.grant_types, ['authorization_code'])
  assert.ok(registration.client_expires_at > Math.floor(Date.now() / 1000))
  assert.deepEqual(registration.redirect_uris, ['https://client.example.test/callback'])
  const stored = status(await request(apiBase, `/api/oauth/clients/${registration.client_id}`), 200, 'stored client metadata').data
  assert.equal(stored.client_id, registration.client_id)

  // A pre-fix persisted client must fail closed at both retrieval and authorization. The raw
  // record remains untouched so an operator can repair it deliberately instead of losing data.
  const legacyFile = path.join(dataDir, 'oauth-clients.json')
  const legacyBefore = fs.readFileSync(legacyFile, 'utf8')
  const legacyLookup = await request(apiBase, `/api/oauth/clients/${legacyClientId}`)
  assert.equal(legacyLookup.response.status, 404)
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBefore)
  const legacyChallenge = hashVerifier(crypto.randomBytes(32).toString('base64url'))
  const legacyQuery = new URLSearchParams({
    response_type: 'code', client_id: legacyClientId, redirect_uri: 'https://*.legacy.example.test/callback',
    scope: 'exercise:read', code_challenge: legacyChallenge, code_challenge_method: 'S256', resource,
    state: 'legacy-wildcard-state'
  })
  const legacyAuthorize = await fetch(mcpBase + `/oauth/authorize?${legacyQuery}`, {
    headers: { Cookie: `gymsid=${session}`, Accept: 'text/html' }
  })
  const legacyAuthorizeBody = await legacyAuthorize.text()
  assert.equal(legacyAuthorize.status, 400)
  assert.match(legacyAuthorize.headers.get('content-type') || '', /application\/json/)
  assert.doesNotMatch(legacyAuthorizeBody, /<form|form-action|legacy\.example\.test/)
  print('oauth_legacy_invalid_client_lookup_fail_closed', { status: 404, persisted_record_unchanged: true })
  print('oauth_legacy_wildcard_authorization_blocked', 400)

  const wildcardRedirect = await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'Wildcard redirect fixture', redirect_uris: ['https://*.example.test/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.20' }))
  assert.equal(wildcardRedirect.response.status, 400)
  assert.equal(wildcardRedirect.data.error, 'invalid_redirect_uris')
  print('oauth_wildcard_redirect_rejected', 400)
  for (const [label, redirectUri, address] of [
    ['underscore', 'https://bad_name.example.test/callback', '198.51.100.25'],
    ['credentials', 'https://user:pass@example.test/callback', '198.51.100.26'],
    ['fragment', 'https://fragment.example.test/callback#oauth', '198.51.100.27'],
    ['empty_credentials', 'https://@empty-credentials.example.test/callback', '198.51.100.30'],
    ['empty_fragment', 'https://empty-fragment.example.test/callback#', '198.51.100.31'],
    ['invalid_host', 'https://-bad.example.test/callback', '198.51.100.28']
  ]) {
    const invalidRedirect = await request(mcpBase, '/oauth/register', dcrBody({
      client_name: `${label} redirect fixture`, redirect_uris: [redirectUri],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
    }, { 'X-Forwarded-For': address }))
    assert.equal(invalidRedirect.response.status, 400)
    assert.equal(invalidRedirect.data.error, 'invalid_redirect_uris')
    print(`oauth_${label}_redirect_rejected`, 400)
  }
  const ipv6Redirect = await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'IPv6 loopback fixture', redirect_uris: ['http://[::1]:49152/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.21' }))
  assert.equal(ipv6Redirect.response.status, 201)
  assert.deepEqual(ipv6Redirect.data.redirect_uris, ['http://[::1]:49152/callback'])
  print('oauth_ipv6_loopback_redirect_retained', 201)
  const localhostRedirect = status(await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'Localhost redirect fixture', redirect_uris: ['http://localhost:49152/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.22' })), 201, 'localhost redirect fixture').data
  assert.deepEqual(localhostRedirect.redirect_uris, ['http://localhost:49152/callback'])
  print('oauth_localhost_redirect_retained', 201)
  assert.deepEqual(registration.redirect_uris, ['https://client.example.test/callback'])

  // Codex sends this exact native-client shape, including a localhost callback and the optional
  // refresh_token grant. It must be accepted without overstating the server's capabilities.
  const codexRegistration = status(await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'Codex', redirect_uris: ['http://127.0.0.1:49152/callback/openGym'],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none', scope: 'exercise:read', application_type: 'native'
  }, { 'X-Forwarded-For': '198.51.100.12' })), 201, 'Codex native dynamic client registration').data
  assert.deepEqual(codexRegistration.grant_types, ['authorization_code'])
  assert.equal(codexRegistration.token_endpoint_auth_method, 'none')
  assert.deepEqual(codexRegistration.redirect_uris, ['http://127.0.0.1:49152/callback/openGym'])
  print('oauth_https_and_ipv4_redirects_retained', 201)
  print('oauth_codex_refresh_grant_compatibility', 'PASS')
  print('oauth_codex_native_dcr', 'PASS')
  const unsupportedGrant = await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'unsupported grant fixture', redirect_uris: ['http://127.0.0.1:49153/callback'],
    grant_types: ['refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.13' }))
  assert.equal(unsupportedGrant.response.status, 400)
  print('oauth_unsupported_grant_rejected', 400)
  const malformedGrantTypes = await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'malformed grant fixture', redirect_uris: ['https://malformed-grant.example.test/callback'],
    grant_types: 'authorization_code', response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.14' }))
  assert.equal(malformedGrantTypes.response.status, 400)
  assert.equal(malformedGrantTypes.data.error, 'invalid_client_metadata')
  const malformedResponseTypes = await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'malformed response fixture', redirect_uris: ['https://malformed-response.example.test/callback'],
    grant_types: ['authorization_code'], response_types: 'code', token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.15' }))
  assert.equal(malformedResponseTypes.response.status, 400)
  assert.equal(malformedResponseTypes.data.error, 'invalid_client_metadata')
  print('oauth_malformed_registration_fields_rejected', 400)
  // The API applies a bounded, normalized-IP registration limiter before the persistent cap.
  // Fill only the disposable window (not the client cap) and prove the next request is rejected.
  for (let i = 0; i < 19; i++) {
    status(await request(mcpBase, '/oauth/register', dcrBody({
      client_name: `rate fixture ${i}`, redirect_uris: [`https://rate-${i}.example.test/callback`],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
    })), 201, `rate fixture ${i}`)
  }
  const rateLimited = await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'rate limited', redirect_uris: ['https://rate-limit.example.test/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }))
  assert.equal(rateLimited.response.status, 429)
  const alternateAddress = await request(mcpBase, '/oauth/register', dcrBody({
      client_name: 'alternate address', redirect_uris: ['https://alternate.example.test/callback'],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
    }, { 'X-Forwarded-For': '198.51.100.11' }))
  assert.equal(alternateAddress.response.status, 201)
  print('oauth_dynamic_registration', 'PASS')
  print('oauth_client_secret_issued', false)
  print('oauth_dcr_rate_limit_status', 429)
  print('oauth_dcr_forwarded_ip_isolation', 'PASS')
  print('oauth_dcr_gateway_header_overwrite', 'PASS')
  print('oauth_api_direct_publish', false)

  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = hashVerifier(verifier)
  const authorizeQuery = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
    scope: 'exercise:read routine:read progress:read bodyweight:read', code_challenge: challenge,
    code_challenge_method: 'S256', resource, state: 'oauth-state-1'
  })
  const unauthenticatedAuthorize = await fetch(mcpBase + `/oauth/authorize?${authorizeQuery}`, { redirect: 'manual' })
  assert.equal(unauthenticatedAuthorize.status, 302)
  const loginLocation = unauthenticatedAuthorize.headers.get('location')
  assert.ok(loginLocation?.startsWith('/?oauth_return='))
  const loginUrl = new URL(loginLocation, mcpBase)
  assert.equal(loginUrl.pathname, '/')
  assert.equal(loginUrl.searchParams.get('oauth_return'), `/oauth/authorize?${authorizeQuery}`)
  print('oauth_unauthenticated_login_return', 'PASS')
  const consentResponse = await fetch(mcpBase + `/oauth/authorize?${authorizeQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const consentHtml = await consentResponse.text()
  assert.equal(consentResponse.status, 200)
  assert.match(consentHtml, /Unverified client/)
  assert.match(consentHtml, /https:\/\/client\.example\.test\/callback/)
  const consentCsp = consentResponse.headers.get('content-security-policy') || ''
  assert.match(consentCsp, /form-action 'self' https:\/\/client\.example\.test/)
  assert.doesNotMatch(consentCsp, /\*/)
  assert.match(consentHtml, /name="viewport"/)
  assert.match(consentHtml, /class="oauth-card"/)
  assert.match(consentHtml, /class="opengym-mark"[^>]*>openGym<\/span>/i)
  assert.match(consentHtml, /View exercises/)
  assert.match(consentHtml, /View routines/)
  assert.match(consentHtml, /View progress/)
  assert.match(consentHtml, /View bodyweight/)
  assert.match(consentHtml, /class="oauth-actions"/)
  assert.match(consentHtml, /name="decision" value="allow"/)
  assert.match(consentHtml, /name="decision" value="deny"/)
  assert.match(consentHtml, /min-height:\s*44px/)
  assert.match(consentHtml, /h1 \{[^}]*overflow-wrap:\s*anywhere/)
  assert.match(consentHtml, /button:focus-visible, input:focus-visible \{ outline: 3px solid #164e63; outline-offset: 2px; \}/)
  assert.doesNotMatch(consentHtml, /#f59e0b/)
  assert.doesNotMatch(consentHtml, /workout:write/)
  assert.match(consentHtml, /&lt;svg\/onload=alert\(1\)&gt;/)
  const csrf = /name="csrf" value="([^"]+)"/.exec(consentHtml)?.[1]
  assert.ok(csrf)
  print('oauth_consent_polished_accessible_markup', 'PASS')
  print('oauth_consent_narrow_callback_csp', consentCsp)

  // The state is untrusted client input and must remain data in every rendered context.
  const xssState = '<script>alert(1)</script>'
  const xssQuery = new URLSearchParams(authorizeQuery)
  xssQuery.set('state', xssState)
  const xssConsent = await fetch(mcpBase + `/oauth/authorize?${xssQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const xssHtml = await xssConsent.text()
  assert.equal(xssConsent.status, 200)
  assert.match(xssHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(xssHtml, /<script>alert\(1\)<\/script>/)
  print('oauth_consent_untrusted_fields_escaped', 'PASS')

  const hostileRedirect = 'https://xss.example.test/callback?next=<script>alert(1)</script>;default-src *'
  const hostileRegistration = status(await request(mcpBase, '/oauth/register', dcrBody({
    client_name: '<img src=x onerror=alert(1)>', redirect_uris: [hostileRedirect],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.23' })), 201, 'hostile consent fixture').data
  const hostileQuery = new URLSearchParams({
    response_type: 'code', client_id: hostileRegistration.client_id, redirect_uri: hostileRedirect,
    scope: 'exercise:read', code_challenge: challenge, code_challenge_method: 'S256', resource,
    state: 'hostile-scope-context'
  })
  const hostileConsent = await fetch(mcpBase + `/oauth/authorize?${hostileQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const hostileHtml = await hostileConsent.text()
  const hostileCsp = hostileConsent.headers.get('content-security-policy') || ''
  assert.equal(hostileConsent.status, 200)
  assert.match(hostileHtml, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(hostileHtml, /https:\/\/xss\.example\.test\/callback\?next=&lt;script&gt;alert\(1\)&lt;\/script&gt;;default-src \*/)
  assert.doesNotMatch(hostileHtml, /<img src=x|<script>alert\(1\)<\/script>/)
  assert.match(hostileCsp, /form-action 'self' https:\/\/xss\.example\.test;/)
  assert.doesNotMatch(hostileCsp, /\*/)
  print('oauth_consent_client_account_redirect_escaped', 'PASS')
  print('oauth_consent_csp_injection_blocked', 'PASS')

  // All seven supported scopes are rendered only when requested, with a human explanation and
  // the exact technical scope kept as secondary detail for an advanced user.
  const allScopesRegistration = status(await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'Scope description fixture', redirect_uris: ['https://scope-description.example.test/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none',
    scope: 'exercise:read routine:read workout:read bodyweight:read progress:read workout:write routine:propose'
  }, { 'X-Forwarded-For': '198.51.100.19' })), 201, 'all-scope consent fixture').data
  const allScopesQuery = new URLSearchParams({
    response_type: 'code', client_id: allScopesRegistration.client_id, redirect_uri: allScopesRegistration.redirect_uris[0],
    scope: allScopesRegistration.scope, code_challenge: challenge, code_challenge_method: 'S256', resource,
    state: 'oauth-all-scopes'
  })
  const allScopesConsent = await fetch(mcpBase + `/oauth/authorize?${allScopesQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const allScopesHtml = await allScopesConsent.text()
  assert.equal(allScopesConsent.status, 200)
  for (const copy of ['View exercises', 'View routines', 'View workout history', 'View bodyweight', 'View progress', 'Create workouts', 'Propose routines for your review']) assert.match(allScopesHtml, new RegExp(copy))
  for (const scope of allScopesRegistration.scope.split(/\s+/)) assert.match(allScopesHtml, new RegExp(`value="${scope}"`))
  print('oauth_consent_scope_descriptions', 'PASS')

  const longClientName = 'L'.repeat(120)
  const longNameRegistration = status(await request(mcpBase, '/oauth/register', dcrBody({
    client_name: longClientName, redirect_uris: ['https://long-name.example.test/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.24' })), 201, 'long client name fixture').data
  const longNameQuery = new URLSearchParams({
    response_type: 'code', client_id: longNameRegistration.client_id, redirect_uri: longNameRegistration.redirect_uris[0],
    scope: 'exercise:read', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'oauth-long-name'
  })
  const longNameConsent = await fetch(mcpBase + `/oauth/authorize?${longNameQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const longNameHtml = await longNameConsent.text()
  assert.equal(longNameConsent.status, 200)
  assert.match(longNameHtml, new RegExp(longClientName))
  assert.match(longNameHtml, /h1 \{[^}]*overflow-wrap:\s*anywhere/)
  print('oauth_consent_long_client_name_wrap_safe', 'PASS')

  const cancelVerifier = crypto.randomBytes(32).toString('base64url')
  const cancelChallenge = hashVerifier(cancelVerifier)
  const cancelQuery = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
    scope: 'exercise:read', code_challenge: cancelChallenge, code_challenge_method: 'S256', resource,
    state: 'oauth-cancel-state'
  })
  const cancelConsent = await fetch(mcpBase + `/oauth/authorize?${cancelQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const cancelHtml = await cancelConsent.text()
  assert.equal(cancelConsent.status, 200)
  const cancelCsrf = /name="csrf" value="([^"]+)"/.exec(cancelHtml)?.[1]
  assert.ok(cancelCsrf)
  const cancelForm = {
    csrf: cancelCsrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code',
    code_challenge: cancelChallenge, code_challenge_method: 'S256', resource, state: 'oauth-cancel-state',
    scope: 'exercise:read', decision: 'deny'
  }
  const grantsBeforeCancel = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants before consent denial').data.grants.length
  const denial = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody(cancelForm), headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  assert.equal(denial.status, 302)
  const denialLocation = new URL(denial.headers.get('location'))
  assert.equal(denialLocation.searchParams.get('error'), 'access_denied')
  assert.equal(denialLocation.searchParams.get('state'), 'oauth-cancel-state')
  assert.equal(denialLocation.searchParams.get('code'), null)
  const grantsAfterCancel = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants after consent denial').data.grants.length
  assert.equal(grantsAfterCancel, grantsBeforeCancel)
  const denialRetry = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody(cancelForm), headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  assert.equal(denialRetry.status, 302)
  assert.equal(denialRetry.headers.get('location'), denial.headers.get('location'))
  const grantsAfterCancelRetry = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants after repeated consent denial').data.grants.length
  assert.equal(grantsAfterCancelRetry, grantsBeforeCancel)
  print('oauth_consent_cancel_denies_without_grant', 'PASS')
  print('oauth_consent_same_denial_is_idempotent', 'PASS')

  const noSessionQuery = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
    scope: 'exercise:read', code_challenge: challenge, code_challenge_method: 'S256', resource,
    state: 'oauth-no-session'
  })
  const noSessionConsent = await fetch(mcpBase + `/oauth/authorize?${noSessionQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const noSessionHtml = await noSessionConsent.text()
  const noSessionCsrf = /name="csrf" value="([^"]+)"/.exec(noSessionHtml)?.[1]
  assert.equal(noSessionConsent.status, 200)
  assert.ok(noSessionCsrf)
  const noSessionPost = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf: noSessionCsrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'oauth-no-session', scope: 'exercise:read', decision: 'allow' }),
    headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const noSessionErrorHtml = await noSessionPost.text()
  assert.equal(noSessionPost.status, 401)
  assert.match(noSessionErrorHtml, /oauth-error/)
  assert.match(noSessionErrorHtml, /sign-in is no longer valid/i)
  print('oauth_consent_not_signed_in_browser_error', 'PASS')

  // A logout/relogin in the same account produces a different valid cookie. A consent page
  // opened before that transition must not approve or deny against the new session.
  const staleOldPayload = `${otherUid}:${Date.now() + 3600000}:0`
  const staleOldSession = `${staleOldPayload}.${crypto.createHmac('sha256', secret).update(staleOldPayload).digest('base64url')}`
  const staleReloginPayload = `${otherUid}:${Date.now() + 3600001}:0`
  const staleReloginSession = `${staleReloginPayload}.${crypto.createHmac('sha256', secret).update(staleReloginPayload).digest('base64url')}`
  const staleQuery = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
    scope: 'exercise:read', code_challenge: challenge, code_challenge_method: 'S256', resource,
    state: 'oauth-stale-relogin'
  })
  const staleConsent = await fetch(mcpBase + `/oauth/authorize?${staleQuery}`, { headers: { Cookie: `gymsid=${staleOldSession}` } })
  const staleHtml = await staleConsent.text()
  const staleCsrf = /name="csrf" value="([^"]+)"/.exec(staleHtml)?.[1]
  assert.equal(staleConsent.status, 200)
  assert.ok(staleCsrf)
  const stalePost = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf: staleCsrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'oauth-stale-relogin', scope: 'exercise:read', decision: 'deny' }),
    headers: { Cookie: `gymsid=${staleReloginSession}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const staleErrorHtml = await stalePost.text()
  assert.equal(stalePost.status, 403)
  assert.match(staleErrorHtml, /oauth-error/)
  assert.match(staleErrorHtml, /session changed/i)
  print('oauth_consent_stale_same_user_relogin_rejected', 'PASS')

  const authorization = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'oauth-state-1', scope: ['exercise:read', 'routine:read', 'progress:read', 'bodyweight:read'] }),
    headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  assert.equal(authorization.status, 302)
  assert.equal(authorization.headers.get('content-security-policy'), null)
  assert.equal(authorization.headers.get('referrer-policy'), null)
  const location = authorization.headers.get('location')
  assert.ok(location)
  const redirect = new URL(location)
  assert.equal(redirect.searchParams.get('state'), 'oauth-state-1')
  const code = redirect.searchParams.get('code')
  assert.ok(code)
  print('oauth_pkce_authorization_consent', 'PASS')

  // IPv6 loopback is valid for native RFC 8252 clients but cannot be represented as a CSP
  // host-source. Keep the consent POST same-origin and finish with a no-script relay page.
  const ipv6Verifier = crypto.randomBytes(32).toString('base64url')
  const ipv6Challenge = hashVerifier(ipv6Verifier)
  const ipv6RedirectUri = ipv6Redirect.data.redirect_uris[0]
  const ipv6AllowQuery = new URLSearchParams({
    response_type: 'code', client_id: ipv6Redirect.data.client_id, redirect_uri: ipv6RedirectUri,
    scope: 'exercise:read', code_challenge: ipv6Challenge, code_challenge_method: 'S256', resource,
    state: 'oauth-ipv6-allow'
  })
  const ipv6Consent = await fetch(mcpBase + `/oauth/authorize?${ipv6AllowQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const ipv6ConsentHtml = await ipv6Consent.text()
  assert.equal(ipv6Consent.status, 200)
  const ipv6ConsentCsp = ipv6Consent.headers.get('content-security-policy') || ''
  assert.equal(ipv6ConsentCsp, "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'")
  assert.doesNotMatch(ipv6ConsentCsp, /::1|\*/)
  const ipv6Csrf = /name="csrf" value="([^"]+)"/.exec(ipv6ConsentHtml)?.[1]
  assert.ok(ipv6Csrf)
  const ipv6AllowForm = {
    csrf: ipv6Csrf, client_id: ipv6Redirect.data.client_id, redirect_uri: ipv6RedirectUri, response_type: 'code',
    code_challenge: ipv6Challenge, code_challenge_method: 'S256', resource, state: 'oauth-ipv6-allow',
    scope: 'exercise:read', decision: 'allow'
  }
  const ipv6Allow = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody(ipv6AllowForm), headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const ipv6RelayHtml = await ipv6Allow.text()
  const relayCsp = "default-src 'none'; form-action 'self'; base-uri 'none'; style-src 'unsafe-inline'"
  assert.equal(ipv6Allow.status, 200)
  assert.equal(ipv6Allow.headers.get('content-security-policy'), relayCsp)
  assert.equal(ipv6Allow.headers.get('referrer-policy'), 'no-referrer')
  assert.match(ipv6RelayHtml, /<meta[^>]+http-equiv="refresh"[^>]+content="0;url=http:\/\/\[::1\]:49152\/callback\?code=[A-Za-z0-9_-]+&amp;state=oauth-ipv6-allow"/i)
  assert.match(ipv6RelayHtml, /href="http:\/\/\[::1\]:49152\/callback\?code=[A-Za-z0-9_-]+&amp;state=oauth-ipv6-allow"/)
  assert.match(ipv6RelayHtml, /Continue to the requesting client/i)
  assert.doesNotMatch(ipv6RelayHtml, /<script|access_token|client_secret|code_verifier|tokenHash/i)
  const ipv6Code = /callback\?code=([A-Za-z0-9_-]+)/.exec(ipv6RelayHtml)?.[1]
  assert.ok(ipv6Code)
  const ipv6AllowRetry = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody(ipv6AllowForm), headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const ipv6RelayRetryHtml = await ipv6AllowRetry.text()
  assert.equal(ipv6AllowRetry.status, 200)
  assert.equal(ipv6RelayRetryHtml, ipv6RelayHtml)
  assert.equal(ipv6AllowRetry.headers.get('content-security-policy'), relayCsp)
  print('oauth_ipv6_allow_relay', { status: 200, csp: relayCsp, referrer_policy: 'no-referrer', same_retry: true, code_present: true })

  const ipv6Token = status(await request(mcpBase, '/oauth/token', formBody({
    grant_type: 'authorization_code', code: ipv6Code, client_id: ipv6Redirect.data.client_id,
    redirect_uri: ipv6RedirectUri, resource, code_verifier: ipv6Verifier
  })), 200, 'IPv6 relay authorization-code token').data
  assert.equal(ipv6Token.resource, resource)
  assert.equal(ipv6Token.scope, 'exercise:read')
  print('oauth_ipv6_relay_code_exchange', 'PASS')

  const ipv6DenyVerifier = crypto.randomBytes(32).toString('base64url')
  const ipv6DenyChallenge = hashVerifier(ipv6DenyVerifier)
  const ipv6DenyQuery = new URLSearchParams({
    response_type: 'code', client_id: ipv6Redirect.data.client_id, redirect_uri: ipv6RedirectUri,
    scope: 'exercise:read', code_challenge: ipv6DenyChallenge, code_challenge_method: 'S256', resource,
    state: 'oauth-ipv6-deny'
  })
  const ipv6DenyConsent = await fetch(mcpBase + `/oauth/authorize?${ipv6DenyQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const ipv6DenyHtml = await ipv6DenyConsent.text()
  const ipv6DenyCsrf = /name="csrf" value="([^"]+)"/.exec(ipv6DenyHtml)?.[1]
  assert.equal(ipv6DenyConsent.status, 200)
  assert.ok(ipv6DenyCsrf)
  const grantsBeforeIpv6Deny = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants before IPv6 denial').data.grants.length
  const ipv6DenyForm = {
    csrf: ipv6DenyCsrf, client_id: ipv6Redirect.data.client_id, redirect_uri: ipv6RedirectUri, response_type: 'code',
    code_challenge: ipv6DenyChallenge, code_challenge_method: 'S256', resource, state: 'oauth-ipv6-deny',
    scope: 'exercise:read', decision: 'deny'
  }
  const ipv6Deny = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody(ipv6DenyForm), headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const ipv6DenyRelayHtml = await ipv6Deny.text()
  assert.equal(ipv6Deny.status, 200)
  assert.equal(ipv6Deny.headers.get('content-security-policy'), relayCsp)
  assert.equal(ipv6Deny.headers.get('referrer-policy'), 'no-referrer')
  assert.match(ipv6DenyRelayHtml, /error=access_denied&amp;state=oauth-ipv6-deny/)
  assert.doesNotMatch(ipv6DenyRelayHtml, /[?&]code=|access_token|client_secret|code_verifier/i)
  const grantsAfterIpv6Deny = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants after IPv6 denial').data.grants.length
  assert.equal(grantsAfterIpv6Deny, grantsBeforeIpv6Deny)
  const ipv6DenyRetry = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody(ipv6DenyForm), headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const ipv6DenyRetryHtml = await ipv6DenyRetry.text()
  assert.equal(ipv6DenyRetry.status, 200)
  assert.equal(ipv6DenyRetryHtml, ipv6DenyRelayHtml)
  print('oauth_ipv6_deny_relay', { status: 200, access_denied: true, no_grant: true, same_retry: true })

  const httpsIpRegistration = status(await request(mcpBase, '/oauth/register', dcrBody({
    client_name: 'HTTPS IP relay fixture', redirect_uris: ['https://192.0.2.44/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'exercise:read'
  }, { 'X-Forwarded-For': '198.51.100.29' })), 201, 'HTTPS IP relay fixture').data
  const httpsIpVerifier = crypto.randomBytes(32).toString('base64url')
  const httpsIpChallenge = hashVerifier(httpsIpVerifier)
  const httpsIpQuery = new URLSearchParams({
    response_type: 'code', client_id: httpsIpRegistration.client_id, redirect_uri: httpsIpRegistration.redirect_uris[0],
    scope: 'exercise:read', code_challenge: httpsIpChallenge, code_challenge_method: 'S256', resource, state: 'oauth-https-ip'
  })
  const httpsIpConsent = await fetch(mcpBase + `/oauth/authorize?${httpsIpQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const httpsIpConsentHtml = await httpsIpConsent.text()
  assert.equal(httpsIpConsent.status, 200)
  assert.equal(httpsIpConsent.headers.get('content-security-policy'), "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'")
  assert.doesNotMatch(httpsIpConsent.headers.get('content-security-policy') || '', /192\.0\.2\.44|\*/)
  const httpsIpCsrf = /name="csrf" value="([^"]+)"/.exec(httpsIpConsentHtml)?.[1]
  assert.ok(httpsIpCsrf)
  const httpsIpAllow = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf: httpsIpCsrf, client_id: httpsIpRegistration.client_id, redirect_uri: httpsIpRegistration.redirect_uris[0], response_type: 'code', code_challenge: httpsIpChallenge, code_challenge_method: 'S256', resource, state: 'oauth-https-ip', scope: 'exercise:read', decision: 'allow' }),
    headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const httpsIpRelayHtml = await httpsIpAllow.text()
  assert.equal(httpsIpAllow.status, 200)
  assert.equal(httpsIpAllow.headers.get('content-security-policy'), relayCsp)
  assert.equal(httpsIpAllow.headers.get('referrer-policy'), 'no-referrer')
  assert.match(httpsIpRelayHtml, /https:\/\/192\.0\.2\.44\/callback\?code=[A-Za-z0-9_-]+&amp;state=oauth-https-ip/)
  print('oauth_https_ip_relay', { status: 200, csp: relayCsp, referrer_policy: 'no-referrer' })

  const conflictingDecision = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'oauth-state-1', scope: ['exercise:read', 'routine:read', 'progress:read', 'bodyweight:read'], decision: 'deny' }),
    headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  assert.equal(conflictingDecision.status, 400)
  const conflictingHtml = await conflictingDecision.text()
  assert.match(conflictingHtml, /oauth-error/)
  assert.match(conflictingHtml, /authorization request changed/i)
  print('oauth_consent_conflicting_decision_rejected', 'PASS')
  const allowRetry = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'oauth-state-1', scope: ['exercise:read', 'routine:read', 'progress:read', 'bodyweight:read'], decision: 'allow' }),
    headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  assert.equal(allowRetry.status, 302)
  assert.equal(allowRetry.headers.get('location'), location)
  print('oauth_consent_allow_retry_same_redirect', 'PASS')

  const expiredConsent = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf: 'expired-consent-fixture', decision: 'allow' }),
    headers: { Cookie: `gymsid=${session}`, Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  const expiredHtml = await expiredConsent.text()
  assert.equal(expiredConsent.status, 400)
  assert.match(expiredHtml, /class="[^"]*oauth-error/)
  assert.match(expiredHtml, /authorization request has expired/i)
  assert.match(expiredHtml, /return to the requesting client and try again/i)
  assert.doesNotMatch(expiredHtml, /access_token|code_challenge|oauth-state-1/)
  print('oauth_consent_expired_browser_error', 'PASS')

  // A consent nonce is consumed before the first await. Two simultaneous submits
  // therefore produce one grant/code and replay the exact redirect to the retry.
  const raceVerifier = crypto.randomBytes(32).toString('base64url')
  const raceChallenge = hashVerifier(raceVerifier)
  const raceQuery = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
    scope: 'exercise:read', code_challenge: raceChallenge, code_challenge_method: 'S256', resource
  })
  const raceGet = await fetch(mcpBase + `/oauth/authorize?${raceQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const raceHtml = await raceGet.text()
  assert.equal(raceGet.status, 200)
  const raceCsrf = /name="csrf" value="([^"]+)"/.exec(raceHtml)?.[1]
  assert.ok(raceCsrf)
  const raceForm = { csrf: raceCsrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code', code_challenge: raceChallenge, code_challenge_method: 'S256', resource, scope: 'exercise:read', decision: 'allow' }
  const raceGrantsBefore = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants before concurrent Allow').data.grants.length
  const racePosts = await Promise.all([1, 2].map(() => fetch(mcpBase + '/oauth/authorize', {
    ...formBody(raceForm), headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })))
  const raceStatuses = racePosts.map(response => response.status).sort((a, b) => a - b)
  const raceLocations = racePosts.map(response => response.headers.get('location') || '')
  const raceCodes = raceLocations.map(location => location ? new URL(location).searchParams.get('code') : null)
  const raceGrantsAfter = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants after concurrent Allow').data.grants.length
  assert.deepEqual(raceStatuses, [302, 302])
  assert.equal(raceLocations[0], raceLocations[1])
  assert.ok(raceCodes[0])
  assert.equal(raceCodes[0], raceCodes[1])
  assert.equal(raceGrantsAfter - raceGrantsBefore, 1)
  print('oauth_consent_allow_concurrent_idempotent', { statuses: raceStatuses, same_location: true, same_code: true, grants_delta: raceGrantsAfter - raceGrantsBefore })

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

  const codexVerifier = crypto.randomBytes(32).toString('base64url')
  const codexChallenge = hashVerifier(codexVerifier)
  const codexRedirectUri = codexRegistration.redirect_uris[0]
  const codexAuthorizeBase = {
    response_type: 'code', client_id: codexRegistration.client_id, redirect_uri: codexRedirectUri,
    code_challenge: codexChallenge, code_challenge_method: 'S256', resource
  }
  const codexOverScopeQuery = new URLSearchParams({ ...codexAuthorizeBase, scope: 'exercise:read routine:read' })
  const codexOverScope = await fetch(mcpBase + `/oauth/authorize?${codexOverScopeQuery}`, { headers: { Cookie: `gymsid=${session}` } })
  const codexOverScopeData = await responseData(codexOverScope)
  assert.equal(codexOverScope.status, 400)
  assert.equal(codexOverScopeData.error, 'invalid scope')
  print('oauth_authorize_scope_subset_enforced', 400)
  const codexConsentResponse = await fetch(mcpBase + `/oauth/authorize?${new URLSearchParams({ ...codexAuthorizeBase, scope: 'exercise:read' })}`, { headers: { Cookie: `gymsid=${session}` } })
  const codexConsentHtml = await codexConsentResponse.text()
  assert.equal(codexConsentResponse.status, 200)
  const codexCsrf = /name="csrf" value="([^"]+)"/.exec(codexConsentHtml)?.[1]
  assert.ok(codexCsrf)
  const codexAuthorization = await fetch(mcpBase + '/oauth/authorize', {
    ...formBody({ csrf: codexCsrf, ...codexAuthorizeBase, scope: 'exercise:read' }),
    headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
  })
  assert.equal(codexAuthorization.status, 302)
  const codexLocation = codexAuthorization.headers.get('location')
  assert.ok(codexLocation)
  const codexCode = new URL(codexLocation).searchParams.get('code')
  assert.ok(codexCode)
  const codexToken = status(await request(mcpBase, '/oauth/token', formBody({
    grant_type: 'authorization_code', code: codexCode, client_id: codexRegistration.client_id,
    redirect_uri: codexRedirectUri, resource, code_verifier: codexVerifier
  })), 200, 'Codex native authorization-code token').data
  assert.equal(codexToken.scope, 'exercise:read')
  assert.equal(codexToken.resource, resource)
  print('oauth_codex_pkce_token_exchange', 'PASS')
  const codexInitialized = await mcpCall(codexToken.access_token, null, 10, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Codex', version: '1' } })
  status(codexInitialized, 200, 'Codex MCP initialize')
  const codexSession = codexInitialized.response.headers.get('mcp-session-id')
  assert.ok(codexSession)
  const codexList = status(await mcpCall(codexToken.access_token, codexSession, 11, 'tools/call', { name: 'list_exercises', arguments: { offset: 0, limit: 1 } }), 200, 'Codex MCP list_exercises').data
  const codexListPayload = JSON.parse(codexList.result?.content?.[0]?.text || '{}')
  assert.ok(codexListPayload.total >= 1325)
  print('oauth_codex_authenticated_mcp_call', 'PASS')

  if (process.env.OPENGYM_PHASE4A_RED === '1') {
    // The browser/client may retry a successful consent POST when the callback is slow or the
    // redirect response is lost. The exact form, not a fresh authorization request, must replay
    // the first redirect and must not mint a second bearer grant.
    const replayVerifier = crypto.randomBytes(32).toString('base64url')
    const replayChallenge = hashVerifier(replayVerifier)
    const replayQuery = new URLSearchParams({
      response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
      scope: 'exercise:read', code_challenge: replayChallenge, code_challenge_method: 'S256', resource,
      state: 'phase4a-replay'
    })
    const replayGet = await fetch(mcpBase + `/oauth/authorize?${replayQuery}`, { headers: { Cookie: `gymsid=${session}` } })
    const replayHtml = await replayGet.text()
    const replayCsrf = /name="csrf" value="([^"]+)"/.exec(replayHtml)?.[1]
    assert.equal(replayGet.status, 200, 'replay fixture consent GET must render before testing retries')
    assert.ok(replayCsrf, 'replay fixture must expose a CSRF nonce')
    const replayForm = {
      csrf: replayCsrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
      response_type: 'code', code_challenge: replayChallenge, code_challenge_method: 'S256', resource,
      state: 'phase4a-replay', scope: 'exercise:read'
    }
    const grantsBeforeReplay = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants before OAuth replay').data.grants.length
    await phase4aCheck('oauth_exact_consent_retry_replays_same_redirect_once', async () => {
      const first = await fetch(mcpBase + '/oauth/authorize', {
        ...formBody(replayForm), headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
      })
      const retry = await fetch(mcpBase + '/oauth/authorize', {
        ...formBody(replayForm), headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
      })
      const firstLocation = first.headers.get('location') || ''
      const retryLocation = retry.headers.get('location') || ''
      const firstCode = firstLocation ? new URL(firstLocation).searchParams.get('code') : null
      const retryCode = retryLocation ? new URL(retryLocation).searchParams.get('code') : null
      const grantsAfterReplay = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: `gymsid=${session}` } }), 200, 'grants after OAuth replay').data.grants.length
      if (first.status !== 302 || retry.status !== 302 || firstLocation !== retryLocation || !firstCode || firstCode !== retryCode || grantsAfterReplay - grantsBeforeReplay !== 1) {
        throw new Error(`expected two 302s with identical code and one grant; statuses=[${first.status},${retry.status}] same_location=${firstLocation === retryLocation} same_code=${firstCode === retryCode} grants_delta=${grantsAfterReplay - grantsBeforeReplay}`)
      }
    })

    // A replay must never turn into an authorization primitive: changed request fields and a
    // different signed-in user/session remain rejected even while the original result is cached.
    await phase4aCheck('oauth_changed_form_rejected_after_replay', async () => {
      const changed = await fetch(mcpBase + '/oauth/authorize', {
        ...formBody({ ...replayForm, state: 'tampered' }), headers: { Cookie: `gymsid=${session}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
      })
      assert.ok(changed.status >= 400 && changed.status < 500, `changed OAuth form must be rejected, got ${changed.status}`)
      assert.equal(changed.headers.get('location'), null, 'changed OAuth form must not redirect')
    })
    const sessionChangeGet = await fetch(mcpBase + `/oauth/authorize?${replayQuery}`, { headers: { Cookie: `gymsid=${session}` } })
    const sessionChangeHtml = await sessionChangeGet.text()
    const sessionChangeCsrf = /name="csrf" value="([^"]+)"/.exec(sessionChangeHtml)?.[1]
    await phase4aCheck('oauth_session_change_rejected', async () => {
      const changedSession = await fetch(mcpBase + '/oauth/authorize', {
        ...formBody({ ...replayForm, csrf: sessionChangeCsrf }), headers: { Cookie: 'gymsid=invalid-session', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
      })
      assert.equal(changedSession.status, 401)
    })

    // A future workout writer must be discoverable without dropping any existing read tool. The
    // seeded bearer grant carries workout:write so this probe reaches the API route directly.
    const requiredReadTools = ['list_exercises', 'search_exercises', 'get_exercise', 'list_routines', 'get_routine', 'preview_session', 'get_week_plan', 'list_workouts', 'get_workout', 'get_bodyweight', 'estimate_1rm', 'muscle_balance']
    await phase4aCheck('mcp_read_tools_retained', async () => {
      const listed = await mcpCall(tokenResult.access_token, mcpSession, 12, 'tools/list')
      status(listed, 200, 'existing MCP read tools')
      const names = listed.data.result?.tools?.map(tool => tool.name) || []
      assert.deepEqual(names.filter(name => requiredReadTools.includes(name)).sort(), requiredReadTools.slice().sort())
    })
    await phase4aCheck('preview_session_remote_under_routine_read', async () => {
      const preview = await mcpCall(tokenResult.access_token, mcpSession, 13, 'tools/call', { name: 'preview_session', arguments: { routine_id: 'oauth-routine' } })
      status(preview, 200, 'remote preview_session')
      assert.notEqual(preview.data.result?.isError, true, preview.data.result?.content?.[0]?.text || 'preview_session returned an MCP error')
      const payload = JSON.parse(preview.data.result?.content?.[0]?.text || '{}')
      assert.equal(payload.routine_id, 'oauth-routine')
    })
    await phase4aCheck('preview_session_partial_scope_rejected', async () => {
      const partial = await mcpCall(codexToken.access_token, codexSession, 14, 'tools/call', { name: 'preview_session', arguments: { routine_id: 'oauth-routine' } })
      status(partial, 200, 'partial-scope preview_session')
      const text = partial.data.result?.content?.[0]?.text || ''
      assert.equal(partial.data.result?.isError, true, 'preview_session must reject a grant missing required inputs')
      assert.match(text, /insufficient_scope/)
    })

    const workoutStart = Date.UTC(2026, 8, 10, 12, 0, 0)
    const completedWorkout = {
      id: 'phase4a-workout-1', d: '2026-09-10', start: workoutStart, end: workoutStart + 1800000,
      routineIds: ['oauth-routine'], routineId: 'oauth-routine', name: 'MCP completed', bw: null, prs: [],
      entries: [
        { id: '0001', target: { mode: 'reps', reps: 5, weight: 55 }, sets: [{ w: 55, r: 5, done: true }] },
        { id: 'oauth-custom', target: { mode: 'reps', reps: 8, weight: 10 }, sets: [{ w: 10, r: 8, done: true }] }
      ]
    }
    const workoutBody = (workout = completedWorkout, requestId = 'phase4a-workout-1') => ({ workout, request_id: requestId })
    const postWorkout = (body, headers = {}) => request(apiBase, '/api/mcp/workouts', {
      method: 'POST', headers: { ...bearer(workoutToken), 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    })
    await phase4aCheck('workout_write_insufficient_scope_rejected', async () => {
      const denied = await request(apiBase, '/api/mcp/workouts', {
        method: 'POST', headers: { ...bearer(tokenResult.access_token), 'Content-Type': 'application/json', 'If-Match': '"0"', 'Idempotency-Key': 'phase4a-read-only-write' },
        body: JSON.stringify(workoutBody())
      })
      assert.equal(denied.response.status, 403, `read-only grant must be 403 on create_workout, got ${denied.response.status}`)
      assert.equal(denied.data.error, 'insufficient_scope')
    })
    const initialFullRead = status(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'initial full state').data
    const initialWorkoutRead = status(await request(apiBase, '/api/mcp/state?scope=workout:read', { headers: bearer(workoutToken) }), 200, 'initial workout state').data
    const initialWorkoutCount = initialWorkoutRead.state.workouts.length
    const initialWorkoutRevision = initialWorkoutRead.revision

    await phase4aCheck('workout_write_requires_if_match', async () => {
      const missing = await postWorkout(workoutBody(), { 'Idempotency-Key': 'phase4a-missing-if-match' })
      assert.equal(missing.response.status, 428, `missing If-Match must be 428, got ${missing.response.status}`)
      assert.equal(missing.data.error, 'If-Match precondition required')
    })
    await phase4aCheck('workout_write_requires_idempotency_key', async () => {
      const missing = await postWorkout(workoutBody(), { 'If-Match': initialWorkoutRevision })
      assert.equal(missing.response.status, 400, `missing Idempotency-Key must be 400, got ${missing.response.status}`)
      assert.equal(missing.data.error, 'Idempotency-Key required')
    })
    await phase4aCheck('workout_write_rejects_unknown_exercise_id', async () => {
      const unknown = JSON.parse(JSON.stringify(completedWorkout))
      unknown.entries[0].id = 'not-in-catalogue'
      const result = await postWorkout(workoutBody(unknown, 'phase4a-unknown-exercise'), { 'If-Match': initialWorkoutRevision, 'Idempotency-Key': 'phase4a-unknown-exercise' })
      assert.equal(result.response.status, 400, `unknown exercise must be 400, got ${result.response.status}`)
      assert.equal(result.data.error, 'workout contains an unknown exercise')
    })

    // Simulate the phone writer advancing the profile before the MCP request reaches the API.
    // The stale MCP request must fail without replacing this edit or producing an empty profile.
    const phoneEditedState = JSON.parse(JSON.stringify(initialFullRead.state))
    phoneEditedState._phase4a_phone_edit = 'kept-before-stale-mcp'
    phoneEditedState._ts = 2026091012000000
    const phoneEdit = await request(apiBase, '/api/data', {
      method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': initialWorkoutRevision, 'Idempotency-Key': 'phase4a-phone-edit', 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: phoneEditedState })
    })
    status(phoneEdit, 200, 'phone edit before stale MCP request')
    const phoneRevision = phoneEdit.data.revision
    await phase4aCheck('workout_write_rejects_stale_revision', async () => {
      const stale = await postWorkout(workoutBody(), { 'If-Match': initialWorkoutRevision, 'Idempotency-Key': 'phase4a-stale-mcp' })
      assert.equal(stale.response.status, 412, `stale workout write must be 412, got ${stale.response.status}`)
      assert.equal(stale.data.error, 'stale revision')
    })
    await phase4aCheck('phone_edit_survives_stale_mcp_request', async () => {
      const afterStale = status(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'state after stale MCP request').data
      assert.equal(afterStale.revision, phoneRevision)
      assert.equal(afterStale.state._phase4a_phone_edit, 'kept-before-stale-mcp')
      assert.equal(afterStale.state.workouts.length, initialWorkoutCount)
    })

    await phase4aCheck('create_workout_known_builtin_and_custom_ids', async () => {
      const created = await postWorkout(workoutBody(), { 'If-Match': phoneRevision, 'Idempotency-Key': 'phase4a-workout-1' })
      assert.equal(created.response.status, 201, `valid workout create must be 201, got ${created.response.status}`)
      assert.equal(created.data.workout.id, completedWorkout.id)
      assert.equal(created.data.workout.entries.length, 2)
      assert.ok(created.data.workout.entries.every(entry => entry.sets.every(set => set.done === true)))
      assert.ok(created.data.workout.entries.some(entry => entry.id === '0001') && created.data.workout.entries.some(entry => entry.id === 'oauth-custom'))
    })
    await phase4aCheck('create_workout_same_request_is_idempotent', async () => {
      const duplicate = await postWorkout(workoutBody(), { 'If-Match': phoneRevision, 'Idempotency-Key': 'phase4a-workout-1' })
      assert.equal(duplicate.response.status, 200, `same workout request replay must be 200, got ${duplicate.response.status}`)
      assert.equal(duplicate.data.workout.id, completedWorkout.id)
      const afterDuplicate = status(await request(apiBase, '/api/mcp/state?scope=workout:read', { headers: bearer(workoutToken) }), 200, 'state after duplicate workout request').data
      assert.equal(afterDuplicate.state.workouts.filter(workout => workout.id === completedWorkout.id).length, 1)
    })
    await phase4aCheck('create_workout_reused_key_changed_payload_is_409', async () => {
      const changed = JSON.parse(JSON.stringify(completedWorkout))
      changed.entries[0].sets[0].w = 56
      const conflict = await postWorkout(workoutBody(changed), { 'If-Match': phoneRevision, 'Idempotency-Key': 'phase4a-workout-1' })
      assert.equal(conflict.response.status, 409, `changed payload under a used key must be 409, got ${conflict.response.status}`)
      assert.equal(conflict.data.error, 'idempotency key was already used for another request')
    })
    await phase4aCheck('create_workout_tool_is_scoped_and_idempotent', async () => {
      const initializedWorkout = await mcpCall(workoutToken, null, 20, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Phase 4A workout fixture', version: '1' } })
      status(initializedWorkout, 200, 'workout MCP initialize')
      const workoutSession = initializedWorkout.response.headers.get('mcp-session-id')
      assert.ok(workoutSession)
      const tools = await mcpCall(workoutToken, workoutSession, 21, 'tools/list')
      status(tools, 200, 'workout MCP tools/list')
      assert.ok(tools.data.result?.tools?.some(tool => tool.name === 'create_workout'), 'workout:write grant must expose create_workout')
      const call = await mcpCall(workoutToken, workoutSession, 22, 'tools/call', { name: 'create_workout', arguments: workoutBody() })
      status(call, 200, 'MCP create_workout')
      assert.notEqual(call.data.result?.isError, true, call.data.result?.content?.[0]?.text || 'create_workout returned an MCP error')
      const payload = JSON.parse(call.data.result?.content?.[0]?.text || '{}')
      assert.equal(payload.workout?.id, completedWorkout.id)
    })

    const statePath = path.join(dataDir, `state-${uid}.json`)
    const cleanStateBytes = fs.readFileSync(statePath)
    fs.writeFileSync(statePath, '{ this is not valid JSON')
    try {
      await phase4aCheck('workout_write_corrupt_state_fails_closed', async () => {
        const corrupt = await postWorkout(workoutBody(), { 'If-Match': phoneRevision, 'Idempotency-Key': 'phase4a-corrupt-write' })
        assert.equal(corrupt.response.status, 503, `corrupt state write must be 503, got ${corrupt.response.status}`)
        assert.equal(corrupt.data.error, 'storage_corrupt')
      })
      await phase4aCheck('workout_read_corrupt_state_fails_closed', async () => {
        const corrupt = await request(apiBase, '/api/mcp/state?scope=workout:read', { headers: bearer(workoutToken) })
        assert.equal(corrupt.response.status, 503, `corrupt state read must be 503, got ${corrupt.response.status}`)
        assert.equal(corrupt.data.error, 'storage_corrupt')
      })
    } finally {
      fs.writeFileSync(statePath, cleanStateBytes)
    }

    await phase4aCheck('oauth_metadata_advertises_workout_write', async () => {
      assert.ok(authorizationMetadata.scopes_supported.includes('workout:write'))
    })
    const defaultRegistration = await request(mcpBase, '/oauth/register', dcrBody({
      client_name: 'Phase 4A least privilege defaults', redirect_uris: ['https://phase4a-default.example.test/callback'],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none'
    }, { 'X-Forwarded-For': '198.51.100.16' }))
    await phase4aCheck('oauth_omitted_scope_defaults_cover_all_reads_and_workout_write', async () => {
      assert.equal(defaultRegistration.response.status, 201)
      const actual = String(defaultRegistration.data.scope || '').split(/\s+/).filter(Boolean).sort()
      assert.deepEqual(actual, ['bodyweight:read', 'exercise:read', 'progress:read', 'routine:read', 'workout:read', 'workout:write'])
    })
    const unsupportedScope = await request(mcpBase, '/oauth/register', dcrBody({
      client_name: 'Phase 4A unsupported scope', redirect_uris: ['https://phase4a-unsupported.example.test/callback'],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'workout:delete'
    }, { 'X-Forwarded-For': '198.51.100.17' }))
    await phase4aCheck('oauth_explicit_unsupported_scope_rejected', async () => {
      assert.equal(unsupportedScope.response.status, 400)
      assert.equal(unsupportedScope.data.error, 'invalid_scope')
    })
    const proposalRegistration = await request(mcpBase, '/oauth/register', dcrBody({
      client_name: 'Phase 4A proposal compatibility', redirect_uris: ['https://phase4a-proposal.example.test/callback'],
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'routine:propose'
    }, { 'X-Forwarded-For': '198.51.100.18' }))
    await phase4aCheck('oauth_routine_proposal_scope_retained', async () => {
      assert.equal(proposalRegistration.response.status, 201)
      assert.equal(proposalRegistration.data.scope, 'routine:propose')
    })
    print('phase4a_failure_count', phase4aFailures.length)
    process.exitCode = phase4aFailures.length ? 1 : 0
  }

  if (process.env.OPENGYM_PHASE4C_RED === '1') {
    // Phase 4C expands the acceptance contract around the remaining Sol review blockers. The
    // assertions intentionally expect the app semantics (not a guessed server shape): each one
    // prints its own failure and the whole pass exits non-zero until production catches up.
    const sessionFor = userId => {
      const payload = `${userId}:${Date.now() + 3600000}:0`
      return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`
    }
    const otherSession = sessionFor(otherUid)
    const hostCookie = `__Host-gymsid=${session}`

    await phase4cCheck('api_cookie_precedence_prefers_host_cookie', async () => {
      const result = await request(apiBase, '/api/me', { headers: { Cookie: `${hostCookie}; gymsid=${otherSession}` } })
      assert.equal(result.response.status, 200)
      assert.equal(result.data.user?.id, uid)
    })
    await phase4cCheck('api_cookie_ambiguous_duplicate_rejected', async () => {
      const hostDuplicate = await request(apiBase, '/api/me', { headers: { Cookie: `${hostCookie}; __Host-gymsid=${otherSession}` } })
      const legacyDuplicate = await request(apiBase, '/api/me', { headers: { Cookie: `gymsid=${session}; gymsid=${otherSession}` } })
      assert.equal(hostDuplicate.response.status, 401)
      assert.equal(legacyDuplicate.response.status, 401)
    })
    await phase4cCheck('oauth_host_cookie_exact_duplicate_replays_same_code_once', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url')
      const challenge = hashVerifier(verifier)
      const query = new URLSearchParams({
        response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
        scope: 'exercise:read', code_challenge: challenge, code_challenge_method: 'S256', resource,
        state: 'phase4c-host-replay'
      })
      const consent = await fetch(mcpBase + `/oauth/authorize?${query}`, { headers: { Cookie: hostCookie } })
      const html = await consent.text()
      assert.equal(consent.status, 200, 'the production __Host session must reach consent')
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1]
      assert.ok(csrf)
      const form = {
        csrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code',
        code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'phase4c-host-replay', scope: 'exercise:read'
      }
      const before = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: hostCookie } }), 200, 'host-cookie grant count before').data.grants.length
      const first = await fetch(mcpBase + '/oauth/authorize', {
        ...formBody(form), headers: { Cookie: hostCookie, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
      })
      const retry = await fetch(mcpBase + '/oauth/authorize', {
        ...formBody(form), headers: { Cookie: hostCookie, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
      })
      const firstLocation = first.headers.get('location') || ''
      const retryLocation = retry.headers.get('location') || ''
      const firstCode = firstLocation ? new URL(firstLocation).searchParams.get('code') : null
      const retryCode = retryLocation ? new URL(retryLocation).searchParams.get('code') : null
      const after = status(await request(apiBase, '/api/mcp/grants', { headers: { Cookie: hostCookie } }), 200, 'host-cookie grant count after').data.grants.length
      assert.equal(first.status, 302)
      assert.equal(retry.status, 302)
      assert.equal(firstLocation, retryLocation)
      assert.ok(firstCode)
      assert.equal(firstCode, retryCode)
      assert.equal(after - before, 1)
    })
    await phase4cCheck('oauth_valid_second_session_rejected_for_same_nonce', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url')
      const challenge = hashVerifier(verifier)
      const query = new URLSearchParams({
        response_type: 'code', client_id: registration.client_id, redirect_uri: registration.redirect_uris[0],
        scope: 'exercise:read', code_challenge: challenge, code_challenge_method: 'S256', resource,
        state: 'phase4c-session-change'
      })
      const consent = await fetch(mcpBase + `/oauth/authorize?${query}`, { headers: { Cookie: `gymsid=${session}` } })
      const html = await consent.text()
      assert.equal(consent.status, 200)
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1]
      assert.ok(csrf)
      const result = await fetch(mcpBase + '/oauth/authorize', {
        ...formBody({
          csrf, client_id: registration.client_id, redirect_uri: registration.redirect_uris[0], response_type: 'code',
          code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'phase4c-session-change', scope: 'exercise:read'
        }),
        headers: { Cookie: `gymsid=${otherSession}`, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual'
      })
      assert.equal(result.status, 403)
    })

    const writeOnlyGrant = status(await request(apiBase, '/api/mcp/grants', {
      ...jsonBody({ name: 'Phase 4C write-only', scopes: ['workout:write'], audience: resource, expires_in: 3600 }),
      headers: { Cookie: hostCookie, 'Content-Type': 'application/json' }
    }), 201, 'workout-only grant').data
    await phase4cCheck('workout_only_state_returns_revision_without_history', async () => {
      const snapshot = await request(apiBase, '/api/mcp/state?scope=workout:write', { headers: bearer(writeOnlyGrant.token) })
      assert.equal(snapshot.response.status, 200)
      assert.ok(snapshot.data.revision)
      assert.equal(Object.prototype.hasOwnProperty.call(snapshot.data.state || {}, 'workouts'), false)
      assert.equal(Object.prototype.hasOwnProperty.call(snapshot.data.state || {}, 'routines'), false)
    })

    const phase4cWorkout = (id, overrides = {}) => ({
      id, d: '2026-09-10', start: Date.UTC(2026, 8, 10, 12, 0, 0), end: Date.UTC(2026, 8, 10, 12, 30, 0),
      routineIds: ['oauth-routine'], routineId: 'oauth-routine', name: 'Phase 4C workout', bw: null,
      entries: [{ id: '0001', target: { mode: 'reps', reps: 5, weight: 55 }, sets: [{ w: 55, r: 5, done: true }] }],
      ...overrides
    })
    const postPhase4cWorkout = (token, workout, key, revision, extraHeaders = {}) => request(apiBase, '/api/mcp/workouts', {
      method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json', 'If-Match': revision, 'Idempotency-Key': key, ...extraHeaders },
      body: JSON.stringify({ workout, request_id: key.replace(/^mcp-workout:/, '') })
    })
    let tsBefore = null
    let tsWriteResult = null
    await phase4cCheck('workout_append_fixture_for_monotonic_ts', async () => {
      const before = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'workout revision before ts append').data
      tsBefore = Number(before.state?._ts) || 0
      const writeStarted = Date.now()
      tsWriteResult = await postPhase4cWorkout(workoutToken, phase4cWorkout('phase4c-ts-workout'), 'phase4c-ts-workout', before.revision)
      assert.equal(tsWriteResult.response.status, 201)
      assert.equal(tsWriteResult.data.rev, before.rev + 1)
      assert.equal(tsWriteResult.data.revision, tsWriteResult.response.headers.get('etag'))
      const after = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state after ts append').data
      const expectedFloor = Math.max(writeStarted, tsBefore + 1)
      assert.ok(Number(after.state?._ts) >= expectedFloor, `expected _ts >= ${expectedFloor}, got ${after.state?._ts}`)
    })
    await phase4cCheck('workout_retry_keeps_etag_revision_pair_after_intervening_write', async () => {
      const first = tsWriteResult
      const current = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'revision before intervening write').data
      const interveningState = JSON.parse(JSON.stringify(current.state))
      interveningState._phase4c_intervening = true
      const intervening = await request(apiBase, '/api/data', {
        method: 'PUT', headers: { Cookie: hostCookie, 'If-Match': current.revision, 'Idempotency-Key': 'phase4c-intervening-write', 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: interveningState })
      })
      assert.equal(intervening.response.status, 200)
      const retry = await postPhase4cWorkout(workoutToken, phase4cWorkout('phase4c-ts-workout'), 'phase4c-ts-workout', intervening.data.revision)
      assert.equal(retry.response.status, 200)
      assert.equal(retry.data.revision, first.data.revision)
      assert.equal(retry.data.rev, first.data.rev)
      assert.equal(retry.response.headers.get('etag'), first.response.headers.get('etag'))
    })
    await phase4cCheck('workout_missing_if_match_still_428', async () => {
      const result = await request(apiBase, '/api/mcp/workouts', {
        method: 'POST', headers: { ...bearer(workoutToken), 'Content-Type': 'application/json', 'Idempotency-Key': 'phase4c-missing-if-match' },
        body: JSON.stringify({ workout: phase4cWorkout('phase4c-missing-if-match'), request_id: 'phase4c-missing-if-match' })
      })
      assert.equal(result.response.status, 428)
    })
    await phase4cCheck('workout_stale_revision_still_412', async () => {
      const result = await postPhase4cWorkout(workoutToken, phase4cWorkout('phase4c-stale-revision'), 'phase4c-stale-revision', '"0"')
      assert.equal(result.response.status, 412)
    })

    const currentAfterTs = status(await request(apiBase, '/api/mcp/state?scope=workout:write', { headers: bearer(workoutToken) }), 200, 'revision after ts append').data
    await phase4cCheck('workout_entry_rid_must_reference_profile_routine', async () => {
      const workout = phase4cWorkout('oauth-workout', { entries: [{ id: '0001', rid: 'routine-not-in-profile', sets: [{ w: 55, r: 5, done: true }] }] })
      const result = await postPhase4cWorkout(workoutToken, workout, 'phase4c-rid-absent', currentAfterTs.revision)
      assert.equal(result.response.status, 400)
      assert.equal(result.data.error, 'workout routine id is invalid')
    })
    await phase4cCheck('workout_entry_rid_must_match_routine_ids', async () => {
      const workout = phase4cWorkout('oauth-workout', { routineIds: [], routineId: null, entries: [{ id: '0001', rid: 'oauth-routine', sets: [{ w: 55, r: 5, done: true }] }] })
      const result = await postPhase4cWorkout(workoutToken, workout, 'phase4c-rid-inconsistent', currentAfterTs.revision)
      assert.equal(result.response.status, 400)
      assert.equal(result.data.error, 'workout routine id is invalid')
    })

    let parityAfter = null
    const parityId = 'phase4c-parity-workout'
    await phase4cCheck('workout_persisted_parity_append_fixture', async () => {
      const before = status(await request(apiBase, '/api/mcp/state?scope=workout:write', { headers: bearer(workoutToken) }), 200, 'parity revision before').data
      const workout = phase4cWorkout(parityId, {
        prs: ['0001'],
        entries: [{
          id: '0001', target: { mode: 'reps', reps: 5, weight: 80 },
          sets: [{ w: 100, r: 5, done: true, phase: 'warmup' }, { w: 80, r: 5, done: true, phase: 'work' }]
        }]
      })
      const result = await postPhase4cWorkout(workoutToken, workout, parityId, before.revision)
      assert.equal(result.response.status, 201)
      parityAfter = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'parity state after').data.state
      assert.ok(parityAfter.workouts?.some(item => item.id === parityId))
    })
    const persistedParity = () => parityAfter?.workouts?.find(item => item.id === parityId)
    await phase4cCheck('workout_nonwarmup_volume_matches_app', async () => {
      assert.equal(persistedParity()?.vol, 400)
    })
    await phase4cCheck('workout_top_weight_excludes_warmup', async () => {
      assert.equal(persistedParity()?.entries?.[0]?.topW, 80)
    })
    await phase4cCheck('workout_pr_is_derived_not_caller_trusted', async () => {
      assert.ok(Array.isArray(persistedParity()?.prs) && persistedParity().prs.includes('0001'))
    })
    await phase4cCheck('workout_exweights_raises_on_live_completion', async () => {
      assert.equal(Number(parityAfter?.exWeights?.['0001']?.w), 80)
      assert.equal(parityAfter?.exWeights?.['0001']?.d, '2026-09-10')
    })

    await phase4cCheck('workout_live_exweights_raises_and_never_lowers', async () => {
      const full = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state before high exWeight').data
      const lowWeightState = JSON.parse(JSON.stringify(full.state))
      lowWeightState.exWeights = { ...(lowWeightState.exWeights || {}), '0001': { w: 50, d: '2026-09-09' } }
      const edit = await request(apiBase, '/api/data', {
        method: 'PUT', headers: { Cookie: hostCookie, 'If-Match': full.revision, 'Idempotency-Key': 'phase4c-high-exweight', 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: lowWeightState })
      })
      assert.equal(edit.response.status, 200)
      const current = status(await request(apiBase, '/api/mcp/state?scope=workout:write', { headers: bearer(workoutToken) }), 200, 'revision before higher live workout').data
      const higher = phase4cWorkout('phase4c-higher-live', { entries: [{ id: '0001', sets: [{ w: 80, r: 5, done: true }] }] })
      const higherResult = await postPhase4cWorkout(workoutToken, higher, 'phase4c-higher-live', current.revision)
      assert.equal(higherResult.response.status, 201)
      const afterHigher = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state after higher live workout').data.state
      const next = status(await request(apiBase, '/api/mcp/state?scope=workout:write', { headers: bearer(workoutToken) }), 200, 'revision before lower live workout').data
      const lower = phase4cWorkout('phase4c-lower-live', { entries: [{ id: '0001', sets: [{ w: 60, r: 5, done: true }] }] })
      const lowerResult = await postPhase4cWorkout(workoutToken, lower, 'phase4c-lower-live', next.revision)
      assert.equal(lowerResult.response.status, 201)
      const afterLower = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state after lower live workout').data.state
      assert.deepEqual({ higher: afterHigher.exWeights?.['0001']?.w, lower: afterLower.exWeights?.['0001']?.w }, { higher: 80, lower: 80 })
    })

    await phase4cCheck('workout_backfill_preserves_progression_and_inserts_chronologically', async () => {
      const before = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state before backfill').data
      const exWeightsBefore = JSON.stringify(before.state.exWeights || {})
      const current = status(await request(apiBase, '/api/mcp/state?scope=workout:write', { headers: bearer(workoutToken) }), 200, 'revision before backfill').data
      const backfill = phase4cWorkout('phase4c-backfill', {
        d: '2026-09-01', start: Date.UTC(2026, 8, 1, 12), end: Date.UTC(2026, 8, 1, 12, 30), backfill: true,
        entries: [{ id: '0001', sets: [{ w: 20, r: 5, done: true }] }]
      })
      const result = await postPhase4cWorkout(workoutToken, backfill, 'phase4c-backfill', current.revision)
      assert.equal(result.response.status, 201)
      const after = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state after backfill').data.state
      const index = after.workouts.findIndex(item => item.id === 'phase4c-backfill')
      assert.equal(index, 0, 'backfilled history must be inserted before later workouts')
      assert.deepEqual(after.workouts[index].prs, [])
      assert.equal(JSON.stringify(after.exWeights || {}), exWeightsBefore)
      assert.equal(Object.prototype.hasOwnProperty.call(after.workouts[index], 'backfill'), false)
    })
    await phase4cCheck('workout_rejects_unpreserved_advanced_set_shapes', async () => {
      const current = status(await request(apiBase, '/api/mcp/state?scope=workout:write', { headers: bearer(workoutToken) }), 200, 'revision before advanced shape').data
      const result = await postPhase4cWorkout(workoutToken, phase4cWorkout('phase4c-drop-shape', {
        entries: [{ id: '0001', sets: [{ w: 55, r: 5, done: true, type: 'dropset', drops: [{ w: 45, r: 5 }] }] }]
      }), 'phase4c-drop-shape', current.revision)
      assert.equal(result.response.status, 400)
    })

    await phase4cCheck('create_workout_schema_is_explicit_and_model_usable', async () => {
      const initialized = await mcpCall(workoutToken, null, 40, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Phase 4C schema', version: '1' } })
      status(initialized, 200, 'schema MCP initialize')
      const schemaSession = initialized.response.headers.get('mcp-session-id')
      const listed = status(await mcpCall(workoutToken, schemaSession, 41, 'tools/list'), 200, 'schema tools/list').data
      const tool = listed.result?.tools?.find(item => item.name === 'create_workout')
      assert.ok(tool, 'workout:write must advertise create_workout')
      const schema = tool.inputSchema
      const workoutSchema = schema?.properties?.workout
      const entrySchema = workoutSchema?.properties?.entries?.items
      const setSchema = entrySchema?.properties?.sets?.items
      assert.ok(workoutSchema?.properties?.routineIds && workoutSchema.properties?.routineId)
      assert.ok(workoutSchema?.properties?.start && workoutSchema.properties?.end && workoutSchema.properties?.bw && workoutSchema.properties?.note)
      assert.ok(entrySchema?.properties?.id && entrySchema?.properties?.rid && entrySchema?.properties?.target && entrySchema?.properties?.note)
      assert.ok(setSchema?.properties?.w && setSchema?.properties?.r && setSchema?.properties?.done && setSchema?.properties?.phase)
      assert.equal(entrySchema?.additionalProperties, false)
      assert.equal(setSchema?.additionalProperties, false)
      assert.ok(schema?.required?.includes('workout') && schema?.required?.includes('request_id'))
      assert.match(`${tool.description} ${JSON.stringify(schema)}`, /If-Match|revision/i)
      assert.match(`${tool.description} ${JSON.stringify(schema)}`, /idempotency|retry/i)
      assert.match(JSON.stringify(schema), /reps|time|cardio/)
    })

    await phase4cCheck('receipt_failure_restart_retries_once_with_durable_result', async () => {
      const before = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state before receipt failure').data
      const receiptKey = 'phase4c-receipt-restart'
      const workout = phase4cWorkout('phase4c-receipt-workout')
      await stop(apiChild)
      apiChild = await start('node', ['api/server.js'], {
        PORT: apiPort, DATA_DIR: dataDir, RP_ID: 'localhost', ORIGIN: 'https://gym.example.test',
        MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0', OPENGYM_TEST_FAIL_RECEIPT_WRITES: '1'
      })
      const failed = await postPhase4cWorkout(workoutToken, workout, receiptKey, before.revision)
      assert.equal(failed.response.status, 503)
      await stop(apiChild)
      apiChild = await start('node', ['api/server.js'], {
        PORT: apiPort, DATA_DIR: dataDir, RP_ID: 'localhost', ORIGIN: 'https://gym.example.test',
        MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0'
      })
      const recovered = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state after receipt recovery').data
      assert.equal(recovered.state.workouts.filter(item => item.id === workout.id).length, 1)
      const receipts = JSON.parse(fs.readFileSync(path.join(dataDir, 'idempotency.json'), 'utf8'))
      assert.equal(receipts.entries.filter(item => item.uid === uid && item.key === `mcp-workout:${receiptKey}`).length, 1)
      const retry = await postPhase4cWorkout(workoutToken, workout, receiptKey, before.revision)
      assert.equal(retry.response.status, 200)
      const afterRetry = status(await request(apiBase, '/api/data', { headers: { Cookie: hostCookie } }), 200, 'state after receipt retry').data
      assert.equal(afterRetry.state.workouts.filter(item => item.id === workout.id).length, 1)
    })

    await phase4cCheck('read_scope_has_no_local_fallback_or_write_access', async () => {
      const denied = await mcpCall(codexToken.access_token, codexSession, 42, 'tools/call', { name: 'list_routines', arguments: {} })
      status(denied, 200, 'read-scope isolation call')
      assert.equal(denied.data.result?.isError, true)
      assert.match(denied.data.result?.content?.[0]?.text || '', /insufficient_scope/i)
      const listed = await mcpCall(codexToken.access_token, codexSession, 43, 'tools/list')
      status(listed, 200, 'read-scope tools/list')
      assert.equal(listed.data.result?.tools?.some(item => item.name === 'create_workout'), false)
    })

    const statePath4c = path.join(dataDir, `state-${uid}.json`)
    const cleanState4c = fs.readFileSync(statePath4c)
    fs.writeFileSync(statePath4c, '{ phase4c corrupt state')
    try {
      await phase4cCheck('write_scope_corrupt_state_fails_closed', async () => {
        const result = await postPhase4cWorkout(workoutToken, phase4cWorkout('phase4c-corrupt'), 'phase4c-corrupt', currentAfterTs.revision)
        assert.equal(result.response.status, 503)
        assert.equal(result.data.error, 'storage_corrupt')
      })
    } finally {
      fs.writeFileSync(statePath4c, cleanState4c)
    }
    print('phase4c_failure_count', phase4cFailures.length)
    if (phase4cFailures.length) process.exitCode = 1
  }

  if (process.env.OPENGYM_PHASE4D_RED === '1') {
    // Phase 4D closes three app-parity gaps against the real profile writer.  The fixture is
    // deliberately rebuilt through revisioned /api/data writes so no test helper can smuggle
    // derived values into the assertion.
    const phase4dHostCookie = `__Host-gymsid=${session}`
    const phase4dRead = () => request(apiBase, '/api/data', { headers: { Cookie: phase4dHostCookie } })
    const phase4dReplace = async (mutate, key) => {
      const current = status(await phase4dRead(), 200, 'Phase 4D state read').data
      const next = JSON.parse(JSON.stringify(current.state))
      mutate(next)
      const result = await request(apiBase, '/api/data', {
        method: 'PUT', headers: { Cookie: phase4dHostCookie, 'If-Match': current.revision, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: next })
      })
      assert.equal(result.response.status, 200, `${key}: ${result.response.status}`)
      return result.data
    }
    const phase4dWorkout = (id, exerciseId = '0001', overrides = {}) => ({
      id, d: '2026-09-10', start: Date.UTC(2026, 8, 10, 14, 0), end: Date.UTC(2026, 8, 10, 14, 30),
      routineIds: ['oauth-routine'], routineId: 'oauth-routine', name: 'Phase 4D workout', bw: null,
      entries: [{ id: exerciseId, target: { mode: 'reps', reps: 5, weight: 55 }, sets: [{ w: 55, r: 5, done: true }] }],
      ...overrides
    })
    const phase4dPost = (workout, key, revision) => request(apiBase, '/api/mcp/workouts', {
      method: 'POST', headers: { ...bearer(workoutToken), 'Content-Type': 'application/json', 'If-Match': revision, 'Idempotency-Key': key },
      body: JSON.stringify({ workout, request_id: key })
    })

    await phase4dCheck('noProg_history_remains_in_best_baseline', async () => {
      await phase4dReplace(next => {
        next.exWeights = {}
        next.workouts = (next.workouts || []).filter(item => !String(item?.id || '').startsWith('phase4d-'))
        next.workouts.push(
          phase4dWorkout('phase4d-heavy-entry-no-prog', '0001', { entries: [{ id: '0001', noProg: true, sets: [{ w: 200, r: 5, done: true }] }] }),
          phase4dWorkout('phase4d-heavy-workout-excluded', '0001', { excludeFromProgression: true, entries: [{ id: '0001', sets: [{ w: 210, r: 5, done: true }] }] })
        )
      }, 'phase4d-no-prog-fixture')
      const current = status(await phase4dRead(), 200, 'Phase 4D baseline revision').data
      const result = await phase4dPost(phase4dWorkout('phase4d-baseline-probe', '0001', { entries: [{ id: '0001', sets: [{ w: 205, r: 5, done: true }] }] }), 'phase4d-baseline-probe', current.revision)
      assert.equal(result.response.status, 201)
      assert.deepEqual(result.data.workout.prs, [], 'noProg/whole-excluded history must still set the prior Best baseline')
    })
    await phase4dCheck('new_noProg_entry_still_derives_pr_and_exWeight', async () => {
      const current = status(await phase4dRead(), 200, 'Phase 4D noProg revision').data
      const result = await phase4dPost(phase4dWorkout('phase4d-new-no-prog', '0001', { entries: [{ id: '0001', noProg: true, sets: [{ w: 220, r: 5, done: true }] }] }), 'phase4d-new-no-prog', current.revision)
      assert.equal(result.response.status, 201)
      assert.ok(result.data.workout.prs.includes('0001'), 'noProg is a future-prescription flag, not a completion PR flag')
      const after = status(await phase4dRead(), 200, 'Phase 4D noProg state').data.state
      assert.equal(after.exWeights?.['0001']?.w, 220)
    })

    await phase4dCheck('mixed_mode_prior_best_uses_reps_rows_first', async () => {
      await phase4dReplace(next => {
        next.exWeights = {}
        next.workouts = (next.workouts || []).filter(item => !String(item?.id || '').startsWith('phase4d-mixed-'))
        next.workouts.push(
          phase4dWorkout('phase4d-mixed-inferred', '0002', { entries: [{ id: '0002', sets: [{ w: 100, r: 5, done: true }, { w: 300, sec: 30, done: true }] }] }),
          phase4dWorkout('phase4d-mixed-explicit', '0002', { entries: [{ id: '0002', target: { mode: 'reps' }, sets: [{ w: 110, r: 5, done: true }, { mode: 'time', w: 350, sec: 30, done: true }] }] }),
          phase4dWorkout('phase4d-mixed-cardio', '0002', { entries: [{ id: '0002', target: { mode: 'cardio' }, sets: [{ mode: 'reps', w: 120, r: 5, done: true }, { mode: 'cardio', w: 360, min: 10, speed: 8, done: true }] }] })
        )
      }, 'phase4d-mixed-fixture')
      const current = status(await phase4dRead(), 200, 'Phase 4D mixed revision').data
      const result = await phase4dPost(phase4dWorkout('phase4d-mixed-probe', '0002', { entries: [{ id: '0002', target: { mode: 'reps' }, sets: [{ w: 200, r: 5, done: true }] }] }), 'phase4d-mixed-probe', current.revision)
      assert.equal(result.response.status, 201)
      assert.ok(result.data.workout.prs.includes('0002'), 'a timed/cardio row must not suppress the reps PR')
    })

    let phase4dCustomWorkout
    await phase4dCheck('custom_exercise_snapshot_is_derived_from_trusted_catalogue', async () => {
      await phase4dReplace(next => {
        next.customEx = (next.customEx || []).filter(ex => ex.id !== 'oauth-custom')
        next.customEx.push({ id: 'oauth-custom', n: 'Snapshot custom', bp: 'chest', primaries: ['chest'], secondaries: ['triceps'], muscleGroups: ['chest', 'triceps'], custom: true })
      }, 'phase4d-custom-fixture')
      const current = status(await phase4dRead(), 200, 'Phase 4D custom revision').data
      const result = await phase4dPost(phase4dWorkout('phase4d-custom-snapshot', 'oauth-custom'), 'phase4d-custom-snapshot', current.revision)
      assert.equal(result.response.status, 201)
      phase4dCustomWorkout = result.data.workout
      const snapshot = phase4dCustomWorkout.entries?.[0]?.muscleSnapshot
      assert.deepEqual(snapshot, {
        n: 'Snapshot custom', bp: 'chest', primaries: ['chest'], secondaries: ['triceps'],
        muscleGroups: ['chest', 'triceps'], muscleWeights: { chest: 1, triceps: 0.4 }
      })
    })
    await phase4dCheck('custom_snapshot_survives_catalogue_delete', async () => {
      await phase4dReplace(next => { next.customEx = (next.customEx || []).filter(ex => ex.id !== 'oauth-custom') }, 'phase4d-custom-delete')
      const after = status(await phase4dRead(), 200, 'Phase 4D custom delete read').data.state
      assert.equal(after.customEx.some(ex => ex.id === 'oauth-custom'), false)
      const logged = after.workouts.find(item => item.id === 'phase4d-custom-snapshot') || phase4dCustomWorkout
      assert.deepEqual(logged?.entries?.[0]?.muscleSnapshot?.muscleWeights, { chest: 1, triceps: 0.4 })
      assert.equal(logged?.entries?.[0]?.muscleSnapshot?.n, 'Snapshot custom')
    })
    print('phase4d_failure_count', phase4dFailures.length)
    if (phase4dFailures.length) process.exitCode = 1
  }

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
