import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
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
    const { url } = tool.handler('conn1', { id: targetId })
    assert.equal(f.puts, 0)
    assert.equal(new URL(url).search, '')
    const id = idOf(url)
    assert.equal(f.service.pending.has(id), false)
    assert.ok([...f.service.pending.keys()].every(k => k.length === 43 && k !== id))
    const details = await f.service.details(id)
    assert.equal(details.summary.id, targetId)
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

test('superseding request, expired ID, revoked connection, and other user all fail without writes', async t => {
  let clock = 1000
  const f = await fixture({ now: () => clock }); t.after(f.close)
  const action = { type: 'delete-routine', targetId: 'r1' }
  const first = idOf(f.service.requestConfirmation(action, 'conn1').url)
  const second = idOf(f.service.requestConfirmation(action, 'conn1').url)
  await assert.rejects(() => f.service.details(first), bad)
  await assert.rejects(() => f.service.confirm(first, {}), bad)
  await f.service.details(second); await f.service.challenge(second)
  f.verifyUser = 'uid2'
  await assert.rejects(() => f.service.confirm(second, { cid: 'cid-1', credential: credential() }), bad)
  assert.equal(f.puts, 0)
  const expired = idOf(f.service.requestConfirmation(action, 'conn1').url)
  clock += 10 * 60_000
  await assert.rejects(() => f.service.details(expired), bad)
  const revoked = idOf(f.service.requestConfirmation(action, 'conn1').url)
  f.connections.delete('conn1')
  await assert.rejects(() => f.service.details(revoked), bad)
  assert.equal(f.puts, 0)
})

test('wrong origin/challenge/type, no challenge, and changed target refuse execution', async t => {
  const f = await fixture(); t.after(f.close)
  for (const proof of [credential('wrong'), credential('challenge-1', 'https://other.test'),
    { ...credential(), response: { ...credential().response, clientDataJSON: encode({ type: 'webauthn.create', challenge: 'challenge-1', origin }) } }]) {
    const id = idOf(f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1').url)
    await f.service.details(id); await f.service.challenge(id)
    await assert.rejects(() => f.service.confirm(id, { cid: 'cid-1', credential: proof }), bad)
  }
  assert.equal(f.seen.some(x => x.route === 'POST /api/login/verify'), false)
  const noChallenge = idOf(f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1').url)
  await f.service.details(noChallenge)
  await assert.rejects(() => f.service.confirm(noChallenge, { cid: 'cid-1', credential: credential() }), bad)
  const changed = idOf(f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1').url)
  await f.service.details(changed)
  const minted = await f.service.challenge(changed)
  f.profile = { ...f.profile, workouts: f.profile.workouts.map(w => w.id === 'w1' ? { ...w, name: 'Edited' } : w) }
  await assert.rejects(() => f.service.confirm(changed, { cid: minted.cid, credential: credential() }), bad)
  assert.equal(f.puts, 0)
})

test('a cancelled ceremony can remint; only the latest challenge executes', async t => {
  const f = await fixture(); t.after(f.close)
  const id = idOf(f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1').url)
  await f.service.details(id)
  const first = await f.service.challenge(id)
  const second = await f.service.challenge(id)
  assert.notEqual(first.cid, second.cid)
  await assert.rejects(() => f.service.confirm(id, { cid: first.cid, credential: credential() }), bad)
  assert.equal(f.puts, 0)
  const again = idOf(f.service.requestConfirmation({ type: 'delete-workout', targetId: 'w1' }, 'conn1').url)
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
  assert.throws(() => tool.handler('conn1', { id: 'uid2' }), bad)
  assert.equal(f.service.pending.size, 0)
})

test('disable-account requires injected executor; tool never executes on request or replay', async t => {
  let executions = 0
  const f = await fixture({ executors: { 'disable-account': {
    inspect: async (_trusted, id) => ({ summary: { type: 'disable-account', id }, digest: 'account-version-1' }),
    execute: async () => { executions++; return { disabled: true } },
  } } }); t.after(f.close)
  const tool = createDestructiveTools(f.service).find(x => x.name === 'disable_account')
  const one = idOf(tool.handler('conn1', { id: 'uid2' }).url)
  const two = idOf(tool.handler('conn1', { id: 'uid2' }).url)
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
  const id = idOf(f.service.requestConfirmation({ type: 'delete-routine', targetId: 'r1' }, 'conn1').url)
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
