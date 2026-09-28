#!/usr/bin/env node
/* End-to-end check of the remote connector against the real api and MCP servers, on throwaway
   data in a temp dir. Needs `npm ci` in api/ and mcp/. Run from the repo root:

     node mcp/scripts/smoke.mjs

   Layout mirrors a deployment: an "app origin" (a tiny stand-in for nginx that proxies /api/ to
   the api and /mcp-authorize to the MCP server) and a separate "MCP origin" served by the MCP
   server itself. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PORTS = { app: 18080, mcp: 18081, api: 18082 }
const APP = `http://127.0.0.1:${PORTS.app}`
const MCP = `http://127.0.0.1:${PORTS.mcp}`
const RESOURCE = `${MCP}/mcp`
const REDIRECT = 'http://127.0.0.1/callback'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-smoke-'))
const data = path.join(temp, 'data')
fs.mkdirSync(data)
const secret = crypto.randomBytes(32).toString('hex')
fs.writeFileSync(path.join(data, 'secret'), secret)
// A second account, to show a connection approved by `owner` never reaches it.
const users = [{ id: 'owner', name: 'Owner', sv: 0 }, { id: 'other', name: 'Other', sv: 0 }]
fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }))
for (const { id } of users) {
  const state = { _rev: 10, unit: 'kg', targetW: id === 'other' ? 60 : null, bodyweight: [{ d: '2026-08-01', w: 80 }], routines: [], workouts: [], customEx: [], week: {}, dayPlan: {}, exWeights: {} }
  fs.writeFileSync(path.join(data, `state-${id}.json`), JSON.stringify(state))
}

const children = [
  spawn(process.execPath, ['server.js'], {
    cwd: path.join(ROOT, 'api'), stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PORT: String(PORTS.api), DATA_DIR: data, ORIGIN: APP, RP_ID: '127.0.0.1', MCP_INTERNAL_URL: MCP }
  }),
  spawn(process.execPath, ['src/http.js'], {
    cwd: path.join(ROOT, 'mcp'), stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PORT: String(PORTS.mcp), HOST: '127.0.0.1', OPENGYM_DATA: data, OAUTH_DATA: path.join(temp, 'oauth'), OAUTH_ISSUER: MCP, OAUTH_AUTHORIZE_URL: `${APP}/mcp-authorize`, MCP_RESOURCE: RESOURCE }
  })
]

function proxy(req, res, port, target) {
  const upstream = http.request({ hostname: '127.0.0.1', port, path: target, method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers)
    response.pipe(res)
  })
  upstream.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(upstream)
}
const app = http.createServer((req, res) => {
  const url = new URL(req.url, APP)
  if (url.pathname.startsWith('/api/')) return proxy(req, res, PORTS.api, req.url)
  if (url.pathname === '/mcp-authorize') return proxy(req, res, PORTS.mcp, '/authorize' + url.search)
  res.writeHead(404); res.end()
}).listen(PORTS.app, '127.0.0.1')

function cleanup() {
  app.close()
  for (const child of children) child.kill('SIGTERM')
  fs.rmSync(temp, { recursive: true, force: true })
}

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${url} never came up`)
}

const payload = `owner:${Date.now() + 3600000}:0`
const cookie = `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`
const form = body => ({ method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: APP, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
const json = (body, origin = APP) => ({ method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// The consent page as a signed-in browser would submit it. Returns the code and its verifier.
async function consent(client, mode) {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const params = {
    client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code', scope: 'opengym:read opengym:write', resource: RESOURCE,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'
  }
  const page = await fetch(`${APP}/mcp-authorize?${new URLSearchParams(params)}`, { headers: { Cookie: cookie } }).then(r => r.text())
  const nonce = page.match(/name="consent_nonce" value="([^"]+)"/)[1]
  const approved = await fetch(`${APP}/mcp-authorize`, form({ ...params, consent_nonce: nonce, approve: 'yes', mode }))
  assert.equal(approved.status, 303, await approved.text())
  return { code: new URL(approved.headers.get('location')).searchParams.get('code'), verifier }
}

const exchange = (client, code, verifier) => fetch(`${MCP}/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: RESOURCE })
})

// A JSON-RPC session over the access token, with a `call` helper for tools.
async function session(accessToken) {
  let id = 0
  const rpc = async (method, params = {}) => {
    const response = await fetch(RESOURCE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
    })
    assert.equal(response.status, 200, await response.clone().text())
    const body = await response.text()
    return JSON.parse(body.match(/^data: (.+)$/m)?.[1] ?? body).result
  }
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } })
  const call = async (name, args = {}) => {
    const result = await rpc('tools/call', { name, arguments: args })
    return result.isError ? { error: result.content[0].text } : JSON.parse(result.content[0].text)
  }
  return { token: accessToken, rpc, call }
}

async function connect(client, mode) {
  const { code, verifier } = await consent(client, mode)
  const res = await exchange(client, code, verifier)
  assert.equal(res.status, 200, await res.clone().text())
  return session((await res.json()).access_token)
}

try {
  await waitFor(`${APP}/api/health`)
  await waitFor(`${MCP}/health`)
  assert.equal((await fetch(`${MCP}/.well-known/oauth-authorization-server`)).status, 200)
  assert.equal((await fetch(RESOURCE, { method: 'POST' })).status, 401)

  const client = await fetch(`${MCP}/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Smoke test', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
  }).then(r => r.json())

  // PKCE: the code only exchanges with its own verifier, and only once.
  const { code, verifier } = await consent(client, 'read')
  assert.equal((await exchange(client, code, 'x'.repeat(43))).status, 400)
  assert.equal((await exchange(client, code, verifier)).status, 200)
  assert.equal((await exchange(client, code, verifier)).status, 400)

  // Read and write as the approving user only.
  const writer = await connect(client, 'write')
  const before = await writer.call('get_profile_state')
  assert.equal(before.goal_weight, null, 'reads the owner profile, not the other account')
  const written = await writer.call('set_goal_weight', { expected_version: before.state_version, weight: 75 })
  assert.equal(written.ok, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'state-other.json'))).targetW, 60, 'the other account is untouched')

  // The browser's copy is now stale: PUT /api/data with the old revision is a conflict.
  const stale = await fetch(`${APP}/api/data`, { ...json({ baseRev: before.state_version, state: { workouts: [], routines: [] } }), method: 'PUT' })
  assert.equal(stale.status, 409)

  // Deletions wait for approval in Settings, which refuses cross-origin requests.
  const pending = await writer.call('delete_bodyweight', { expected_version: written.state_version, date: '2026-08-01', confirm: true })
  assert.equal(pending.approval_required, true)
  assert.equal((await fetch(`${APP}/api/mcp/approve`, json({ id: pending.approval_id }, 'https://attacker.example'))).status, 403)
  const approved = await fetch(`${APP}/api/mcp/approve`, json({ id: pending.approval_id }))
  assert.equal(approved.status, 200, await approved.text())

  // Revoking the connection kills its token.
  const { connections } = await fetch(`${APP}/api/mcp/manage`, { headers: { Cookie: cookie } }).then(r => r.json())
  const revoked = await fetch(`${APP}/api/mcp/revoke`, json({ id: connections.find(c => c.scopes.includes('opengym:write')).id }))
  assert.equal(revoked.status, 200)
  assert.equal((await fetch(RESOURCE, { method: 'POST', headers: { Authorization: `Bearer ${writer.token}` } })).status, 401)

  // A read-only connection neither lists nor runs write tools.
  const reader = await connect(client, 'read')
  const { tools } = await reader.rpc('tools/list')
  assert.equal(tools.some(tool => tool.name === 'set_goal_weight'), false)
  assert.match((await reader.call('set_goal_weight', { expected_version: 0, weight: 70 })).error, /not found|read-only/i)

  console.log('smoke: ok')
} finally {
  cleanup()
}
