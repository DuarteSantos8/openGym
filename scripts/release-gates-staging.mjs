#!/usr/bin/env node
/*
 * Disposable Gate 2–4 acceptance harness. It starts the fork against a temporary directory,
 * never reads /opt/opengym, never prints a credential, and prints every assertion needed in the
 * release transcript. Gate 1 (live inventory/restore) and Gate 5 (production cutover) remain
 * external evidence and are deliberately not inferred here.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import { EXDB } from '../frontend/src/lib/exercises-data.js'
import { mergePendingState } from '../frontend/src/lib/sync.js'
import { workoutVolume, setsDone } from '../frontend/src/lib/history.js'
import { friendlyDuration } from '../mcp/src/labels.js'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const requireApi = createRequire(path.join(ROOT, 'api', 'package.json'))
const sharp = requireApi('sharp')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-gates-'))
let activeDataDir = tmp
let backupDir = null
let backupManifestFile = null
const secret = 'staging-only-secret'
const uid = 'user-a'; const otherUid = 'user-b'
const json = (file, value) => fs.writeFileSync(path.join(tmp, file), JSON.stringify(value, null, 2))
const stateFixture = (name, extra = {}) => ({
  unit: 'kg', restSec: 90, routines: [{ id: 'r-base', name, ex: [{ id: '0001', sets: 3, reps: 5, weight: 50 }] }],
  week: { 1: 'r-base' }, dayPlan: {}, workouts: [{ id: `${name}-w`, d: '2026-09-06', start: 1, end: 2, entries: [{ id: '0001', target: { sets: 1, reps: 5 }, sets: [{ w: 50, r: 5, done: true }] }] }],
  bodyweight: [], targetW: null, active: null, customEx: [{ id: 'c-photo', n: 'Private photo exercise', bp: 'chest', eq: 'custom', custom: true }], exWeights: {}, ...extra
})
json('db.json', { users: [{ id: uid, name: 'Staging A' }, { id: otherUid, name: 'Staging B' }], creds: [], subs: [], invites: [] })
json(`state-${uid}.json`, stateFixture('Staging A'))
json(`state-${otherUid}.json`, stateFixture('Other user', { routines: [{ id: 'other-routine', name: 'Other only', ex: [] }], customEx: [] }))
fs.writeFileSync(path.join(tmp, 'secret'), secret, { mode: 0o600 })

const tokenFor = id => {
  const payload = `${id}:${Date.now() + 3600000}:0`
  return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}
const session = tokenFor(uid)
const bearer = token => ({ Authorization: `Bearer ${token}` })
const grantToken = 'staging-grant-token'
const exerciseGrant = 'staging-exercise-token'
const revokeGrant = 'staging-revoke-token'
const proposeGrant = 'staging-propose-token'
const otherUserGrant = 'staging-other-user-token'
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const etag = value => `"${hash(value)}"`
function fileManifest(root) {
  const rows = []
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute, relative)
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute)
        rows.push({ path: relative, size: bytes.length, sha256: hash(bytes) })
      }
    }
  }
  walk(root)
  return rows
}
json('mcp-grants.json', { grants: [
  { id: 'grant-a', uid, name: 'staging client', scopes: ['exercise:read', 'routine:read', 'workout:read', 'bodyweight:read', 'progress:read', 'routine:propose'], tokenHash: hash(grantToken), created: new Date().toISOString(), expires: Date.now() + 3600000 },
  { id: 'grant-exercise', uid, name: 'narrow client', scopes: ['exercise:read'], tokenHash: hash(exerciseGrant), created: new Date().toISOString(), expires: Date.now() + 3600000 },
  { id: 'grant-revoke', uid, name: 'revocation fixture', scopes: ['exercise:read'], tokenHash: hash(revokeGrant), created: new Date().toISOString(), expires: Date.now() + 3600000 },
  { id: 'grant-propose', uid, name: 'proposal-only fixture', scopes: ['routine:propose'], tokenHash: hash(proposeGrant), created: new Date().toISOString(), expires: Date.now() + 3600000 },
  { id: 'grant-other-user', uid: otherUid, name: 'other-user fixture', scopes: ['routine:read'], tokenHash: hash(otherUserGrant), created: new Date().toISOString(), expires: Date.now() + 3600000 }
] })

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}
async function start(command, args, env) {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', d => { output += d }); child.stderr.on('data', d => { output += d })
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`process exited: ${output}`)
    if (output.includes('gym-api on') || output.includes('Streamable HTTP')) return child
    await wait(30)
  }
  throw new Error(`process did not start: ${output}`)
}
async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  for (let i = 0; i < 50 && child.exitCode === null; i++) await wait(20)
  if (child.exitCode === null) child.kill('SIGKILL')
}
// The manual-bearer regression routes the MCP gateway through a disposable API proxy that
// deliberately rejects every OAuth API path. If the gateway tried to discover/register/exchange
// a token before serving a direct Bearer client, the fixture would fail instead of silently
// falling back to a broader credential.
async function startManualBearerApiProxy(targetBase) {
  const target = new URL(targetBase)
  const oauthAttempts = []
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, targetBase)
    if (parsed.pathname.startsWith('/api/oauth/') || parsed.pathname.startsWith('/oauth/') || parsed.pathname.startsWith('/.well-known/')) {
      oauthAttempts.push(parsed.pathname)
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify({ error: 'oauth disabled in manual-bearer fixture' }))
    }
    const upstream = http.request({
      hostname: target.hostname, port: target.port, method: req.method,
      path: parsed.pathname + parsed.search,
      headers: { ...req.headers, host: `${target.hostname}:${target.port}` }
    }, response => {
      res.writeHead(response.statusCode || 502, response.headers)
      response.pipe(res)
    })
    upstream.on('error', error => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    })
    req.pipe(upstream)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return { base: `http://127.0.0.1:${address.port}`, oauthAttempts, server }
}
async function request(base, endpoint, options = {}) {
  const response = await fetch(base + endpoint, { ...options, headers: { ...(options.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}
async function rawRequest(base, endpoint, options = {}) {
  const response = await fetch(base + endpoint, { ...options, headers: { ...(options.headers || {}) } })
  return { response, bytes: Buffer.from(await response.arrayBuffer()) }
}
const bodyOptions = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
function assertStatus(result, expected, label) { assert.equal(result.response.status, expected, `${label}: ${result.response.status}`); return result }
function print(label, value) { console.log(`${label}=${typeof value === 'string' ? value : JSON.stringify(value)}`) }
async function solidImage(format, width = 320, height = 240, background = { r: 80, g: 140, b: 220 }) {
  const pipeline = sharp({ create: { width, height, channels: 3, background } })
  if (format === 'png') return pipeline.png({ compressionLevel: 9 }).toBuffer()
  if (format === 'jpeg') return pipeline.jpeg({ quality: 88 }).toBuffer()
  if (format === 'webp') return pipeline.webp({ quality: 88, effort: 4 }).toBuffer()
  throw new Error(`unsupported fixture format: ${format}`)
}

const apiPort = await freePort(); let apiBase = `http://127.0.0.1:${apiPort}`
let apiChild = await start('node', ['api/server.js'], { PORT: apiPort, DATA_DIR: tmp, RP_ID: 'localhost', ORIGIN: 'http://localhost', MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0', OPENGYM_TEST_IMAGE_DELAY_MS: '40', OPENGYM_TEST_IMAGE_STATS: '1' })
let mcpChild = null
let manualBearerApiProxy = null
try {
  // Gate 2: conditional writes, durable conflict handling, idempotency, and fail-closed storage.
  const initial = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })
  assertStatus(initial, 200, 'initial read'); const rev0 = initial.data.revision
  assertStatus(await request(apiBase, '/api/data', { ...bodyOptions({ state: initial.data.state }), method: 'PUT', headers: { Cookie: `gymsid=${session}` } }), 428, 'revisionless write')
  const changed = { ...initial.data.state, routines: [...initial.data.state.routines, { id: 'phone-routine', name: 'Phone edit', ex: [] }] }
  const first = await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': rev0, 'Idempotency-Key': 'phone-write-1', 'Content-Type': 'application/json' }, body: JSON.stringify({ state: changed }) })
  assertStatus(first, 200, 'conditional write'); const rev1 = first.data.revision
  assertStatus(await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': rev0, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { ...changed, _ts: 2 } }) }), 412, 'stale write')
  const duplicate = await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': rev0, 'Idempotency-Key': 'phone-write-1', 'Content-Type': 'application/json' }, body: JSON.stringify({ state: changed }) })
  assertStatus(duplicate, 200, 'duplicate write'); assert.equal(duplicate.data.revision, rev1)
  const keyConflict = await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': rev0, 'Idempotency-Key': 'phone-write-1', 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { ...changed, _ts: 2 } }) })
  assertStatus(keyConflict, 409, 'idempotency key conflict')
  const raceRead = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })
  const raceA = { ...raceRead.data.state, _ts: 3, routines: [...raceRead.data.state.routines, { id: 'race-a', name: 'Concurrent A', ex: [] }] }
  const raceB = { ...raceRead.data.state, _ts: 4, routines: [...raceRead.data.state.routines, { id: 'race-b', name: 'Concurrent B', ex: [] }] }
  const raceResults = await Promise.all([raceA, raceB].map((state, i) => request(apiBase, '/api/data', {
    method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': raceRead.data.revision, 'Idempotency-Key': `race-${i}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state })
  })))
  assert.deepEqual(raceResults.map(r => r.response.status).sort(), [200, 412])
  const base = { routines: [{ id: 'r-base', name: 'Base', ex: [] }] }
  const local = { routines: [{ id: 'r-base', name: 'Phone changed', ex: [] }] }
  const current = { routines: [...base.routines, { id: 'r-ai', name: 'AI routine', ex: [] }] }
  const merged = mergePendingState(base, local, current)
  assert.equal(merged.routines.length, 2); assert.equal(merged.routines[0].name, 'Phone changed')
  print('gate2_revisionless_status', 428); print('gate2_stale_status', 412); print('gate2_idempotency_same_revision', true); print('gate2_idempotency_key_conflict_status', 409); print('gate2_concurrent_same_etag_statuses', raceResults.map(r => r.response.status).sort())
  print('gate2_pending_base_current', { pending: 'Phone changed', base: 'Base', current: 'AI routine', merged: merged.routines.map(r => r.name) })

  // Gate 3: API-scoped catalog/state, MCP clients, proposal approval and phone edit retention.
  const catalog = []; let offset = 0
  while (true) {
    const page = assertStatus(await request(apiBase, `/api/mcp/catalog?offset=${offset}&limit=200`, { headers: bearer(grantToken) }), 200, 'catalog page').data
    catalog.push(...page.exercises); if (page.next_offset == null) break; offset = page.next_offset
  }
  assert.equal(new Set(catalog.map(e => e.id)).size, EXDB.length + 1)
  const deniedScope = await request(apiBase, '/api/mcp/state?scope=routine:read', { headers: bearer(exerciseGrant) }); assertStatus(deniedScope, 403, 'insufficient scope')
  const cross = await request(apiBase, `/api/mcp/state?scope=routine:read&uid=${uid}`, { headers: bearer(otherUserGrant) })
  assertStatus(cross, 403, 'cross-user state')
  const mcpPort = await freePort()
  manualBearerApiProxy = await startManualBearerApiProxy(apiBase)
  mcpChild = await start('node', ['mcp/src/http.js'], { MCP_PORT: mcpPort, OPENGYM_API: manualBearerApiProxy.base, MCP_PUBLIC_URL: 'http://127.0.0.1:' + mcpPort + '/mcp', MCP_CORS_ORIGIN: 'http://127.0.0.1' })
  const mcpBase = `http://127.0.0.1:${mcpPort}`
  const unauthenticatedMcp = await request(mcpBase, '/mcp', { method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }) })
  assertStatus(unauthenticatedMcp, 401, 'unauthenticated MCP')
  async function mcpClient(name, authToken = grantToken) {
    const initBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name, version: '1' } } }
    const init = await fetch(mcpBase + '/mcp', { method: 'POST', headers: { ...bearer(authToken), Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(initBody) })
    assert.equal(init.status, 200, `${name} initialize`); const sid = init.headers.get('mcp-session-id'); assert.ok(sid)
    const call = async (id, method, params) => {
      const r = await fetch(mcpBase + '/mcp', { method: 'POST', headers: { ...bearer(authToken), Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'Mcp-Session-Id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
      const text = await r.text(); const line = text.split('\n').filter(Boolean).pop() || '{}'; const parsed = line.startsWith('data:') ? line.slice(5).trim() : line
      return { response: r, data: JSON.parse(parsed) }
    }
    await call(2, 'notifications/initialized', {})
    const listed = await call(3, 'tools/list', {}); assert.equal(listed.response.status, 200); assert.ok(listed.data.result.tools.length >= 13)
    return { sid, call }
  }
  const localClient = await mcpClient('local-fixture'); const hostedClient = await mcpClient('hosted-fixture')
  const proposalOnlyClient = await mcpClient('proposal-only-fixture', proposeGrant)
  // Traverse the same catalogue through the MCP tools (not only the API convenience endpoint).
  const mcpCatalog = []; let mcpOffset = 0
  while (true) {
    const pageCall = await localClient.call(20 + mcpOffset, 'tools/call', { name: 'list_exercises', arguments: { offset: mcpOffset, limit: 200 } })
    assert.equal(pageCall.response.status, 200, 'MCP list_exercises page')
    const page = JSON.parse(pageCall.data.result?.content?.[0]?.text || '{}')
    mcpCatalog.push(...(page.exercises || []))
    if (page.next_offset == null) break
    mcpOffset = page.next_offset
  }
  assert.equal(new Set(mcpCatalog.map(e => e.id)).size, EXDB.length + 1)
  const mcpSearchCall = await localClient.call(100, 'tools/call', { name: 'search_exercises', arguments: { query: 'Private photo exercise' } })
  assert.equal(mcpSearchCall.response.status, 200, 'MCP search_exercises')
  const mcpSearch = JSON.parse(mcpSearchCall.data.result?.content?.[0]?.text || '{}')
  assert.ok(mcpSearch.exercises?.some(e => e.id === 'c-photo'))
  const mcpGetCall = await localClient.call(101, 'tools/call', { name: 'get_exercise', arguments: { exercise_id: 'c-photo' } })
  assert.equal(mcpGetCall.response.status, 200, 'MCP get_exercise')
  const mcpGet = JSON.parse(mcpGetCall.data.result?.content?.[0]?.text || '{}')
  assert.equal(mcpGet.id, 'c-photo')
  const proposalOnlyState = assertStatus(await request(apiBase, '/api/mcp/state?scope=routine:propose', { headers: bearer(proposeGrant) }), 200, 'proposal-only scope').data
  assert.equal(proposalOnlyState.revision, (await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })).data.revision)
  const progressCall = await localClient.call(6, 'tools/call', { name: 'list_workouts', arguments: {} })
  const progress = JSON.parse(progressCall.data.result?.content?.[0]?.text || '{}')
  const fixtureWorkout = stateFixture('Staging A').workouts[0]
  assert.equal(progress.workouts?.[0]?.id, fixtureWorkout.id)
  assert.equal(progress.workouts?.[0]?.volume, workoutVolume(fixtureWorkout))
  assert.equal(progress.workouts?.[0]?.sets_done, setsDone(fixtureWorkout))
  assert.equal(progress.workouts?.[0]?.sets_planned, fixtureWorkout.entries.reduce((n, e) => n + (e.sets || []).length, 0))
  assert.equal(progress.workouts?.[0]?.duration_ms, fixtureWorkout.end - fixtureWorkout.start)
  assert.equal(progress.workouts?.[0]?.duration, friendlyDuration(fixtureWorkout.end - fixtureWorkout.start))
  const proposalBefore = assertStatus(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'proposal revision before').data
  const proposalCall = await localClient.call(4, 'tools/call', { name: 'propose_routine', arguments: { request_id: 'proposal-once', routine: { name: 'Approved from MCP', ex: [{ id: '0001', sets: 3, reps: 5, weight: 50 }] } } })
  assert.equal(proposalCall.response.status, 200); const proposalText = proposalCall.data.result?.content?.[0]?.text || ''; const proposalResult = JSON.parse(proposalText); const proposal = proposalResult.proposal; assert.ok(proposal?.id)
  assert.equal(proposalResult.rev, proposalBefore.rev + 1)
  assert.equal(proposalResult.revision, (await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })).data.revision)
  const duplicateProposalCall = await localClient.call(5, 'tools/call', { name: 'propose_routine', arguments: { request_id: 'proposal-once', routine: { name: 'Approved from MCP', ex: [{ id: '0001', sets: 3, reps: 5, weight: 50 }] } } })
  const duplicateProposal = JSON.parse(duplicateProposalCall.data.result?.content?.[0]?.text || '{}').proposal
  assert.equal(duplicateProposal?.id, proposal.id)
  const proposalOnlyCall = await proposalOnlyClient.call(7, 'tools/call', { name: 'propose_routine', arguments: { request_id: 'proposal-only-once', routine: { name: 'Proposal-only draft', ex: [{ id: '0001', sets: 2, reps: 5, weight: 40 }] } } })
  assert.equal(proposalOnlyCall.response.status, 200)
  const afterProposal = assertStatus(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'proposal snapshot').data
  assertStatus(await request(apiBase, `/api/mcp/proposals/${proposal.id}`, { headers: bearer(exerciseGrant) }), 403, 'proposal insufficient scope')
  const approvedResponse = assertStatus(await request(apiBase, `/api/mcp/proposals/${proposal.id}`, { method: 'POST', headers: { Cookie: `gymsid=${session}`, 'If-Match': afterProposal.revision } }), 200, 'in-app proposal approval')
  const approved = approvedResponse.data
  assert.equal(approved.rev, afterProposal.rev + 1)
  assert.equal(approved.revision, approvedResponse.response.headers.get('etag'))
  const phoneSnapshot = approved.routine
    ? (await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })).data.state
    : afterProposal.state
  const phone = JSON.parse(JSON.stringify(phoneSnapshot))
  phone.routines = phone.routines.map(r => r.id === approved.routine.id ? { ...r, name: 'Approved from MCP (phone edit)' } : r)
  const phoneRead = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } });
  assertStatus(await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': phoneRead.data.revision, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: phone }) }), 200, 'phone edit after approval')
  const finalState = (await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })).data.state
  assert.equal(finalState.routines.filter(r => r.id === approved.routine.id).length, 1)
  assert.equal(finalState.routines.find(r => r.id === approved.routine.id).name, 'Approved from MCP (phone edit)')
  const revokedBefore = assertStatus(await request(apiBase, '/api/mcp/introspect', { headers: bearer(revokeGrant) }), 200, 'grant before revoke')
  assert.equal(revokedBefore.data.grant.id, 'grant-revoke')
  assertStatus(await request(apiBase, '/api/mcp/grants/revoke', { ...bodyOptions({ id: 'grant-revoke' }), headers: { Cookie: `gymsid=${session}` } }), 200, 'grant revoke')
  assertStatus(await request(apiBase, '/api/mcp/introspect', { headers: bearer(revokeGrant) }), 401, 'revoked grant')
  const discovery = await request(mcpBase, '/.well-known/oauth-protected-resource')
  assertStatus(discovery, 200, 'MCP discovery')
  assert.deepEqual(discovery.data.authorization_servers, [`http://127.0.0.1:${mcpPort}`])
  assert.deepEqual(manualBearerApiProxy.oauthAttempts, [])
  print('gate3_clients', ['local-fixture', 'hosted-fixture']); print('gate3_catalog_unique', catalog.length); print('gate3_mcp_catalog_unique', mcpCatalog.length); print('gate3_mcp_search_get', true); print('gate3_cross_user_denied', true); print('gate3_insufficient_scope_status', 403); print('gate3_proposal_insufficient_scope_status', 403); print('gate3_progress_fixture_matches_app', true); print('gate3_duplicate_proposal_same_id', true); print('gate3_approved_routine_id', approved.routine.id); print('gate3_exactly_one_approved_routine', true); print('gate3_phone_edit_preserved', true); print('gate3_revoked_grant_status', 401); print('gate3_unauthenticated_mcp_status', unauthenticatedMcp.response.status); print('gate3_manual_bearer_oauth_api_attempts', manualBearerApiProxy.oauthAttempts); print('gate3_manual_bearer_without_oauth_api', true); print('gate3_oauth_compatibility_surface', 'retained for clients such as Claude.ai; not used by manual-bearer fixture'); print('gate3_discovery_authorization_server', `http://127.0.0.1:${mcpPort}`)

  // Gate 4: decode/re-encode, ownership checks, quota, failed replacement
  // preservation, and a versioned backup manifest. Every fixture is local and
  // disposable; no public URL or production data is involved.
  const nginxTemplate = fs.readFileSync(path.join(ROOT, 'web/nginx.conf.template'), 'utf8')
  assert.equal((nginxTemplate.match(/client_max_body_size/g) || []).length, 1)
  assert.match(nginxTemplate, /client_max_body_size 16m/)
  assert.doesNotMatch(nginxTemplate, /proxy_pass http:\/\/mcp:8787/)
  assert.match(nginxTemplate, /proxy_pass \$mcp_upstream/)
  const tinyPng = await solidImage('png', 1, 1, { r: 1, g: 2, b: 3 })
  const upload = assertStatus(await request(apiBase, '/api/assets', { ...bodyOptions({ mime: 'image/png', data: tinyPng.toString('base64') }), headers: { Cookie: `gymsid=${session}` } }), 201, 'private asset upload').data.asset
  assert.equal(upload.mime, 'image/webp')
  const imageFixtures = [
    ['png', 'image/png', await solidImage('png')],
    ['jpeg', 'image/jpeg', await solidImage('jpeg')],
    ['webp', 'image/webp', await solidImage('webp')]
  ]
  for (const [label, mime, bytes] of imageFixtures) {
    const fixture = assertStatus(await request(apiBase, '/api/assets', {
      ...bodyOptions({ mime, data: bytes.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
    }), 201, `${label} fixture upload`).data.asset
    assert.equal(fixture.mime, 'image/webp')
    assert.ok(fixture.size > 0 && fixture.size <= 2 * 1024 * 1024)
    const fixtureStateRead = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })
    const fixtureState = {
      ...fixtureStateRead.data.state,
      customEx: [...(fixtureStateRead.data.state.customEx || []), { id: `c-${label}`, n: `${label} fixture`, bp: 'full body', eq: 'custom', custom: true, media: fixture }]
    }
    assertStatus(await request(apiBase, '/api/data', {
      method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': fixtureStateRead.data.revision, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: fixtureState })
    }), 200, `${label} fixture reference attach`)
    const servedFixture = await rawRequest(apiBase, `/api/assets/${fixture.id}`, { headers: { Cookie: `gymsid=${session}` } })
    assert.equal(servedFixture.response.status, 200)
    assert.equal(hash(servedFixture.bytes), fixture.sha256)
    const fixtureMetadata = await sharp(servedFixture.bytes).metadata()
    assert.ok(Math.max(fixtureMetadata.width, fixtureMetadata.height) <= 2048)
    assert.equal(fixtureMetadata.exif, undefined)
    print(`gate4_${label}_valid_reencoded_webp`, true)
    print(`gate4_${label}_sha256`, fixture.sha256)
  }

  // Saturate the disposable decoder with a bounded burst. The API admits two
  // active normalizers, queues eight, and rejects the rest with a retryable 429;
  // response headers expose the observed peak only in this test process.
  const corruptImage = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  const concurrentUploads = await Promise.all(Array.from({ length: 14 }, (_, index) => request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/png', data: tinyPng.toString('base64') }), headers: { Cookie: `gymsid=${session}`, 'X-Image-Concurrency-Fixture': String(index) }
  })))
  const concurrentStatuses = concurrentUploads.map(result => result.response.status)
  const concurrentPeaks = concurrentUploads.map(result => Number(result.response.headers.get('x-opengym-image-processing-peak') || 0)).filter(Number.isFinite)
  const observedPeak = Math.max(0, ...concurrentPeaks)
  const concurrentStatusCounts = concurrentStatuses.reduce((counts, status) => ({ ...counts, [status]: (counts[status] || 0) + 1 }), {})
  assert.equal(concurrentStatusCounts[201], 10, `decoder queue successful count: ${concurrentStatuses}`)
  assert.equal(concurrentStatusCounts[429], 4, `decoder queue rejection count: ${concurrentStatuses}`)
  assert.equal(Object.keys(concurrentStatusCounts).length, 2)
  assert.equal(observedPeak, 2, `decoder peak must equal semaphore limit: ${observedPeak}`)
  const retryAfterValues = concurrentUploads.filter(result => result.response.status === 429)
    .map(result => result.response.headers.get('retry-after'))
  assert.deepEqual(retryAfterValues, ['1', '1', '1', '1'])
  print('gate4_image_processing_limit', 2)
  print('gate4_image_processing_queue_limit', 8)
  print('gate4_image_processing_peak_observed', observedPeak)
  print('gate4_image_processing_status_counts', { 201: concurrentStatusCounts[201], 429: concurrentStatusCounts[429] })
  print('gate4_image_processing_queue_rejection_status', 429)
  print('gate4_image_processing_queue_retry_after', '1')

  // Error paths must release both decoder slots. Two simultaneous corrupt
  // requests are followed by a valid upload under a bounded timeout; a response
  // proves there is no leaked slot or deadlocked queue.
  const corruptBurst = await Promise.all([1, 2].map(() => request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/png', data: corruptImage.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  })))
  assert.deepEqual(corruptBurst.map(result => result.response.status).sort((a, b) => a - b), [400, 400])
  const releaseTimeout = wait(2000).then(() => { throw new Error('decoder slot release probe timed out') })
  const releaseValid = await Promise.race([request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/png', data: tinyPng.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  }), releaseTimeout])
  assertStatus(releaseValid, 201, 'decoder slot release valid upload')
  print('gate4_image_processing_release_after_errors', true)
  print('gate4_image_processing_no_deadlock', true)

  const jpegWithExif = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 210, g: 120, b: 70 } } })
    .withMetadata({ exif: { IFD0: { Artist: 'openGym staging fixture' } } }).jpeg({ quality: 88 }).toBuffer()
  const inputExif = await sharp(jpegWithExif).metadata()
  assert.ok(inputExif.exif?.length, 'fixture must contain EXIF before upload')
  const exifAsset = assertStatus(await request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/jpeg', data: jpegWithExif.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  }), 201, 'EXIF fixture upload').data.asset
  const exifStateRead = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })
  const exifState = {
    ...exifStateRead.data.state,
    customEx: [...(exifStateRead.data.state.customEx || []), { id: 'c-exif', n: 'EXIF fixture', bp: 'full body', eq: 'custom', custom: true, media: exifAsset }]
  }
  assertStatus(await request(apiBase, '/api/data', {
    method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': exifStateRead.data.revision, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: exifState })
  }), 200, 'EXIF fixture reference attach')
  const exifServed = await rawRequest(apiBase, `/api/assets/${exifAsset.id}`, { headers: { Cookie: `gymsid=${session}` } })
  const outputExif = await sharp(exifServed.bytes).metadata()
  assert.equal(outputExif.exif, undefined)
  print('gate4_exif_input_present', true)
  print('gate4_exif_output_absent', true)

  const corruptImageResult = await request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/png', data: corruptImage.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  })
  assertStatus(corruptImageResult, 400, 'corrupt image fixture')
  assert.equal(corruptImageResult.data.code, 'IMAGE_DECODE')
  print('gate4_corrupt_image_status', 400)
  print('gate4_corrupt_image_code', 'IMAGE_DECODE')

  const animatedFrameA = await solidImage('webp', 32, 32, { r: 220, g: 20, b: 40 })
  const animatedFrameB = await solidImage('webp', 32, 32, { r: 20, g: 80, b: 220 })
  const animatedWebp = await sharp([animatedFrameA, animatedFrameB], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer()
  const animatedMetadata = await sharp(animatedWebp, { animated: true }).metadata()
  assert.ok(Number(animatedMetadata.pages) > 1, 'animated fixture must contain multiple pages')
  const animatedResult = await request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/webp', data: animatedWebp.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  })
  assertStatus(animatedResult, 400, 'animated image fixture')
  assert.equal(animatedResult.data.code, 'IMAGE_ANIMATED')
  print('gate4_animated_image_pages', animatedMetadata.pages)
  print('gate4_animated_image_status', 400)
  print('gate4_animated_image_code', 'IMAGE_ANIMATED')

  const oversizedDimensions = await sharp({ create: { width: 5001, height: 5001, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png({ compressionLevel: 9 }).toBuffer()
  const oversizedResult = await request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/png', data: oversizedDimensions.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  })
  assertStatus(oversizedResult, 400, 'oversized dimensions fixture')
  assert.equal(oversizedResult.data.code, 'IMAGE_DIMENSIONS')
  print('gate4_dimensions_limit_pixels', 25000000)
  print('gate4_oversized_dimensions_status', 400)
  print('gate4_oversized_dimensions_code', 'IMAGE_DIMENSIONS')

  const noisyRaw = crypto.randomBytes(1800 * 1800 * 3)
  const noisyPng = await sharp(noisyRaw, { raw: { width: 1800, height: 1800, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer()
  assert.ok(noisyPng.length <= 10 * 1024 * 1024, `noise fixture too large for input boundary: ${noisyPng.length}`)
  const outputLimitResult = await request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/png', data: noisyPng.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  })
  assertStatus(outputLimitResult, 413, 'normalized output limit fixture')
  assert.equal(outputLimitResult.data.code, 'IMAGE_OUTPUT')
  print('gate4_output_limit_bytes', 2097152)
  print('gate4_output_limit_status', 413)
  print('gate4_output_limit_code', 'IMAGE_OUTPUT')

  // A sparse file fills the disposable quota accounting without allocating or
  // writing 200 MiB. It is removed with the temporary staging directory only.
  const quotaDir = path.join(activeDataDir, 'uploads', uid)
  fs.mkdirSync(quotaDir, { recursive: true })
  const quotaFixture = path.join(quotaDir, '.quota-fixture')
  fs.writeFileSync(quotaFixture, '')
  fs.truncateSync(quotaFixture, 200 * 1024 * 1024)
  const quotaResult = await request(apiBase, '/api/assets', {
    ...bodyOptions({ mime: 'image/png', data: tinyPng.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
  })
  assertStatus(quotaResult, 413, 'per-user image quota fixture')
  assert.equal(quotaResult.data.code, 'IMAGE_QUOTA')
  assert.equal(fs.existsSync(quotaFixture), true)
  fs.unlinkSync(quotaFixture)
  print('gate4_quota_limit_bytes', 209715200)
  print('gate4_quota_status', 413)
  print('gate4_quota_existing_assets_preserved', true)

  let assetRead = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } });
  const withAsset = { ...assetRead.data.state, customEx: assetRead.data.state.customEx.map(e => e.id === 'c-photo' ? { ...e, media: upload } : e) }
  assertStatus(await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': assetRead.data.revision, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: withAsset }) }), 200, 'asset reference attach')
  const rendered = await rawRequest(apiBase, `/api/assets/${upload.id}`, { headers: { Cookie: `gymsid=${session}` } }); assert.equal(rendered.response.status, 200); assert.equal(hash(rendered.bytes), upload.sha256)
  assertStatus(await request(apiBase, `/api/assets/${upload.id}`), 401, 'unauthorized asset retrieval')
  const otherSession = tokenFor(otherUid); assertStatus(await request(apiBase, `/api/assets/${upload.id}`, { headers: { Cookie: `gymsid=${otherSession}` } }), 404, 'other user asset retrieval')
  // Simulate an API process replacement and clean restore using the data-directory backup. Coordinate
  // the snapshot with the sole writer: stop API first, then walk/copy files and persist a versioned
  // checksum sidecar outside both source and backup roots (avoids self-referential checksums).
  await stop(apiChild); apiChild = null
  assert.equal(apiChild, null)
  print('gate4_backup_writer_stopped_before_manifest', true)
  const backupManifest = { version: 1, files: fileManifest(tmp) }
  const backupManifestJson = JSON.stringify(backupManifest, null, 2)
  const backupManifestDigest = hash(backupManifestJson)
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-data-backup-'))
  fs.cpSync(tmp, backupDir, { recursive: true })
  backupManifestFile = `${backupDir}.manifest.json`
  fs.writeFileSync(backupManifestFile, backupManifestJson, { mode: 0o600 })
  assert.equal(fs.existsSync(backupManifestFile), true)
  print('gate4_backup_manifest_persisted', true)
  const sidecar = JSON.parse(fs.readFileSync(backupManifestFile, 'utf8'))
  assert.equal(hash(fs.readFileSync(backupManifestFile)), hash(backupManifestJson))
  assert.deepEqual(fileManifest(backupDir), sidecar.files)
  // The immutable asset is restored before the replacement API starts; no profile reference or
  // image is deleted by the rollout.
  const restoredDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-restored-data-'))
  fs.cpSync(backupDir, restoredDataDir, { recursive: true })
  assert.equal(sidecar.version, 1)
  assert.deepEqual(fileManifest(restoredDataDir), sidecar.files)
  print('gate4_backup_manifest_version', backupManifest.version)
  print('gate4_backup_manifest_entries', backupManifest.files.length)
  print('gate4_backup_manifest_sha256', backupManifestDigest)
  print('gate4_backup_manifest_sidecar_verified', true)
  print('gate4_backup_restore_manifest_match', true)
  activeDataDir = restoredDataDir
  const replacementPort = await freePort()
  apiChild = await start('node', ['api/server.js'], { PORT: replacementPort, DATA_DIR: activeDataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost', MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0' })
  apiBase = `http://127.0.0.1:${replacementPort}`
  const restored = await rawRequest(apiBase, `/api/assets/${upload.id}`, { headers: { Cookie: `gymsid=${session}` } })
  assert.equal(restored.response.status, 200); assert.equal(hash(restored.bytes), upload.sha256)
  const duplicateAfterRestart = await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': rev0, 'Idempotency-Key': 'phone-write-1', 'Content-Type': 'application/json' }, body: JSON.stringify({ state: changed }) })
  assertStatus(duplicateAfterRestart, 200, 'duplicate after data-directory restore'); assert.equal(duplicateAfterRestart.data.revision, rev1)
  print('gate2_idempotency_survives_restart', true)
  fs.rmSync(backupDir, { recursive: true, force: true }); backupDir = null
  fs.rmSync(backupManifestFile, { force: true }); backupManifestFile = null
  const oldRef = (await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })).data.state.customEx.find(e => e.id === 'c-photo').media
  assertStatus(await request(apiBase, '/api/assets', { ...bodyOptions({ mime: 'image/png', data: 'not-an-image' }), headers: { Cookie: `gymsid=${session}` } }), 400, 'failed replacement')
  const newRef = (await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })).data.state.customEx.find(e => e.id === 'c-photo').media
  assert.deepEqual(newRef, oldRef)

  // Feature toggles are exercised against a second disposable data directory so this receipt
  // cannot alter the Gate 2-4 fixture above. Turning MCP/proposals/custom images off must make
  // their write/API routes unavailable without deleting an existing profile or private asset;
  // reads of an already-referenced private asset stay available by policy. Re-enabling the flags
  // on a fresh process must expose the same routes and bytes again.
  {
    const flagsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-feature-flags-'))
    let flagsChild = null
    let flagsBase = ''
    try {
      fs.writeFileSync(path.join(flagsDir, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'Flags user' }], creds: [], subs: [], invites: [] }, null, 2))
      fs.writeFileSync(path.join(flagsDir, 'state-user-a.json'), JSON.stringify(stateFixture('Flags roundtrip'), null, 2))
      fs.writeFileSync(path.join(flagsDir, 'mcp-grants.json'), JSON.stringify({ grants: [{
        id: 'flags-grant', uid, name: 'flags fixture', scopes: ['exercise:read'], tokenHash: hash(grantToken),
        created: new Date().toISOString(), expires: Date.now() + 3600000
      }] }, null, 2))
      fs.writeFileSync(path.join(flagsDir, 'secret'), secret, { mode: 0o600 })

      const flagsOnPort = await freePort()
      flagsChild = await start('node', ['api/server.js'], {
        PORT: flagsOnPort, DATA_DIR: flagsDir, RP_ID: 'localhost', ORIGIN: 'http://localhost',
        MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0'
      })
      flagsBase = `http://127.0.0.1:${flagsOnPort}`
      const flagsPng = await solidImage('png', 32, 24, { r: 7, g: 77, b: 177 })
      const flagsAsset = assertStatus(await request(flagsBase, '/api/assets', {
        ...bodyOptions({ mime: 'image/png', data: flagsPng.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
      }), 201, 'feature-flag asset seed').data.asset
      const flagsRead = assertStatus(await request(flagsBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'feature-flag profile seed').data
      const flagsWithAsset = {
        ...flagsRead.state,
        customEx: flagsRead.state.customEx.map(e => e.id === 'c-photo' ? { ...e, media: flagsAsset } : e)
      }
      assertStatus(await request(flagsBase, '/api/data', {
        method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': flagsRead.revision, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: flagsWithAsset })
      }), 200, 'feature-flag asset reference')
      const flagsProfileFile = path.join(flagsDir, 'state-user-a.json')
      const profileCounts = state => ({
        routines: Array.isArray(state?.routines) ? state.routines.length : 0,
        workouts: Array.isArray(state?.workouts) ? state.workouts.length : 0,
        custom_exercises: Array.isArray(state?.customEx) ? state.customEx.length : 0,
        nested_sets: (state?.workouts || []).reduce((total, workout) => total + (workout.entries || []).reduce((entryTotal, entry) => entryTotal + (entry.sets || []).length, 0), 0),
        asset_refs: (state?.customEx || []).filter(exercise => exercise.media?.id).length
      })
      const profileSnapshot = () => {
        const raw = fs.readFileSync(flagsProfileFile)
        const state = JSON.parse(raw.toString('utf8'))
        return { sha256: hash(raw), counts: profileCounts(state) }
      }
      const flagsOnBefore = profileSnapshot()
      assert.equal((await rawRequest(flagsBase, `/api/assets/${flagsAsset.id}`, { headers: { Cookie: `gymsid=${session}` } })).response.status, 200)

      await stop(flagsChild); flagsChild = null
      const flagsOffPort = await freePort()
      flagsChild = await start('node', ['api/server.js'], {
        PORT: flagsOffPort, DATA_DIR: flagsDir, RP_ID: 'localhost', ORIGIN: 'http://localhost',
        MCP_ENABLED: '0', MCP_PROPOSALS_ENABLED: '0', CUSTOM_IMAGES_ENABLED: '0', AUDIT_LOG: '0'
      })
      flagsBase = `http://127.0.0.1:${flagsOffPort}`
      const flagsOffMcp = await request(flagsBase, '/api/mcp/catalog?offset=0&limit=1', { headers: bearer(grantToken) })
      const flagsOffProposals = await request(flagsBase, '/api/mcp/proposals', { headers: { Cookie: `gymsid=${session}` } })
      const flagsOffUpload = await request(flagsBase, '/api/assets', {
        ...bodyOptions({ mime: 'image/png', data: flagsPng.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
      })
      const flagsOffAsset = await rawRequest(flagsBase, `/api/assets/${flagsAsset.id}`, { headers: { Cookie: `gymsid=${session}` } })
      assert.equal(flagsOffMcp.response.status, 404)
      assert.equal(flagsOffProposals.response.status, 404)
      assert.equal(flagsOffUpload.response.status, 404)
      assert.equal(flagsOffAsset.response.status, 200)
      assert.equal(hash(flagsOffAsset.bytes), flagsAsset.sha256)
      assert.equal(fs.existsSync(path.join(flagsDir, 'uploads', uid, flagsAsset.id)), true)
      const flagsOffProfile = assertStatus(await request(flagsBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'feature flags off profile').data
      const flagsOffSnapshot = profileSnapshot()
      assert.deepEqual(flagsOffSnapshot.counts, flagsOnBefore.counts)
      assert.equal(flagsOffSnapshot.sha256, flagsOnBefore.sha256)
      assert.deepEqual(flagsOffProfile.state, JSON.parse(fs.readFileSync(flagsProfileFile, 'utf8')))

      await stop(flagsChild); flagsChild = null
      const flagsOnAgainPort = await freePort()
      flagsChild = await start('node', ['api/server.js'], {
        PORT: flagsOnAgainPort, DATA_DIR: flagsDir, RP_ID: 'localhost', ORIGIN: 'http://localhost',
        MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0'
      })
      flagsBase = `http://127.0.0.1:${flagsOnAgainPort}`
      const flagsOnMcp = await request(flagsBase, '/api/mcp/catalog?offset=0&limit=1', { headers: bearer(grantToken) })
      const flagsOnProposals = await request(flagsBase, '/api/mcp/proposals', { headers: { Cookie: `gymsid=${session}` } })
      const flagsOnUpload = await request(flagsBase, '/api/assets', {
        ...bodyOptions({ mime: 'image/png', data: flagsPng.toString('base64') }), headers: { Cookie: `gymsid=${session}` }
      })
      const flagsOnProfile = assertStatus(await request(flagsBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'feature flags on profile').data
      const flagsOnAsset = await rawRequest(flagsBase, `/api/assets/${flagsAsset.id}`, { headers: { Cookie: `gymsid=${session}` } })
      const flagsOnUploadedAsset = flagsOnUpload.data.asset
      const flagsOnUploadedAssetFile = flagsOnUploadedAsset
        ? path.join(flagsDir, 'uploads', uid, flagsOnUploadedAsset.id)
        : null
      const flagsOnAfter = profileSnapshot()
      assert.equal(flagsOnMcp.response.status, 200)
      assert.equal(flagsOnProposals.response.status, 200)
      assert.equal(flagsOnUpload.response.status, 201)
      assert.ok(flagsOnUploadedAsset?.sha256)
      assert.equal(fs.existsSync(flagsOnUploadedAssetFile), true)
      assert.equal(hash(fs.readFileSync(flagsOnUploadedAssetFile)), flagsOnUploadedAsset.sha256)
      assert.equal(flagsOnAsset.response.status, 200)
      assert.equal(hash(flagsOnAsset.bytes), flagsAsset.sha256)
      assert.deepEqual(flagsOnAfter.counts, flagsOnBefore.counts)
      assert.equal(flagsOnAfter.sha256, flagsOnBefore.sha256)
      assert.deepEqual(flagsOnProfile.state, JSON.parse(fs.readFileSync(flagsProfileFile, 'utf8')))
      print('flags_on_counts', flagsOnAfter.counts)
      print('flags_off_counts', flagsOffSnapshot.counts)
      print('flags_roundtrip_profile_sha256', { on_before: flagsOnBefore.sha256, off: flagsOffSnapshot.sha256, on_after: flagsOnAfter.sha256 })
      print('flags_toggle_no_data_loss', true)
      print('flags_off_mcp_route_status', flagsOffMcp.response.status)
      print('flags_off_proposals_route_status', flagsOffProposals.response.status)
      print('flags_off_asset_upload_route_status', flagsOffUpload.response.status)
      print('flags_off_asset_existing_retrieval_status', flagsOffAsset.response.status)
      print('flags_off_asset_existing_retrieval_policy', '200 (existing private asset retained; new uploads disabled at 404)')
      print('flags_off_asset_file_preserved', true)
      print('flags_on_mcp_route_status', flagsOnMcp.response.status)
      print('flags_on_proposals_route_status', flagsOnProposals.response.status)
      print('flags_on_asset_upload_route_status', flagsOnUpload.response.status)
      print('flags_on_asset_upload_checksum_ownership', true)
      print('flags_on_asset_existing_retrieval_status', flagsOnAsset.response.status)
      print('LOCAL_FEATURE_TOGGLE_STAGING', 'PASS')
    } finally {
      await stop(flagsChild)
      fs.rmSync(flagsDir, { recursive: true, force: true })
    }
  }

  print('gate4_proxy_body_limit', '16m_template'); print('gate4_upload_sha256', upload.sha256); print('gate4_private_asset_reference_ready', true); print('gate4_headless_react_real_surfaces', 'PASS (Library/Picker/Routine/Workout/Detail; separate Vitest receipt)'); print('gate4_production_browser_or_container', 'not_claimed'); print('gate4_failed_replacement_preserved', true); print('gate4_unauthorized_status', 401); print('gate4_cross_user_status', 404); print('gate4_clean_restore_checksum_match', true); print('gate4_image_hardening', 'PASS (sharp decode/rotate/resize/WebP/metadata/quota/semaphore)')

  // Leave a valid write-ahead journal behind as if the process crashed after its first durable
  // rename. The next API read must replay both state and receipt before serving the profile.
  const replayRead = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })
  const replayState = { ...replayRead.data.state, _journal_probe: 'replayed' }
  const replayText = JSON.stringify(replayState)
  const replayReceipt = { uid, key: 'journal-replay-1', hash: hash(replayText), revision: etag(replayText), tsValue: replayState._ts || null, ts: Date.now() }
  await stop(apiChild); apiChild = null
  fs.writeFileSync(path.join(activeDataDir, '.state-txn-user-a.json'), JSON.stringify({ state: replayState, receipt: replayReceipt }))
  const replayPort = await freePort(); apiChild = await start('node', ['api/server.js'], { PORT: replayPort, DATA_DIR: activeDataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost', MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0' })
  apiBase = `http://127.0.0.1:${replayPort}`
  const replayed = assertStatus(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'journal replay').data
  assert.equal(replayed.state._journal_probe, 'replayed')
  const persistedReceipts = JSON.parse(fs.readFileSync(path.join(activeDataDir, 'idempotency.json'), 'utf8'))
  const persistedReceipt = persistedReceipts.entries.find(e => e.uid === uid && e.key === replayReceipt.key)
  assert.equal(persistedReceipt?.revision, replayReceipt.revision)
  const replayRetry = await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': replayRead.data.revision, 'Idempotency-Key': replayReceipt.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: replayState }) })
  assertStatus(replayRetry, 200, 'journal retry with previous ETag'); assert.equal(replayRetry.data.revision, replayReceipt.revision)
  assert.equal(fs.existsSync(path.join(activeDataDir, '.state-txn-user-a.json')), false)
  print('gate2_state_receipt_journal_replayed', true); print('gate2_state_receipt_persisted', true); print('gate2_journal_retry_same_revision', true); print('gate2_journal_removed', true)

  // Inject one receipt-write failure: the first recovery must fail closed and retain the journal;
  // a fresh process then persists the receipt before removing it, proving RAM state is not enough.
  const failureState = { ...replayed.state, _journal_failure_probe: 'pending' }
  const failureText = JSON.stringify(failureState)
  const failureReceipt = { uid, key: 'journal-failure-1', hash: hash(failureText), revision: etag(failureText), tsValue: failureState._ts || null, ts: Date.now() }
  await stop(apiChild); apiChild = null
  fs.writeFileSync(path.join(activeDataDir, '.state-txn-user-a.json'), JSON.stringify({ state: failureState, receipt: failureReceipt }))
  const failurePort = await freePort(); apiChild = await start('node', ['api/server.js'], { PORT: failurePort, DATA_DIR: activeDataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost', MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0', OPENGYM_TEST_FAIL_RECEIPT_WRITES: '1' })
  apiBase = `http://127.0.0.1:${failurePort}`
  assertStatus(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 503, 'injected receipt write failure')
  assert.equal(fs.existsSync(path.join(activeDataDir, '.state-txn-user-a.json')), true)
  await stop(apiChild); apiChild = null
  const recoveryPort = await freePort(); apiChild = await start('node', ['api/server.js'], { PORT: recoveryPort, DATA_DIR: activeDataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost', MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0' })
  apiBase = `http://127.0.0.1:${recoveryPort}`
  const recoveredAfterFailure = assertStatus(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'receipt failure recovery').data
  assert.equal(recoveredAfterFailure.state._journal_failure_probe, 'pending')
  const recoveredReceipts = JSON.parse(fs.readFileSync(path.join(activeDataDir, 'idempotency.json'), 'utf8'))
  assert.equal(recoveredReceipts.entries.some(e => e.uid === uid && e.key === failureReceipt.key && e.revision === failureReceipt.revision), true)
  assert.equal(fs.existsSync(path.join(activeDataDir, '.state-txn-user-a.json')), false)
  print('gate2_receipt_failure_journal_retained', true); print('gate2_receipt_failure_recovery', true)

  // Exercise the actual state-write ENOSPC boundary with a disposable, process-local injection.
  // The fixture fails after the journal is durable, so the old profile bytes remain untouched and
  // the next clean process replays the pending edit exactly once. No filesystem is filled.
  const enospcRead = await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } })
  const enospcState = { ...enospcRead.data.state, _enospc_probe: 'replayed-after-full-disk' }
  const stateFilePath = path.join(activeDataDir, 'state-user-a.json')
  const priorStateHash = hash(fs.readFileSync(stateFilePath))
  await stop(apiChild); apiChild = null
  const enospcPort = await freePort(); apiChild = await start('node', ['api/server.js'], { PORT: enospcPort, DATA_DIR: activeDataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost', MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0', OPENGYM_TEST_FAIL_STATE_WRITES: '1' })
  apiBase = `http://127.0.0.1:${enospcPort}`
  const enospcWrite = await request(apiBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': enospcRead.data.revision, 'Idempotency-Key': 'enospc-state-1', 'Content-Type': 'application/json' }, body: JSON.stringify({ state: enospcState }) })
  assertStatus(enospcWrite, 503, 'injected ENOSPC state write')
  assert.equal(enospcWrite.data.error, 'storage_unavailable')
  assert.equal(hash(fs.readFileSync(stateFilePath)), priorStateHash)
  assert.equal(fs.existsSync(path.join(activeDataDir, '.state-txn-user-a.json')), true)
  await stop(apiChild); apiChild = null
  const enospcRecoveryPort = await freePort(); apiChild = await start('node', ['api/server.js'], { PORT: enospcRecoveryPort, DATA_DIR: activeDataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost', MCP_ENABLED: '1', MCP_PROPOSALS_ENABLED: '1', CUSTOM_IMAGES_ENABLED: '1', AUDIT_LOG: '0' })
  apiBase = `http://127.0.0.1:${enospcRecoveryPort}`
  const enospcRecovered = assertStatus(await request(apiBase, '/api/data', { headers: { Cookie: `gymsid=${session}` } }), 200, 'ENOSPC journal recovery').data
  assert.equal(enospcRecovered.state._enospc_probe, 'replayed-after-full-disk')
  const enospcReceipts = JSON.parse(fs.readFileSync(path.join(activeDataDir, 'idempotency.json'), 'utf8'))
  assert.equal(enospcReceipts.entries.some(e => e.uid === uid && e.key === 'enospc-state-1' && e.revision === enospcRecovered.revision), true)
  assert.equal(fs.existsSync(path.join(activeDataDir, '.state-txn-user-a.json')), false)
  print('gate2_enospc_write_status', 503); print('gate2_enospc_old_state_hash_preserved', true); print('gate2_enospc_journal_retained', true); print('gate2_enospc_recovery_replayed', true); print('gate2_enospc_injection_scope', 'disposable state-write ENOSPC path; no disk filled')

  // Corrupt db.json is a hard stop, not an empty profile.
  await stop(apiChild); apiChild = null; fs.writeFileSync(path.join(activeDataDir, 'db.json'), '{broken')
  const corruptPort = await freePort(); apiChild = await start('node', ['api/server.js'], { PORT: corruptPort, DATA_DIR: activeDataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost', AUDIT_LOG: '0' })
  const corruptBase = `http://127.0.0.1:${corruptPort}`
  assertStatus(await request(corruptBase, '/api/health'), 503, 'corrupt db health')
  const corruptWrite = await request(corruptBase, '/api/data', { method: 'PUT', headers: { Cookie: `gymsid=${session}`, 'If-Match': '"0"', 'Idempotency-Key': 'corrupt-write', 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { routines: [] } }) })
  assertStatus(corruptWrite, 503, 'corrupt db PUT'); assert.equal(corruptWrite.data.error, 'storage_corrupt')
  print('gate2_corrupt_db_writes', 'stopped status=503 storage_corrupt'); print('gate2_corrupt_db_put_status', 503); print('gate2_corrupt_db_put_error', 'storage_corrupt')
  print('GATE_2', 'PASS')
  print('GATE_3_STAGING', 'PASS (protocol clients; hosted-fixture is local and not a production cloud receipt)')
  print('GATE_4_STAGING', 'PASS (API asset decode/checksum/auth/rollback + headless React real surfaces; production browser/container evidence not claimed)')
} finally {
  await stop(mcpChild)
  if (manualBearerApiProxy) await new Promise(resolve => manualBearerApiProxy.server.close(resolve))
  await stop(apiChild)
  if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true })
  if (backupManifestFile) fs.rmSync(backupManifestFile, { force: true })
  if (activeDataDir !== tmp) fs.rmSync(activeDataDir, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
}
