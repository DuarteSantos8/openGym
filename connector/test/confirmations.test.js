import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createConfirmations, createDestructiveTools, ConfirmationError } from '../src/confirmations.js'
import { createServer } from '../src/server.js'
import { createProfileStore } from '../src/profileStore.js'
import { sealBearer } from '../src/openGymSession.js'

const origin = 'https://gym.example.test'
const prefix = '/connector'
const key = randomBytes(32)
const initial = () => ({
  name: 'private profile', routines: [{ id: 'r1', name: 'Squats', ex: [{ id: 'squat' }], media: '/media/private.gif' }, { id: 'r2', name: 'Bench' }],
  workouts: [{ id: 'w1', name: 'Monday', d: '2026-10-19', entries: [{ id: 'squat', sets: [{ w: 40, r: 5 }] }] }, { id: 'w2', name: 'Tuesday' }],
  week: { mon: ['r1', 'r2'], tue: ['r1'], wed: ['r2'] }, dayPlan: { '2026-10-19': 'r1', '2026-10-20': 'r2' }, _wid: 'wid-1',
})
const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
const credential = (challenge = 'challenge-1', from = origin) => ({
  id: 'cred', rawId: 'Y3JlZA', type: 'public-key',
  response: { clientDataJSON: encode({ type: 'webauthn.get', challenge, origin: from }), authenticatorData: 'YQ', signature: 'Yg' },
})
async function fixture({ now = () => Date.now(), executors } = {}) {
  let profile = initial(), rev = 1, cid = 0, verifyUser = 'uid1', puts = 0
  const seen = []
  const api = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const route = `${req.method} ${req.url}`
      seen.push({ route, headers: req.headers, body })
      const json = (code, data, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)) }
      if (route === 'POST /api/login/options') return json(200, { cid: `cid-${++cid}`, options: { challenge: 'challenge-1', allowCredentials: [] } })
      if (route === 'POST /api/login/verify') return json(200, { user: { id: verifyUser, name: 'Private', admin: true } }, { 'set-cookie': '__Host-gymsid=do-not-forward; Secure' })
      if (route === 'GET /api/data') return json(200, { state: profile, rev })
      if (route === 'PUT /api/data') {
        const proposed = JSON.parse(body)
        if (proposed.baseRev !== rev) return json(409, { error: 'conflict', state: profile, rev })
        profile = proposed.state; rev++; puts++
        return json(200, { ok: true, rev, wid: 'wid-1' })
      }
      if (route === 'GET /api/data/rev') return json(200, { rev, wid: 'wid-1' })
      return json(404, {})
    })
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const apiBase = `http://127.0.0.1:${api.address().port}`
  const connections = new Map([
    ['conn1', { userId: 'uid1', sealed: sealBearer('bearer-1', key, 'uid1') }],
    ['conn2', { userId: 'uid2', sealed: sealBearer('bearer-2', key, 'uid2') }],
  ])
  const service = createConfirmations({ connections, key, apiBase, origin, prefix, store: createProfileStore({ apiBase }), now, executors })
  return { service, connections, seen, get profile() { return profile }, set profile(value) { profile = value }, get puts() { return puts },
    set verifyUser(id) { verifyUser = id }, close: () => new Promise(resolve => api.close(resolve)) }
}
const idOf = url => new URL(url).hash.slice(1)
const bad = e => e instanceof ConfirmationError && e.message === 'invalid_confirmation'

for (const [type, targetId] of [['delete-routine', 'r1'], ['delete-workout', 'w1']]) {
  test(`${type}: tool only returns fragment URL; details then passkey execution deletes exactly one`, async t => {
    const f = await fixture(); t.after(f.close)
    const tool = createDestructiveTools(f.service).find(x => x.name === type.replace('-', '_'))
    const { url } = await tool.handler('conn1', { id: targetId })
    assert.equal(f.puts, 0)
    assert.equal(new URL(url).search, '')
    const id = idOf(url)
    assert.equal(f.service.pending.has(id), false)
    assert.ok([...f.service.pending.keys()].every(k => k.length === 43 && k !== id))
    const details = await f.service.details(id)
    assert.equal(details.summary.id, targetId)
    assert.match(details.summary.effect, type === 'delete-routine' ? /routine/ : /workout/)
    assert.match(details.digest, /^[A-Za-z0-9_-]{43}$/)
    assert.ok(!JSON.stringify(details).includes('/media/') && !JSON.stringify(details).includes('private profile'))
    const { cid, options } = await f.service.challenge(id)
    assert.equal(options.challenge, 'challenge-1')
    assert.deepEqual(await f.service.confirm(id, { cid, credential: credential() }), { deleted: { type, id: targetId } })
    assert.equal(f.puts, 1)
    assert.deepEqual(f.profile.routines.map(x => x.id), type === 'delete-routine' ? ['r2'] : ['r1', 'r2'])
    assert.deepEqual(f.profile.workouts.map(x => x.id), type === 'delete-workout' ? ['w2'] : ['w1', 'w2'])
    if (type === 'delete-routine') {
      assert.deepEqual(f.profile.week, { mon: ['r2'], wed: ['r2'] })
      assert.deepEqual(f.profile.dayPlan, { '2026-10-20': 'r2' })
    }
    assert.equal(f.seen.find(x => x.route === 'POST /api/login/verify').headers.cookie, undefined)
    assert.equal(f.seen.find(x => x.route === 'POST /api/login/verify').headers.authorization, undefined)
    assert.equal(f.seen.some(x => /pair|register|reset|backup|admin|media/.test(x.route)), false)
    await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
    assert.equal(f.puts, 1)
  })
}

test('workout deletion warns about linked photos without returning their paths', async t => {
  const f = await fixture(); t.after(f.close)
  f.profile = { ...f.profile, workouts: f.profile.workouts.map(w => w.id === 'w1' ? { ...w, media: [{ hash: 'private-photo-hash', url: '/media/private.webp' }] } : w) }
  const id = idOf((await f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1')).url)
  const details = await f.service.details(id)
  assert.match(details.summary.effect, /linked photos or videos/)
  assert.doesNotMatch(JSON.stringify(details.summary), /private-photo-hash|private\.webp/)
})

test('superseding request, expired ID, revoked connection, and other user all fail without writes', async t => {
  let clock = 1000
  const f = await fixture({ now: () => clock }); t.after(f.close)
  const action = { type: 'delete-routine', targetId: 'r1' }
  const first = idOf((await f.service.requestConfirmation(action, 'conn1')).url)
  const second = idOf((await f.service.requestConfirmation(action, 'conn1')).url)
  await assert.rejects(() => f.service.details(first), bad)
  await assert.rejects(() => f.service.confirm(first, {}), bad)
  await f.service.details(second); await f.service.challenge(second)
  f.verifyUser = 'uid2'
  await assert.rejects(() => f.service.confirm(second, { cid: 'cid-1', credential: credential() }), bad)
  assert.equal(f.puts, 0)
  const expired = idOf((await f.service.requestConfirmation(action, 'conn1')).url)
  clock += 10 * 60_000
  await assert.rejects(() => f.service.details(expired), bad)
  const revoked = idOf((await f.service.requestConfirmation(action, 'conn1')).url)
  f.connections.delete('conn1')
  await assert.rejects(() => f.service.details(revoked), bad)
  assert.equal(f.puts, 0)
})

test('wrong origin/challenge/type, no challenge, and changed target refuse execution', async t => {
  const f = await fixture(); t.after(f.close)
  for (const proof of [credential('wrong'), credential('challenge-1', 'https://other.test'),
    { ...credential(), response: { ...credential().response, clientDataJSON: encode({ type: 'webauthn.create', challenge: 'challenge-1', origin }) } }]) {
    const id = idOf((await f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1')).url)
    await f.service.details(id); await f.service.challenge(id)
    await assert.rejects(() => f.service.confirm(id, { cid: 'cid-1', credential: proof }), bad)
  }
  assert.equal(f.seen.some(x => x.route === 'POST /api/login/verify'), false)
  const noChallenge = idOf((await f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1')).url)
  await f.service.details(noChallenge)
  await assert.rejects(() => f.service.confirm(noChallenge, { cid: 'cid-1', credential: credential() }), bad)
  const changed = idOf((await f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1')).url)
  await f.service.details(changed)
  const minted = await f.service.challenge(changed)
  f.profile = { ...f.profile, workouts: f.profile.workouts.map(w => w.id === 'w1' ? { ...w, name: 'Edited' } : w) }
  await assert.rejects(() => f.service.confirm(changed, { cid: minted.cid, credential: credential() }), bad)
  assert.equal(f.puts, 0)
})

test('a cancelled ceremony can remint; only the latest challenge executes', async t => {
  const f = await fixture(); t.after(f.close)
  const id = idOf((await f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1')).url)
  await f.service.details(id)
  const first = await f.service.challenge(id)
  const second = await f.service.challenge(id)
  assert.notEqual(first.cid, second.cid)
  await assert.rejects(() => f.service.confirm(id, { cid: first.cid, credential: credential() }), bad)
  assert.equal(f.puts, 0)
  const again = idOf((await f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1')).url)
  await f.service.details(again)
  const a = await f.service.challenge(again)
  const b = await f.service.challenge(again)
  assert.notEqual(a.cid, b.cid)
  assert.deepEqual(await f.service.confirm(again, { cid: b.cid, credential: credential() }), { deleted: { type: 'delete-workout', id: 'w1' } })
  assert.equal(f.puts, 1)
})

test('disable-account without an injected executor cannot mint a confirmation', async t => {
  const f = await fixture(); t.after(f.close)
  const tool = createDestructiveTools(f.service).find(x => x.name === 'disable_account')
  await assert.rejects(() => tool.handler('conn1', { id: 'uid2' }), bad)
  assert.equal(f.service.pending.size, 0)
})

test('injected disable executor without authorize cannot mint', async t => {
  let executions = 0
  const f = await fixture({ executors: { 'disable-account': {
    inspect: async (_trusted, id) => ({ summary: { type: 'disable-account', id }, digest: 'account-version-1' }),
    execute: async () => { executions++; return { disabled: true } },
  } } }); t.after(f.close)
  await assert.rejects(() => f.service.requestConfirmation({ type: 'disable-account', targetId: 'uid2' }, 'conn1'), bad)
  assert.equal(f.service.pending.size, 0)
  assert.equal(executions, 0)
})

test('non-admin or unknown disable target cannot mint; approved admin target waits for passkey', async t => {
  let executions = 0
  const seenAuth = []
  let admin = true
  const allowed = new Set(['uid2'])
  const f = await fixture({ executors: { 'disable-account': {
    authorize: async (trusted, targetId) => {
      seenAuth.push({ trusted, targetId })
      if (!trusted || trusted.bearer !== 'bearer-1' || trusted.userId !== 'uid1') return false
      return admin && allowed.has(targetId)
    },
    inspect: async (_trusted, id) => ({ summary: { type: 'disable-account', id }, digest: 'account-version-1' }),
    execute: async () => { executions++; return { disabled: true } },
  } } }); t.after(f.close)
  const tool = createDestructiveTools(f.service).find(x => x.name === 'disable_account')
  await assert.rejects(() => tool.handler('conn1', { id: 'unknown-user' }), bad)
  admin = false
  await assert.rejects(() => tool.handler('conn1', { id: 'uid2' }), bad)
  assert.equal(f.service.pending.size, 0)
  assert.equal(executions, 0)
  admin = true
  const { url } = await tool.handler('conn1', { id: 'uid2' })
  assert.equal(executions, 0)
  const id = idOf(url)
  await f.service.details(id); await f.service.challenge(id)
  assert.equal(executions, 0)
  assert.deepEqual(await f.service.confirm(id, { cid: 'cid-1', credential: credential() }), { disabled: true })
  assert.equal(executions, 1)
  assert.ok(seenAuth.every(call => call.trusted && call.trusted.userId === 'uid1' && call.trusted.bearer === 'bearer-1' && !('admin' in call.trusted)))
})

test('authorization withdrawn after details or challenge denies execute', async t => {
  let allowed = true
  let executions = 0
  const f = await fixture({ executors: { 'disable-account': {
    authorize: async ({ userId, bearer }, targetId) => allowed && bearer === 'bearer-1' && userId === 'uid1' && targetId === 'uid2',
    inspect: async (_trusted, id) => ({ summary: { type: 'disable-account', id }, digest: 'account-version-1' }),
    execute: async () => { executions++; return { disabled: true } },
  } } }); t.after(f.close)
  const id = idOf((await f.service.requestConfirmation({ type: 'disable-account', targetId: 'uid2' }, 'conn1')).url)
  await f.service.details(id); await f.service.challenge(id)
  allowed = false
  await assert.rejects(() => f.service.confirm(id, { cid: 'cid-1', credential: credential() }), bad)
  assert.equal(executions, 0)
})

test('authorize is asked again right before execute: withdrawn on the last call still denies', async t => {
  let calls = 0, executions = 0
  const f = await fixture({ executors: { 'disable-account': {
    authorize: async () => { calls++; return calls < 4 }, // mint, details, confirm-inspect pass; pre-execute fails
    inspect: async (_trusted, id) => ({ summary: { type: 'disable-account', id }, digest: 'account-version-1' }),
    execute: async () => { executions++; return { disabled: true } },
  } } }); t.after(f.close)
  const id = idOf((await f.service.requestConfirmation({ type: 'disable-account', targetId: 'uid2' }, 'conn1')).url)
  await f.service.details(id); await f.service.challenge(id)
  await assert.rejects(() => f.service.confirm(id, { cid: 'cid-1', credential: credential() }), bad)
  assert.equal(calls, 4)
  assert.equal(executions, 0)
})

test('authorize must return exactly true: false, truthy values, and throws all fail closed', async t => {
  for (const answer of [false, undefined, null, 1, 'yes', {}, () => { throw new Error('upstream detail uid2') }]) {
    let executions = 0
    const f = await fixture({ executors: { 'disable-account': {
      authorize: async () => (typeof answer === 'function' ? answer() : answer),
      inspect: async (_trusted, id) => ({ summary: { type: 'disable-account', id }, digest: 'd' }),
      execute: async () => { executions++; return { disabled: true } },
    } } })
    try {
      await assert.rejects(() => f.service.requestConfirmation({ type: 'disable-account', targetId: 'uid2' }, 'conn1'), e => bad(e) && !String(e.message).includes('uid2'))
      assert.equal(f.service.pending.size, 0)
      assert.equal(executions, 0)
    } finally { await f.close() }
  }
})

test('disable-account requires injected executor; tool never executes on request or replay', async t => {
  let executions = 0
  const f = await fixture({ executors: { 'disable-account': {
    authorize: async ({ userId, bearer }, targetId) => bearer === 'bearer-1' && userId === 'uid1' && targetId === 'uid2',
    inspect: async (_trusted, id) => ({ summary: { type: 'disable-account', id }, digest: 'account-version-1' }),
    execute: async () => { executions++; return { disabled: true } },
  } } }); t.after(f.close)
  const tool = createDestructiveTools(f.service).find(x => x.name === 'disable_account')
  const one = idOf((await tool.handler('conn1', { id: 'uid2' })).url)
  const two = idOf((await tool.handler('conn1', { id: 'uid2' })).url)
  assert.equal(executions, 0)
  await assert.rejects(() => f.service.details(one), bad)
  await f.service.details(two); await f.service.challenge(two)
  assert.deepEqual(await f.service.confirm(two, { cid: 'cid-1', credential: credential() }), { disabled: true })
  await assert.rejects(() => f.service.confirm(two, { cid: 'cid-1', credential: credential() }), bad)
  assert.equal(executions, 1)
})

test('HTTP page is static, hardened, fragment-only; POSTs demand same-origin JSON', async t => {
  const f = await fixture(); t.after(f.close)
  const web = createServer({ origin, prefix, apiBase: 'unused', confirmations: f.service })
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => web.close(resolve)))
  const base = `http://127.0.0.1:${web.address().port}`
  const id = idOf((await f.service.requestConfirmation({ type: 'delete-routine', targetId: 'r1' }, 'conn1')).url)
  const page = await fetch(`${base}/connector/confirm?ignored=secret#${id}`)
  const html = await page.text()
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(page.headers.get('cache-control'), 'no-store')
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(!html.includes(id) && !html.includes('Squats') && !html.includes('private profile'))
  assert.ok(html.includes('textContent') && !html.includes('innerHTML'))
  const post = (path, opts = {}) => fetch(`${base}/connector/confirm/${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...opts.headers }, body: JSON.stringify({ id, ...opts.body }) })
  assert.equal((await post('details', { headers: { origin: 'https://evil.test' } })).status, 403)
  assert.equal((await post('details', { headers: { 'content-type': 'text/plain' } })).status, 400)
  assert.equal((await post('details')).status, 200)
  assert.equal((await post('challenge')).status, 200)
  const response = await post('execute', { body: { cid: 'cid-1', credential: credential() } })
  assert.equal(response.status, 200)
  assert.equal(f.puts, 1)
  assert.equal((await post('execute', { body: { cid: 'cid-1', credential: credential() } })).status, 400)
})


const rowsOf = n => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `Name ${i}`, date: '2026-10-19' }))

test('closed params are normalized, copied, frozen, forwarded at every authorization and bound to a superseding key', async t => {
  const calls = []
  const executors = { 'set-coach-key': {
    params: raw => ({ nested: { mode: raw.mode } }),
    authorize: async (trusted, id, params) => { calls.push(['authorize', trusted.userId, id, params]); return params?.nested.mode === 'replace' },
    inspect: async (trusted, id, params) => { calls.push(['inspect', params]); return { summary: { type: 'set-coach-key', id }, digest: 'd' } },
    execute: async (trusted, id, digest, params) => { calls.push(['execute', params, digest]); return { ok: true } },
  } }
  const f = await fixture({ executors }); t.after(f.close)
  const raw = { mode: 'replace' }
  const first = idOf((await f.service.requestConfirmation({ type: 'set-coach-key', targetId: 'new', params: raw }, 'conn1')).url)
  raw.mode = 'tampered'
  const stored = [...f.service.pending.values()][0].params
  assert.deepEqual(stored, { nested: { mode: 'replace' } })
  assert.throws(() => { stored.nested.mode = 'tampered' })
  await f.service.details(first); await f.service.challenge(first)
  assert.deepEqual(await f.service.confirm(first, { cid: 'cid-1', credential: credential() }), { ok: true })
  assert.deepEqual(calls.map(x => x[0]), ['authorize', 'authorize', 'inspect', 'authorize', 'inspect', 'authorize', 'execute'])
  assert.ok(calls.every(x => x[0] === 'authorize' ? x[3]?.nested.mode === 'replace' : x[1]?.nested.mode === 'replace'))
  const older = idOf((await f.service.requestConfirmation({ type: 'set-coach-key', targetId: 'new', params: { mode: 'replace' } }, 'conn1')).url)
  await f.service.requestConfirmation({ type: 'set-coach-key', targetId: 'new', params: { mode: 'replace', extra: 1 } }, 'conn1')
  await assert.rejects(() => f.service.details(older), bad)
})

test('params without a validator, throwing validators, invalid shapes, and oversized normalized objects refuse', async t => {
  const f = await fixture({ executors: { 'op': { authorize: async () => true, inspect: async () => ({ digest: 'd', summary: { type: 'op', id: 'new' } }), execute: async () => ({ ok: true }) } } }); t.after(f.close)
  await assert.rejects(() => f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1', params: {} }, 'conn1'), bad)
  await assert.rejects(() => f.service.requestConfirmation({ type: 'op', targetId: 'new', params: {} }, 'conn1'), bad)
  assert.equal(f.service.pending.size, 0)
  for (const result of [() => { throw new Error('private') }, () => [], () => new Date(), () => null, () => ({ secret: 'x'.repeat(4100) })]) {
    const g = await fixture({ executors: { 'op': { params: result, authorize: async () => true, inspect: async () => ({}), execute: async () => ({}) } } })
    try {
      await assert.rejects(() => g.service.requestConfirmation({ type: 'op', targetId: 'new', params: {} }, 'conn1'), bad)
      assert.equal(g.service.pending.size, 0)
    } finally { await g.close() }
  }
})

test('reveal is returned only by browser execute once, never by link, details, GET, or pending records', async t => {
  const executor = { 'reset-password': {
    authorize: async () => true,
    inspect: async (_trusted, id) => ({ summary: { type: 'reset-password', id, name: 'Password' }, digest: 'e' }),
    execute: async () => ({ reset: true, reveal: { label: 'Temporary password', value: 'one-time-secret', expires: 1700000000000 } }),
  } }
  const f = await fixture({ executors: executor }); t.after(f.close)
  const result = await f.service.requestConfirmation({ type: 'reset-password', targetId: 'uid2' }, 'conn1')
  assert.deepEqual(Object.keys(result), ['url'])
  assert.equal(result.url.includes('one-time-secret'), false)
  const url = result.url
  const id = idOf(url)
  const web = createServer({ origin, prefix, apiBase: 'unused', confirmations: f.service })
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => web.close(resolve)))
  const base = `http://127.0.0.1:${web.address().port}`
  const pageA = await fetch(`${base}/connector/confirm?account=uid2`)
  const pageB = await fetch(`${base}/connector/confirm?account=someone-else`)
  const bytesA = Buffer.from(await pageA.arrayBuffer())
  const bytesB = Buffer.from(await pageB.arrayBuffer())
  assert.deepEqual(bytesA, bytesB)
  assert.equal(bytesA.includes(Buffer.from('uid2')), false)
  const post = (route, body = {}) => fetch(`${base}/connector/confirm/${route}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
  assert.equal((await (await post('details')).text()).includes('one-time-secret'), false)
  await post('challenge')
  const first = await post('execute', { cid: 'cid-1', credential: credential() })
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { reset: true, reveal: { label: 'Temporary password', value: 'one-time-secret', expires: 1700000000000 } })
  assert.equal([...f.service.pending.values()].some(rec => JSON.stringify(rec).includes('one-time-secret')), false)
  const second = await post('execute', { cid: 'cid-1', credential: credential() })
  assert.equal(second.status, 400)
  assert.equal((await second.text()).includes('one-time-secret'), false)
})

test('invalid reveal shapes refuse rather than leaking an upstream result', async t => {
  for (const reveal of [{ label: '', value: 'x' }, { label: 'x', value: '' }, { label: 'x', value: 'v'.repeat(201) }, { label: 'x', value: 'v', expires: Infinity }, { label: 'x', value: 'v', expires: 'tomorrow' }]) {
    const f = await fixture({ executors: { op: { authorize: async () => true, inspect: async () => ({ digest: 'd', summary: { type: 'op', id: 'new' } }), execute: async () => ({ reveal }) } } })
    try {
      const id = idOf((await f.service.requestConfirmation({ type: 'op', targetId: 'new' }, 'conn1')).url)
      await f.service.details(id); await f.service.challenge(id)
      await assert.rejects(() => f.service.confirm(id, { cid: 'cid-1', credential: credential() }), bad)
      assert.equal(f.service.pending.size, 0)
    } finally { await f.close() }
  }
})

test('bulk summary accepts bounded explicit rows and total; rejects malformed or oversized rows', async t => {
  const rows = rowsOf(2)
  let summary = { type: 'bulk-delete', id: 'batch', effect: 'Removes listed workouts.', rows, total: 2 }
  const f = await fixture({ executors: { 'bulk-delete': { authorize: async () => true, inspect: async () => ({ summary, digest: 'd' }), execute: async () => ({ deleted: 2 }) } } }); t.after(f.close)
  const id = idOf((await f.service.requestConfirmation({ type: 'bulk-delete', targetId: 'batch' }, 'conn1')).url)
  assert.deepEqual((await f.service.details(id)).summary, summary)
  for (const broken of [[], rowsOf(26), [{ id: '', name: 'x' }], [{ id: 'a', name: 'b', date: 'c'.repeat(201) }],
    [{ id: 'a', name: 'b', extra: 1 }], rowsOf(25).map(row => ({ ...row, name: 'n'.repeat(200), date: 'd'.repeat(200) }))]) {
    summary = { type: 'bulk-delete', id: 'batch', rows: broken }
    await assert.rejects(() => f.service.details(id), bad)
  }
  summary = { type: 'bulk-delete', id: 'batch', rows, total: 1 }
  await assert.rejects(() => f.service.details(id), bad)
})

test('confirm page renders rows and one-time secret with textContent only', async () => {
  const html = readFileSync(new URL('../src/web/confirm.html', import.meta.url), 'utf8')
  const elements = new Map()
  const element = () => ({ textContent: '', disabled: true, children: [], appendChild(node) { this.children.push(node) }, addEventListener(_name, fn) { this.click = fn } })
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id) }, createElement: element }
  const posts = []
  const fetch = async (_url, options) => {
    const { id } = JSON.parse(options.body)
    assert.equal(id, 'fragment-token')
    const route = _url.split('/').at(-1)
    posts.push(route)
    return { ok: true, json: async () => route === 'details'
      ? { summary: { type: 'bulk-delete', id: 'batch', name: 'Two workouts', rows: [{ id: '<id>', name: '<script>', date: 'today' }] }, digest: 'fingerprint' }
      : route === 'challenge' ? { cid: 'cid-1', options: { challenge: 'YQ', allowCredentials: [] } }
        : { reveal: { label: '<b>Code</b>', value: '<script>secret</script>', expires: 1700000000000 } } }
  }
  const context = { document, fetch, location: { hash: '#fragment-token', pathname: '/connector/confirm' }, history: { replaceState() {} }, navigator: { credentials: { get: async () => ({ id: 'cred', rawId: new Uint8Array([1]), type: 'public-key', response: { clientDataJSON: new Uint8Array([1]), authenticatorData: new Uint8Array([1]), signature: new Uint8Array([1]) } }) } }, btoa, atob, Uint8Array, console }
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context)
  await new Promise(resolve => setImmediate(resolve))
  const list = [...elements.values()].flatMap(e => e.children)
  assert.ok(list.some(e => e.textContent.includes('<script>')))
  await elements.get('confirm').click()
  const all = [...elements.values()].flatMap(e => [e, ...e.children])
  assert.ok(all.some(e => e.textContent.includes('<script>secret</script>')))
  assert.ok(all.some(e => e.textContent.includes('shown once')))
  assert.deepEqual(posts, ['details', 'challenge', 'execute'])
})

test('custom executor cannot execute when its inspected digest changes or disappears after challenge', async t => {
  let digest = 'original', executions = 0
  const f = await fixture({ executors: { op: {
    authorize: async () => true,
    inspect: async () => ({ summary: { type: 'op', id: 'target' }, ...(digest === undefined ? {} : { digest }) }),
    execute: async () => { executions++; return { ok: true } },
  } } }); t.after(f.close)
  for (const changed of ['changed', undefined]) {
    digest = 'original'
    const id = idOf((await f.service.requestConfirmation({ type: 'op', targetId: 'target' }, 'conn1')).url)
    await f.service.details(id)
    const { cid } = await f.service.challenge(id)
    digest = changed
    await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
    assert.equal(f.service.pending.size, 0)
    assert.equal(executions, 0)
    await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  }
})
