import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import { CATALOGUE } from '../../frontend/src/lib/exercises.js'
import { createServer } from '../src/server.js'

const origin = 'https://gym.example.test'
const prefix = '/connector'
const callback = 'https://claude.ai/api/mcp/auth_callback'
const verifier = 'a'.repeat(43)
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
const uuid = '12345678-1234-4234-8234-123456789abc'
const exId = CATALOGUE[0].id
const state = () => ({ name: 'Private', unit: 'kg', routines: [{ id: 'r1', name: 'Squat', ex: [{ id: exId, sets: 3, reps: 5 }] }], workouts: [{ id: 'w1', name: 'Mon', d: '2026-10-19', entries: [] }], bodyweight: [], week: {} })

// A fake openGym API plus the real connector server, connected through the real OAuth flow.
async function fixture(t, { toolTimeoutMs, bodyTimeoutMs } = {}) {
  const s = { profile: state(), rev: 1, me: 200, data: 200, admin: 403, delay: 0, inflight: 0, maxInflight: 0, meAdmin: false,
    invites: [{ code: 'ABCDEF0123456789', note: 'for Sam', created: 'c', createdBy: 'uid1', usedBy: 'x', usedAt: 'u', usedByName: 'Someone' },
      { code: 'FEDCBA9876543210', note: '', created: 'c', createdBy: 'uid1' }] }
  const seen = []
  const api = http.createServer((req, res) => {
    let text = ''
    req.on('data', chunk => { text += chunk })
    req.on('end', () => {
      seen.push({ path: req.url, method: req.method, authorization: req.headers.authorization, cookie: req.headers.cookie, text })
      const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
      if (req.url === '/api/login/verify') return send(200, { user: { id: 'uid1' } }, { 'set-cookie': '__Host-gymsid=private; Secure' })
      if (req.url === '/api/login/options') return send(200, { cid: 'cid-1', options: { challenge: 'challenge-1', allowCredentials: [] } })
      if (req.url === '/api/pair/create') return send(200, { code: 'ABCD2345' })
      if (req.url === '/api/pair/redeem') return send(200, { user: { id: 'uid1' }, token: 'private-bearer' })
      if (req.url === '/api/me') return send(s.me, s.me === 200 ? { user: { id: 'uid1', admin: s.meAdmin } } : { code: 'disabled', secret: 'never-return' })
      if (req.url === '/api/admin/users') return send(s.admin, s.admin === 200 ? { users: [] } : { error: 'forbidden', secret: 'never-return' })
      if (req.url === '/api/admin/invites') return send(s.admin, s.admin === 200 ? { invites: s.invites, invite_only: true } : { error: 'forbidden', secret: 'never-return' })
      if (req.url === '/api/admin/invites/new') { s.invites.push({ code: '1234ABCD5678EF01', note: JSON.parse(text).note, createdBy: 'uid1', created: 'now' }); return send(s.admin, { invite: s.invites.at(-1) }) }
      if (req.url === '/api/admin/invites/revoke') { s.invites = s.invites.filter(i => i.code !== JSON.parse(text).code); return send(s.admin, { ok: true }) }
      if (req.url === '/api/data' && req.method === 'GET') {
        s.maxInflight = Math.max(s.maxInflight, ++s.inflight)
        return setTimeout(() => { s.inflight--; send(s.data, s.data === 200 ? { state: s.profile, rev: s.rev } : { code: 'disabled', secret: 'never-return' }) }, s.delay)
      }
      if (req.url === '/api/data' && req.method === 'PUT') { s.profile = JSON.parse(text).state; s.rev++; return send(200, { rev: s.rev }) }
      if (req.url === '/api/data/rev') return send(200, { rev: s.rev, wid: 'w' })
      return send(404, {})
    })
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const server = createServer({ origin, prefix, apiBase: `http://127.0.0.1:${api.address().port}`, key: crypto.randomBytes(32), toolTimeoutMs, bodyTimeoutMs })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); api.closeAllConnections(); await new Promise(resolve => api.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (path, value, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof value === 'string' ? value : JSON.stringify(value) })
  const client = await (await post('/connector/register', { redirect_uris: [callback] })).json()
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: origin + prefix + '/mcp' })
  const auth = await fetch(base + '/connector/authorize?' + params, { redirect: 'manual' })
  const connected = await post('/connector/connect', { cid: 'cid1', credential: { id: 'cred', response: {} } }, { cookie: auth.headers.get('set-cookie').split(';')[0], origin })
  assert.equal(connected.status, 200)
  const code = new URL((await connected.json()).redirect).searchParams.get('code')
  const tokens = await (await post('/connector/token', { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback, code, code_verifier: verifier })).json()
  const setup = seen.length
  const rpc = (body, headers = {}) => post('/connector/mcp', body, { authorization: `Bearer ${tokens.access_token}`, ...headers })
  const call = (method, params = {}, id = 1, token = tokens.access_token) => post('/connector/mcp', { jsonrpc: '2.0', id, method, params }, { authorization: `Bearer ${token}` })
  // A tool call that must reach the tool: text-only content, parsed.
  const tool = async (name, args = {}) => {
    const reply = await call('tools/call', { name, arguments: args })
    assert.equal(reply.status, 200)
    const { result } = await reply.json()
    assert.ok(result.content.every(c => c.type === 'text' && Object.keys(c).length === 2), 'text content only')
    return { ...result, data: JSON.parse(result.content[0].text) }
  }
  const hits = (path, method = 'GET') => seen.slice(setup).filter(x => x.path === path && x.method === method).length
  return { s, base, post, rpc, call, tool, tokens, client, seen, setup, hits }
}

test('initialize negotiates a version, ping answers, initialized is 202 with no body, GET is 405', async t => {
  const f = await fixture(t)
  const init = await (await f.call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Claude', version: '1' } })).json()
  assert.equal(init.id, 1)
  assert.equal(init.result.protocolVersion, '2025-03-26')
  assert.deepEqual(Object.keys(init.result.capabilities), ['tools'])
  assert.equal((await (await f.call('initialize', { protocolVersion: '1999-01-01' })).json()).result.protocolVersion, '2025-06-18')
  assert.deepEqual((await (await f.call('ping')).json()).result, {})
  const note = await f.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(note.status, 202)
  assert.equal(await note.text(), '')
  const get = await fetch(f.base + '/connector/mcp')
  assert.equal(get.status, 405)
  assert.equal(get.headers.get('allow'), 'POST')
})

test('tools/list documents exact tool and input names; irreversible tools demand the link, not chat approval', async t => {
  const f = await fixture(t)
  const tools = (await (await f.call('tools/list')).json()).result.tools
  const props = name => Object.keys(tools.find(x => x.name === name).inputSchema.properties).sort()
  assert.deepEqual(tools.map(x => x.name).sort(), [
    'change_setting', 'clear_audit_log', 'delete_account', 'delete_routine', 'delete_workout', 'disable_account', 'disconnect_coach',
    'estimate_1rm', 'get_audit_log', 'get_bodyweight', 'get_coach_status', 'get_routine', 'get_user', 'get_week_plan', 'get_workout',
    'list_invites', 'list_routines', 'list_users', 'list_workouts', 'log_body_weight', 'log_measurement', 'log_workout',
    'muscle_balance', 'preview_session', 'request_create_invite', 'request_revoke_invite', 'search_exercises', 'sweep_media', 'update_week_plan',
  ])
  const plan = tools.find(x => x.name === 'update_week_plan').inputSchema
  assert.deepEqual(props('update_week_plan'), ['routines', 'week'])
  assert.deepEqual(Object.keys(plan.properties.routines.items.properties).sort(), ['creationId', 'ex', 'id', 'name'])
  assert.deepEqual(Object.keys(plan.properties.week.properties), ['0', '1', '2', '3', '4', '5', '6'])
  assert.deepEqual(props('log_workout'), ['creationId', 'date', 'durationMin', 'exercises', 'name'])
  assert.deepEqual(props('log_body_weight'), ['date', 'weight'])
  assert.deepEqual(props('log_measurement'), ['date', 'valuesCm'])
  assert.deepEqual(props('change_setting'), ['key', 'value'])
  assert.deepEqual(props('delete_routine'), ['id'])
  assert.deepEqual(props('disconnect_coach'), ['provider'])
  assert.match(tools.find(x => x.name === 'update_week_plan').description, /creationId/)
  assert.deepEqual(props('request_create_invite'), ['note'])
  assert.deepEqual(props('request_revoke_invite'), ['ref'])
  for (const name of ['delete_routine', 'delete_workout', 'disable_account', 'delete_account', 'clear_audit_log', 'disconnect_coach', 'sweep_media', 'request_create_invite', 'request_revoke_invite']) {
    const d = tools.find(x => x.name === name).description
    assert.match(d, /confirmation link/i, name)
    assert.match(d, /chat approval is insufficient/i, name)
  }
  for (const x of tools) assert.equal(x.inputSchema.additionalProperties, false, x.name)
})

test('a read tool returns text and calls openGym only with the stored bearer, never a cookie', async t => {
  const f = await fixture(t)
  const r = await f.tool('list_routines')
  assert.equal(r.isError, undefined)
  assert.equal(r.data.routines[0].name, 'Squat')
  const calls = f.seen.slice(f.setup)
  assert.ok(calls.length > 0)
  assert.ok(calls.every(x => !x.cookie && x.authorization === 'Bearer private-bearer'))
})

test('an ordinary edit writes the caller\'s own profile through updateProfile', async t => {
  const f = await fixture(t)
  const r = await f.tool('log_body_weight', { date: '2026-10-19', weight: 75 })
  assert.equal(r.data.weight, 75)
  assert.equal(f.s.profile.bodyweight[0].w, 75)
  assert.equal(f.hits('/api/data', 'PUT'), 1)
})

test('delete tools and sweep_media only mint a confirmation URL and execute nothing', async t => {
  const f = await fixture(t)
  for (const [name, args] of [['delete_routine', { id: 'r1' }], ['delete_workout', { id: 'w1' }], ['sweep_media', {}]]) {
    const r = await f.tool(name, args)
    assert.deepEqual(Object.keys(r.data), ['url'], name)
    assert.match(r.data.url, /^https:\/\/gym\.example\.test\/connector\/confirm#[A-Za-z0-9_-]{43}$/, name)
  }
  assert.equal(f.seen.slice(f.setup).some(x => x.method === 'PUT' || x.method === 'POST'), false)
  assert.equal(f.s.profile.routines.length, 1)
  assert.equal(f.s.profile.workouts.length, 1)
})

test('admin actions mint nothing for a non-admin caller and execute nothing', async t => {
  const f = await fixture(t)
  for (const [name, args] of [['disable_account', { id: 'uid2' }], ['delete_account', { id: 'uid2' }], ['clear_audit_log', {}], ['disconnect_coach', { provider: 'openai' }]]) {
    const r = await f.tool(name, args)
    assert.equal(r.isError, true, name)
    assert.deepEqual(r.data, { error: 'tool failed' }, name)
  }
  assert.equal(f.seen.slice(f.setup).some(x => x.method === 'POST' || x.method === 'PUT'), false)
})

test('invite tools: Claude sees refs and a link, never a code; the code appears once, in the confirmed browser execute', async t => {
  const f = await fixture(t)
  f.s.admin = 200
  f.s.meAdmin = true
  const listed = await f.tool('list_invites')
  assert.equal(listed.isError, undefined)
  assert.equal(listed.data.invites.length, 2)
  assert.ok(listed.data.invites.every(i => /^[A-Za-z0-9_-]{22}$/.test(i.ref)))
  const created = await f.tool('request_create_invite', { note: 'for Kim' })
  const revoked = await f.tool('request_revoke_invite', { ref: listed.data.invites[1].ref })
  for (const r of [created, revoked]) {
    assert.equal(r.isError, undefined)
    assert.deepEqual(Object.keys(r.data), ['url'])
  }
  const used = await f.tool('request_revoke_invite', { ref: listed.data.invites[0].ref })
  assert.deepEqual(used.data, { error: 'tool failed' })
  assert.equal(f.seen.slice(f.setup).some(x => x.method === 'POST' && x.path.startsWith('/api/admin/')), false, 'nothing executed from chat')
  const page = (route, id, body = {}) => f.post(`/connector/confirm/${route}`, { id, ...body }, { origin })
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
  const credential = { id: 'cred', rawId: 'Y3JlZA', type: 'public-key', response: { clientDataJSON: encode({ type: 'webauthn.get', challenge: 'challenge-1', origin }), authenticatorData: 'YQ', signature: 'Yg' } }
  const id = new URL(created.data.url).hash.slice(1)
  const details = await (await page('details', id)).text()
  assert.doesNotMatch(details, /1234ABCD5678EF01/)
  assert.equal((await page('challenge', id)).status, 200)
  const done = await page('execute', id, { cid: 'cid-1', credential })
  assert.equal(done.status, 200)
  assert.deepEqual((await done.json()).reveal, { label: 'Invite code', value: '1234ABCD5678EF01' })
  assert.equal((await page('execute', id, { cid: 'cid-1', credential })).status, 400, 'no second reveal')
  assert.equal(f.hits('/api/admin/invites/new', 'POST'), 1)
  // Back in chat the new invite is listed by ref; the code never crosses.
  const after = await f.tool('list_invites')
  assert.equal(after.data.invites.length, 3)
  assert.doesNotMatch(JSON.stringify([listed, created, revoked, used, after]), /ABCDEF0123456789|FEDCBA9876543210|1234ABCD5678EF01/)
})

test('invite tools mint nothing for a non-admin caller', async t => {
  const f = await fixture(t)
  for (const [name, args] of [['request_create_invite', {}], ['request_revoke_invite', { ref: 'A'.repeat(22) }]]) {
    const r = await f.tool(name, args)
    assert.equal(r.isError, true, name)
    assert.deepEqual(r.data, { error: 'tool failed' }, name)
  }
  for (const args of [{ note: 'x'.repeat(61) }, { note: 'ok', code: 'ABCDEF0123456789' }]) {
    assert.deepEqual((await f.tool('request_create_invite', args)).data, { error: 'invalid arguments' })
  }
  assert.deepEqual((await f.tool('request_revoke_invite', { code: 'ABCDEF0123456789' })).data, { error: 'invalid arguments' })
  assert.equal(f.seen.slice(f.setup).some(x => x.method === 'POST' || x.method === 'PUT'), false)
})

test('missing, malformed, revoked and disabled-user tokens execute no tool', async t => {
  const f = await fixture(t)
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_routines', arguments: {} } }
  assert.equal((await f.post('/connector/mcp', body)).status, 401)
  assert.equal((await f.call('tools/call', body.params, 1, 'invalid')).status, 401)
  assert.equal((await f.call('tools/call', body.params, 1, 'a'.repeat(43))).status, 401)
  const challenged = await f.call('tools/call', body.params, 1, 'invalid')
  assert.equal(challenged.headers.get('www-authenticate'), 'Bearer resource_metadata="https://gym.example.test/connector/.well-known/oauth-protected-resource"')
  assert.equal(f.hits('/api/data'), 0)
  f.s.me = 401
  const disabled = await f.call('tools/call', body.params)
  assert.equal(disabled.status, 401)
  assert.doesNotMatch(await disabled.text(), /never-return|private-bearer|disabled/)
  f.s.me = 200
  assert.equal((await f.call('ping')).status, 401, 'a disabled account is revoked for good')
  assert.equal((await f.post('/connector/token', { grant_type: 'refresh_token', client_id: f.client.client_id, refresh_token: f.tokens.refresh_token })).status, 400)
  assert.equal(f.hits('/api/data'), 0)
})

test('a client-revoked grant executes no tool', async t => {
  const f = await fixture(t)
  assert.equal((await f.post('/connector/revoke', { client_id: f.client.client_id, token: f.tokens.refresh_token })).status, 200)
  assert.equal((await f.call('tools/call', { name: 'list_routines', arguments: {} })).status, 401)
  assert.equal(f.hits('/api/data'), 0)
})

test('oversized bodies are refused before any tool or upstream call', async t => {
  const f = await fixture(t)
  const huge = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', padding: 'x'.repeat(40_000) })
  assert.equal((await f.rpc(huge)).status, 413)
  const chunked = await fetch(f.base + '/connector/mcp', { method: 'POST', headers: { authorization: `Bearer ${f.tokens.access_token}`, 'content-type': 'application/json' }, body: new Blob([huge]).stream(), duplex: 'half' })
  assert.equal(chunked.status, 413)
  assert.equal(f.seen.length, f.setup, 'not even the identity check ran')
})

test('JSON-RPC shape is validated: batches, ids, version, method, params, parse errors, content type', async t => {
  const f = await fixture(t)
  const code = async body => (await (await f.rpc(body)).json()).error.code
  const batch = await (await f.rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).json()
  assert.equal(batch.error.code, -32600)
  assert.match(batch.error.message, /batch/i)
  for (const id of [{}, [], true, null, 1.5, 'x'.repeat(300)]) assert.equal(await code({ jsonrpc: '2.0', id, method: 'ping' }), -32600, JSON.stringify(id))
  assert.equal(await code({ id: 1, method: 'ping' }), -32600)
  assert.equal(await code({ jsonrpc: '1.0', id: 1, method: 'ping' }), -32600)
  assert.equal(await code({ jsonrpc: '2.0', id: 1 }), -32600)
  assert.equal(await code({ jsonrpc: '2.0', id: 1, method: 'ping', params: 5 }), -32600)
  assert.equal(await code({ jsonrpc: '2.0', id: 1, method: 'resources/list' }), -32601)
  assert.equal(await code('{nope'), -32700)
  assert.equal((await (await f.rpc({ jsonrpc: '2.0', method: 'whatever' })).json()).error.code, -32601)
  assert.equal((await (await f.call('ping', {}, 'abc')).json()).id, 'abc')
  assert.equal((await (await f.call('ping', {}, 7)).json()).id, 7)
  assert.equal((await f.rpc(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), { 'content-type': 'text/plain' })).status, 415)
  assert.equal(f.hits('/api/data'), 0)
})

test('tool arguments are strict: unknown, credential-like and nested extra fields run nothing', async t => {
  const f = await fixture(t)
  const ex = { id: exId, sets: 3, reps: 5 }
  const plan = extra => ({ week: { 1: [uuid] }, routines: [{ creationId: uuid, name: 'A', ex: [ex] }], ...extra })
  const cases = [
    ['list_routines', { bearer: 'steal' }], ['list_routines', { cookie: 'gymsid=1' }], ['list_routines', { userId: 'uid2' }],
    ['list_routines', { connectionId: 'conn' }], ['list_routines', { path: '/api/admin/users', method: 'POST' }],
    ['list_routines', { profile: {} }], ['list_routines', { state: {} }], ['get_routine', { routine_id: 'r1', extra: 1 }],
    ['get_routine', 'r1'], ['get_routine', ['r1']], ['get_routine', {}], ['get_routine', { routine_id: 5 }],
    ['log_body_weight', { date: '2026-10-19', weight: 75, userId: 'uid2' }], ['log_body_weight', { date: '2026-10-19', weight: '75' }],
    ['log_measurement', { date: '2026-10-19', valuesCm: { waist: 90, userId: 'uid2' } }],
    ['log_workout', { creationId: uuid, date: '2026-10-19', exercises: [{ id: exId, sets: [{ weight: 50, reps: 5, bearer: 'x' }] }] }],
    ['log_workout', { creationId: uuid, date: '2026-10-19', exercises: [{ id: exId, sets: [{ weight: 50, reps: 5 }], state: {} }] }],
    ['update_week_plan', plan({ routines: [{ creationId: uuid, name: 'A', ex: [{ ...ex, bearer: 'x' }] }] })],
    ['update_week_plan', plan({ routines: [{ creationId: uuid, name: 'A', ex: [ex], userId: 'uid2' }] })],
    ['update_week_plan', plan({ profile: {} })], ['update_week_plan', plan({ week: { x: [uuid] } })], ['update_week_plan', plan({ week: { 7: [uuid] } })],
    ['update_week_plan', JSON.parse('{"week":{"__proto__":["x"]},"routines":[]}')],
    ['delete_routine', { id: 'r1', connectionId: 'other' }], ['delete_routine', { id: 'x'.repeat(201) }], ['delete_routine', {}],
    ['disconnect_coach', { provider: 'openai', baseUrl: 'http://evil' }], ['change_setting', { key: 'theme', value: 'dark', userId: 'uid2' }],
    ['change_setting', { key: 'theme', value: { nested: true } }],
  ]
  for (const [name, args] of cases) {
    const { result } = await (await f.call('tools/call', { name, arguments: args })).json()
    assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`)
    assert.deepEqual(JSON.parse(result.content[0].text), { error: 'invalid arguments' }, `${name} ${JSON.stringify(args)}`)
  }
  const unknown = (await (await f.call('tools/call', { name: 'reset_everything', arguments: {} })).json()).result
  assert.equal(unknown.isError, true)
  const extra = (await (await f.call('tools/call', { name: 'list_routines', arguments: {}, bearer: 'x' })).json()).result
  assert.equal(extra.isError, true)
  assert.deepEqual(f.seen.slice(f.setup).filter(x => x.path !== '/api/me'), [], 'only the identity check reached openGym')
})

test('update_week_plan creates a routine under the caller-supplied creationId once, and refuses a missing one', async t => {
  const f = await fixture(t)
  const args = { week: { 1: [uuid] }, routines: [{ creationId: uuid, name: 'Push', ex: [{ id: exId, sets: 3, reps: 8 }] }] }
  const first = await f.tool('update_week_plan', args)
  assert.equal(first.isError, undefined)
  assert.equal(first.data.routines[0].id, uuid)
  const replay = await f.tool('update_week_plan', args)
  assert.equal(replay.isError, undefined)
  assert.equal(f.s.profile.routines.filter(r => r.id === uuid).length, 1, 'a replay never duplicates')
  assert.deepEqual(f.s.profile.week['1'], [uuid])
  const puts = f.hits('/api/data', 'PUT')
  for (const routine of [{ name: 'No id', ex: [{ id: exId, sets: 3 }] }, { id: 'r1', creationId: uuid, name: 'Both', ex: [{ id: exId, sets: 3 }] }]) {
    assert.equal((await f.tool('update_week_plan', { week: { 2: ['r1'] }, routines: [routine] })).isError, true)
  }
  assert.equal(f.hits('/api/data', 'PUT'), puts)
})

test('a live queue blocks plan edits: reported as an error, nothing written', async t => {
  const f = await fixture(t)
  f.s.profile.queue = { ids: ['r1'], label: 'Block', since: Date.now() }
  const r = await f.tool('update_week_plan', { week: { 1: ['r1'] }, routines: [{ id: 'r1', ex: [{ id: exId, sets: 4 }] }] })
  assert.equal(r.isError, true)
  assert.match(r.data.error, /live queue/i)
  assert.equal(f.hits('/api/data', 'PUT'), 0)
})

test('profile 401 during a tool revokes the grant; a queued call never executes', async t => {
  const f = await fixture(t)
  f.s.data = 401
  f.s.delay = 40
  const statuses = (await Promise.all([1, 2].map(() => f.call('tools/call', { name: 'list_routines', arguments: {} })))).map(r => r.status)
  assert.deepEqual(statuses, [401, 401])
  assert.doesNotMatch(await (await f.call('ping')).text(), /private-bearer|never-return|disabled/)
  f.s.data = 200
  assert.equal((await f.call('ping')).status, 401)
  assert.equal((await f.post('/connector/token', { grant_type: 'refresh_token', client_id: f.client.client_id, refresh_token: f.tokens.refresh_token })).status, 400)
  assert.equal(f.hits('/api/data'), 1)
})

test('profile 403 during a tool is a generic error and does not revoke', async t => {
  const f = await fixture(t)
  f.s.data = 403
  const r = await f.tool('list_routines')
  assert.deepEqual(r.data, { error: 'tool failed' })
  assert.doesNotMatch(JSON.stringify(r), /never-return|disabled|forbidden/)
  f.s.data = 200
  assert.equal((await f.call('ping')).status, 200)
  assert.equal((await f.post('/connector/token', { grant_type: 'refresh_token', client_id: f.client.client_id, refresh_token: f.tokens.refresh_token })).status, 200)
})

test('non-admin list_users is admin-only: grant kept, ping and refresh still work', async t => {
  const f = await fixture(t)
  const r = await f.tool('list_users')
  assert.equal(r.isError, true)
  assert.deepEqual(r.data, { error: 'admin only' })
  assert.doesNotMatch(JSON.stringify(r), /never-return|forbidden/)
  assert.equal((await f.call('ping')).status, 200)
  assert.equal((await f.post('/connector/token', { grant_type: 'refresh_token', client_id: f.client.client_id, refresh_token: f.tokens.refresh_token })).status, 200)
})

test('calls for one user run one at a time', async t => {
  const f = await fixture(t)
  f.s.delay = 40
  const replies = await Promise.all([1, 2, 3].map(() => f.tool('list_routines')))
  assert.ok(replies.every(r => r.isError === undefined))
  assert.equal(f.s.maxInflight, 1)
})

test('a slow tool is cut off with a generic error but keeps its slot until it settles', async t => {
  const f = await fixture(t, { toolTimeoutMs: 50 })
  f.s.delay = 250
  const started = Date.now()
  const slow = await f.tool('list_routines')
  assert.equal(slow.isError, true)
  assert.match(slow.data.error, /timed out/)
  assert.ok(Date.now() - started < 200, 'answered at the timeout, not at completion')
  f.s.delay = 0
  assert.equal((await f.tool('list_routines')).isError, undefined)
  assert.equal(f.s.maxInflight, 1, 'the next call waited for the abandoned one')
})

test('results are capped, never carry media or credentials, and upstream failures stay generic', async t => {
  const f = await fixture(t)
  f.s.profile.routines = Array.from({ length: 400 }, (_, i) => ({ id: `r${i}`, name: 'x'.repeat(300), ex: [] }))
  const big = await f.tool('list_routines')
  assert.equal(big.isError, true)
  assert.match(big.data.error, /too large/)
  assert.ok(big.content[0].text.length < 200)
  f.s.profile = state()
  for (const name of ['/media/private.gif', 'data:image/png;base64,AAAA', 'private-bearer']) {
    f.s.profile.routines[0].name = name
    const r = await f.tool('list_routines')
    assert.equal(r.isError, true, name)
    assert.doesNotMatch(JSON.stringify(r), /private|AAAA/)
  }
  f.s.profile.routines[0].name = 'Bearer crawl and cookie diet'
  assert.equal((await f.tool('list_routines')).isError, undefined, 'ordinary words are not secrets')
  f.s.data = 500
  const failed = await f.tool('list_routines')
  assert.deepEqual(failed.data, { error: 'tool failed' })
  assert.doesNotMatch(JSON.stringify(failed), /500|never-return/)
})

test('unknown notifications are rejected as unknown methods, initialized remains 202', async t => {
  const f = await fixture(t)
  const unknown = await f.rpc({ jsonrpc: '2.0', method: 'notifications/unknown' })
  assert.equal(unknown.status, 200)
  assert.equal((await unknown.json()).error.code, -32601)
  assert.equal((await f.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
})

test('image URLs and base64 bytes in otherwise safe profile fields are never returned', async t => {
  const f = await fixture(t)
  for (const name of ['https://cdn.example.test/a.jpeg', 'media/uploads/secret.webp', 'A'.repeat(512)]) {
    f.s.profile.routines[0].name = name
    const result = await f.tool('list_routines')
    assert.equal(result.isError, true, name.slice(0, 40))
    assert.doesNotMatch(JSON.stringify(result), /cdn.example|uploads\/secret|A{40}/)
  }
})

test('a stalled request body times out without calling openGym', async t => {
  const f = await fixture(t, { bodyTimeoutMs: 50 })
  const answer = await new Promise((resolve, reject) => {
    const req = http.request(f.base + '/connector/mcp', { method: 'POST', headers: { authorization: `Bearer ${f.tokens.access_token}`, 'content-type': 'application/json', 'content-length': '10' } }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.write('{')
    t.after(() => req.destroy())
  })
  assert.equal(answer.status, 408)
  assert.equal(f.seen.length, f.setup)
})
