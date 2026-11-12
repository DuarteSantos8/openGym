// MCP over HTTP (http.js) against the real api/server.js in a child process: an official MCP
// client signs in with scoped tokens made through the api's own routes, and what it may list, read
// and write is exactly what each token holds, for its own profile only, until it is revoked.
// Needs api/'s dependencies, like log-workout.e2e.test.js.
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api')
const HAVE_API = fs.existsSync(path.join(API, 'node_modules', '@simplewebauthn', 'server'))
if (!HAVE_API && process.env.CI) throw new Error('api/node_modules is missing: run `npm ci` in api/ before the MCP tests in CI')

const SECRET = crypto.randomBytes(32).toString('hex')
const A = 'u_http_a', B = 'u_http_b'
const cookie = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}:c`
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}
const session = uid => { const c = cookie(uid); return c.slice('gymsid='.length) }
const DOC = name => ({
  unit: 'kg', restSec: 120,
  routines: [{ id: 'r1', name: name + ' push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100, mode: 'reps', restSec: 180 }], _ts: 1000 }],
  week: { 1: ['r1'] },
  workouts: [{ id: 'w-old', d: '2026-10-13', start: 1760371200000, end: 1760374800000, routineIds: ['r1'], routineId: 'r1', name: name + ' day', prs: [], entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }], topW: 100, target: null }] }],
  exWeights: {}, customEx: [], bodyweight: [{ d: '2026-10-13', w: 80, t: 1000 }],
  coach: { chat: [{ text: 'private' }] }, _rev: 5, _wid: 'w-seed', _ts: 1000,
})

let child, dataDir, apiBase, mcp, mcpUrl, log = ''
const stored = uid => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'))
async function makeToken(uid, scopes) {
  const r = await fetch(apiBase + '/api/tokens', { method: 'POST', headers: { Cookie: cookie(uid), 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'test', scopes }) })
  return r.json()
}
async function connect(token) {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }))
  return client
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content[0].text
  return r.isError ? { error: text } : JSON.parse(text)
}
const post = (headers, body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }) =>
  fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })

describe.skipIf(!HAVE_API)('MCP over HTTP with scoped tokens', () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcp-http-'))
    fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 })
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [A, B].map(id => ({ id, name: id, created: new Date().toISOString() })), creds: [], subs: [], invites: [] }))
    fs.writeFileSync(path.join(dataDir, `state-${A}.json`), JSON.stringify(DOC('Ana')))
    fs.writeFileSync(path.join(dataDir, `state-${B}.json`), JSON.stringify(DOC('Bo')))
    child = spawn(process.execPath, ['server.js'], {
      cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MCP: 'on' },
    })
    child.stderr.on('data', d => { log += d })
    const port = await new Promise((resolve, reject) => {
      const give = setTimeout(() => reject(new Error('server never announced a port:\n' + log)), 20000)
      child.stdout.on('data', d => { log += d; const m = /gym-api on :(\d+)/.exec(log); if (m) { clearTimeout(give); resolve(+m[1]) } })
      child.once('exit', code => { clearTimeout(give); reject(new Error(`server exited (${code}):\n${log}`)) })
    })
    apiBase = `http://127.0.0.1:${port}`
    delete process.env.OPENGYM_DATA
    const { createMcpHandler } = await import('../src/http.js')
    const handle = createMcpHandler({ apiUrl: apiBase, allowedOrigins: ['https://gym.example.com'] })
    mcp = http.createServer((req, res) => handle(req, res))
    await new Promise(r => mcp.listen(0, '127.0.0.1', r))
    mcpUrl = `http://127.0.0.1:${mcp.address().port}/mcp`
  }, 30000)
  afterAll(() => { child?.kill('SIGKILL'); mcp?.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  test('no token, a junk one or a paired session: 401 with a Bearer challenge', async () => {
    for (const h of [{}, { Authorization: 'Bearer ogt_nope' }, { Authorization: 'Bearer ' + session(A) }, { Authorization: 'Bearer ogt_' + 'a'.repeat(43) }]) {
      const r = await post(h)
      expect(r.status).toBe(401)
      expect(r.headers.get('www-authenticate')).toMatch(/^Bearer /)
    }
    const { token } = await makeToken(A, { workouts: 'view' })
    expect((await post({ Authorization: 'Bearer ' + token, Origin: 'https://evil.example' })).status).toBe(403)
    expect((await fetch(mcpUrl, { headers: { Authorization: 'Bearer ' + token } })).status).toBe(405)
    expect((await fetch(mcpUrl.replace('/mcp', '/mcp/health'))).status).toBe(200)
  })

  test('with the public origin known, the 401 points Claude and ChatGPT at the OAuth discovery (coach-146)', async () => {
    const { createMcpHandler } = await import('../src/http.js')
    const handle = createMcpHandler({ apiUrl: apiBase, allowedOrigins: [], publicOrigin: 'https://gym.example.com' })
    const srv = http.createServer((req, res) => handle(req, res))
    await new Promise(r => srv.listen(0, '127.0.0.1', r))
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(r.status).toBe(401)
      expect(r.headers.get('www-authenticate')).toContain('resource_metadata="https://gym.example.com/.well-known/oauth-protected-resource/mcp"')
    } finally { srv.close() }
  })

  test('a read-only token lists read tools of its categories and reads its own profile', async () => {
    const { token } = await makeToken(A, { workouts: 'view' })
    const client = await connect(token)
    const names = (await client.listTools()).tools.map(t => t.name).sort()
    expect(names).toEqual(['estimate_1rm', 'get_workout', 'list_workouts', 'muscle_balance', 'search_exercises'])
    const w = await call(client, 'list_workouts')
    expect(JSON.stringify(w)).toContain('Ana day')
    expect(JSON.stringify(w)).not.toContain('Bo day')
    // A tool it was not given is not there to call.
    const r = await client.callTool({ name: 'log_workout', arguments: { exercises: [{ exercise: 'squat', sets: [{ reps: 5 }] }] } }).catch(e => ({ thrown: e.message }))
    expect(JSON.stringify(r)).toMatch(/not found|Tool log_workout/i)
    await client.close()
  })

  test('two tokens, two profiles, never crossed', async () => {
    const a = await connect((await makeToken(A, { plans: 'view' })).token)
    const b = await connect((await makeToken(B, { plans: 'view' })).token)
    const [ra, rb] = await Promise.all([call(a, 'list_routines'), call(b, 'list_routines')])
    expect(ra.routines[0].name).toBe('Ana push')
    expect(rb.routines[0].name).toBe('Bo push')
    await a.close(); await b.close()
  })

  test('plans at apply: create, update over the exact revision, delete with confirm, and nothing else', async () => {
    const { token } = await makeToken(A, { plans: 'apply', workouts: 'view' })
    const client = await connect(token)
    const names = (await client.listTools()).tools.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['create_routine', 'update_routine', 'delete_routine', 'list_routines']))
    expect(names).not.toContain('log_workout')

    const made = await call(client, 'create_routine', { name: 'Legs', exercises: [{ exercise: 'squat', sets: 5, reps: 5, weight: 100 }, { exercise: 'plank', seconds: 60 }], weekdays: ['thursday'] })
    expect(made.saved).toBe(true)
    const id = made.routine.id
    expect(made.routine.weekdays).toEqual(['thursday'])
    let S = stored(A)
    expect(S.routines.map(r => r.name)).toEqual(['Ana push', 'Legs'])
    expect(S.week[4]).toEqual([id])
    expect(S.coach.chat[0].text).toBe('private')
    expect(S.workouts).toHaveLength(1)

    const got = await call(client, 'get_routine', { routine_id: 'r1' })
    expect(got.revision).toBe(S._rev)
    // Something else writes in between: the confirmed edit is refused, not retried.
    const put = await fetch(apiBase + '/api/data', { method: 'PUT', headers: { Cookie: cookie(A), 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { ...S, restSec: 90 }, baseRev: S._rev }) })
    expect(put.status).toBe(200)
    const stale = await call(client, 'update_routine', { routine_id: 'r1', exercises: [{ exercise: '0025', sets: 5 }], expected_revision: got.revision })
    expect(stale).toMatchObject({ saved: false, conflict: true })
    expect(stored(A).routines[0].ex[0].sets).toBe(3)
    const fresh = await call(client, 'get_routine', { routine_id: 'r1' })
    const ok = await call(client, 'update_routine', { routine_id: 'r1', exercises: [{ exercise: '0025', sets: 5 }], expected_revision: fresh.revision })
    expect(ok.saved).toBe(true)
    expect(stored(A).routines[0].ex[0]).toMatchObject({ id: '0025', sets: 5, reps: 5, weight: 100, restSec: 180 })

    const del = await call(client, 'delete_routine', { routine_id: id, confirm: true, expected_revision: ok.revision })
    expect(del.saved).toBe(true)
    S = stored(A)
    expect(S.routines.map(r => r.id)).toEqual(['r1'])
    expect(S.week[4]).toBeUndefined()
    // The other profile never moved.
    expect(stored(B).routines).toHaveLength(1)
    await client.close()
  })

  test('workouts at apply: log_workout goes through the token route', async () => {
    const { token } = await makeToken(B, { workouts: 'apply' })
    const client = await connect(token)
    const r = await call(client, 'log_workout', { date: '2026-10-20', exercises: [{ exercise: 'dumbbell curl', sets: [{ reps: 12, weight: 12 }] }] })
    expect(r.logged).toBe(true)
    const S = stored(B)
    expect(S.workouts).toHaveLength(2)
    expect(S.routines[0].name).toBe('Bo push')
    expect(S.coach.chat[0].text).toBe('private')
    await client.close()
  })

  test('a body over 1 MB gets its 413, not a reset connection', async () => {
    const r = await fetch(mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer ogt_' + 'a'.repeat(43), 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(1.5 * 1024 * 1024) }) })
    expect(r.status).toBe(413)
  })

  test('a revoked token is turned away on its next request', async () => {
    const { token, id } = await makeToken(A, { workouts: 'view' })
    const client = await connect(token)
    expect((await call(client, 'list_workouts')).workouts).toBeTruthy()
    const rv = await fetch(apiBase + '/api/tokens/revoke', { method: 'POST', headers: { Cookie: cookie(A), 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    expect((await rv.json()).revoked).toBe(1)
    expect((await post({ Authorization: 'Bearer ' + token })).status).toBe(401)
    await client.close().catch(() => {})
  })
})
