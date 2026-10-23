import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { createAdminTools, createAdminExecutors, adminRequest, AdminError } from '../src/adminTools.js'
import { createConfirmations, createDestructiveTools, ConfirmationError } from '../src/confirmations.js'
import { createProfileStore } from '../src/profileStore.js'
import { sealBearer } from '../src/openGymSession.js'

const origin = 'https://gym.example.test'
const key = randomBytes(32)
const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
const credential = (challenge = 'challenge-1') => ({
  id: 'cred', rawId: 'Y3JlZA', type: 'public-key',
  response: { clientDataJSON: encode({ type: 'webauthn.get', challenge, origin }), authenticatorData: 'YQ', signature: 'Yg' },
})
const idOf = url => new URL(url).hash.slice(1)
const bad = e => e instanceof ConfirmationError && e.message === 'invalid_confirmation'

// Secrets that must never reach Claude, wherever they sit in an upstream answer.
const LEAKS = ['secret@mail.test', 'INVITECODE1', 'ABCDEF0123456789', 'HEADERVALUE', 'sk-LEAK', 'owner@coach.test', 'RESETCODE', '203.0.113', 'bearer-1', 'bearer-2', '/media/private']

const initialUsers = () => [
  { id: 'uid1', name: 'Admin', created: '2026-01-01', disabled: false, admin: true, invitedBy: null, workouts: 5, lastWorkout: '2026-10-20', lastSync: 1, hasPush: true, live: null, email: 'secret@mail.test', password: true },
  { id: 'uid2', name: 'Friend', created: '2026-02-01', disabled: false, admin: false, invitedBy: 'INVITECODE1', workouts: 2, lastWorkout: '2026-10-19', lastSync: 2, hasPush: false, live: { exIdx: 1 }, email: 'friend@mail.test', password: false },
  { id: 'uid3', name: 'Other admin', created: '2026-03-01', disabled: false, admin: true, invitedBy: null, workouts: 0, lastWorkout: null, lastSync: null, hasPush: false, live: null },
]
const coach = () => ({
  disabledByEnv: false, enabled: true, provider: 'compat', model: 'm1', baseUrl: 'https://llm.example.test/v1?token=sk-LEAK',
  headers: { 'x-secret': 'HEADERVALUE' }, knownModels: ['a', 'b'], caps: { perProfileDaily: 5, instanceDaily: 50 }, maxMessageLen: 1000, maxOutputTokens: 2000, community: false,
  providers: [{ id: 'compat', label: 'Compatible', runtime: null, apiKey: true, connected: true }, { id: 'other', label: 'Other', connected: false }],
  runtime: { ok: false, version: '1.0', error: 'sk-LEAK exploded', needsKey: false },
  authMode: 'instance', boundUid: 'uid1', auth: { state: 'connected', type: 'apikey', account: 'owner@coach.test', connectedAt: '2026-05-01' },
  unprivileged: { ok: true, why: 'sk-LEAK' }, jobsToday: 3,
  lastSuccess: { at: 't1', kind: 'review', outcome: 'ready', msg: 'sk-LEAK' }, lastError: { at: 't2', kind: 'review', outcome: 'failed', errorClass: 'timeout', message: 'sk-LEAK' },
  recent: [{ at: 't1', kind: 'review', trigger: 'user', outcome: 'ready', errorClass: null, ms: 10, detail: 'sk-LEAK' }],
})

async function fixture({ executors } = {}) {
  const f = { admin: true, verifyUser: 'uid1', users: initialUsers(), coach: coach(), seen: [], big: false, rev: 7 }
  const who = { 'Bearer bearer-1': 'uid1', 'Bearer bearer-2': 'uid2' }
  const api = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const route = `${req.method} ${req.url}`
      f.seen.push({ method: req.method, url: req.url, route, headers: req.headers, body })
      const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
      if (route === 'POST /api/login/options') return json(200, { cid: 'cid-1', options: { challenge: 'challenge-1', allowCredentials: [] } })
      if (route === 'POST /api/login/verify') return json(200, { user: { id: f.verifyUser, name: 'Private', admin: true } })
      const uid = who[req.headers.authorization]
      if (!uid) return json(401, { error: 'not signed in' })
      const isAdmin = uid === 'uid1' && f.admin
      if (route === 'GET /api/me') return json(200, { user: { id: f.meId || uid, name: 'Me', admin: f.meAdmin ?? isAdmin } })
      if (route === 'GET /api/data/rev') return json(200, { rev: f.rev, wid: 'w' })
      if (route === 'POST /api/media/sweep') return json(200, { removed: 2, freedBytes: 10, usage: { bytes: 1, path: '/media/private' } })
      if (req.url.startsWith('/api/admin/')) {
        if (!isAdmin) return json(403, { error: 'forbidden' })
        const url = new URL(req.url, 'http://x')
        const p = url.pathname
        if (f.big && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"pad":"' + 'x'.repeat(6 * 1024 * 1024) + '"}') }
        if (route === 'GET /api/admin/users') return json(200, { users: f.users, invite_only: true, password_login: true, now: 1 })
        if (p === '/api/admin/user' && req.method === 'GET') {
          const u = f.users.find(x => x.id === url.searchParams.get('id'))
          if (!u) return json(404, { error: 'no such user' })
          return json(200, { user: { ...u, resetUntil: 99 }, unit: 'kg', lastSync: 2, routines: [{ id: 'r1', name: 'Push', emoji: 'x', count: 3 }],
            bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [{ id: 'w1', d: '2026-10-19', name: 'Monday', vol: 10, media: ['/media/private'], note: 'secret@mail.test' }] })
        }
        if (route === 'GET /api/admin/invites' || p === '/api/admin/invites') return json(200, { invites: [{ code: 'ABCDEF0123456789', note: 'for Sam', created: 'c', usedBy: 'uid2', usedAt: 'u', usedByName: 'Friend' }, { code: 'ZZZZ', note: '', created: 'c' }], invite_only: true })
        if (p === '/api/admin/audit' && req.method === 'GET') return json(200, { events: [{ id: 9, ts: 1, ev: 'admin.invite.create', ok: true, uid: 'uid1', name: 'Admin', msg: 'ABCDEF0123456789', ip: '203.0.113.0/24', tgt: 'uid2', tname: 'Friend' }], total: 4, nextBefore: null, enabled: true })
        if (route === 'GET /api/admin/coach') return json(200, f.coach)
        if (req.method === 'POST') {
          if (route === 'POST /api/admin/user/delete') return json(200, { ok: true, id: JSON.parse(body).id, extra: 'RESETCODE' })
          if (route === 'POST /api/admin/user/disable') return json(200, { ok: true, id: JSON.parse(body).id, disabled: JSON.parse(body).disabled })
          if (route === 'POST /api/admin/audit/clear') return json(200, { ok: true })
          if (route === 'POST /api/admin/coach/disconnect') return json(200, { ok: true })
        }
      }
      return json(404, {})
    })
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const apiBase = `http://127.0.0.1:${api.address().port}`
  const connections = new Map([
    ['conn1', { userId: 'uid1', sealed: sealBearer('bearer-1', key, 'uid1') }],
    ['conn2', { userId: 'uid2', sealed: sealBearer('bearer-2', key, 'uid2') }],
  ])
  const service = createConfirmations({ connections, key, apiBase, origin, prefix: '/connector', store: createProfileStore({ apiBase }), executors: executors || createAdminExecutors({ apiBase }) })
  const tools = Object.fromEntries([...createAdminTools({ apiBase, confirmations: service }), ...createDestructiveTools(service)].map(t => [t.name, t]))
  return Object.assign(f, {
    apiBase, service, tools, connections,
    mutations: () => f.seen.filter(x => x.method === 'POST' && !/\/api\/login\//.test(x.url)),
    adminCalls: () => f.seen.filter(x => x.url.startsWith('/api/admin/')),
    close: () => new Promise(resolve => api.close(resolve)),
  })
}
// Full ceremony: link -> details -> challenge -> passkey -> execute.
async function approve(f, name, args, conn = 'conn1') {
  const { url } = await f.tools[name].handler(conn, args)
  const id = idOf(url)
  const { summary } = await f.service.details(id)
  const { cid } = await f.service.challenge(id)
  return { summary, result: await f.service.confirm(id, { cid, credential: credential() }) }
}

const READS = [['list_users', {}], ['get_user', { id: 'uid2' }], ['list_invites', {}], ['get_audit_log', {}], ['get_coach_status', {}]]

test('non-admin receives the upstream 403 from every admin read, with no connector-made 200', async t => {
  const f = await fixture(); t.after(f.close)
  f.admin = false
  for (const [name, args] of READS) {
    await assert.rejects(() => f.tools[name].handler('bearer-1', args), e => e instanceof AdminError && e.status === 403 && !e.message.includes('bearer-1'), name)
  }
  assert.ok(f.adminCalls().length >= READS.length)
  assert.equal(f.mutations().length, 0)
})

test('a revoked or missing bearer sends no admin request at all', async t => {
  const f = await fixture(); t.after(f.close)
  for (const bearer of [null, undefined, '', 5, {}, 'a\r\nHost: evil']) {
    for (const [name, args] of READS) await assert.rejects(() => f.tools[name].handler(bearer, args), AdminError, name)
  }
  assert.equal(f.seen.length, 0)
  // A bearer the API revoked answers 401: forwarded as is, never retried with other credentials.
  await assert.rejects(() => f.tools.list_users.handler('bearer-revoked', {}), e => e.status === 401)
  assert.equal(f.seen.length, 1)
  assert.equal(f.seen[0].headers.cookie, undefined)
})

test('forwarding rejects every path and method outside the fixed allowlist, before any request', async t => {
  const f = await fixture(); t.after(f.close)
  const attempts = [
    ['GET', '/api/data'], ['PUT', '/api/data'], ['GET', '/api/admin'], ['GET', '/api/admin/users/extra'], ['GET', '/api/admin/./users'],
    ['GET', '/api/admin/%75sers'], ['GET', '//evil.test/api/admin/users'], ['GET', 'http://evil.test/api/admin/users'], ['GET', '/api/admin/users?x=1'],
    ['GET', '/api/admin/user?id=a&id=b'], ['GET', '/api/admin/user?id=../x'], ['GET', '/api/admin/user?other=1'], ['GET', '/api/admin/audit?limit=abc'],
    ['GET', '/api/admin/audit?cat=a/b'], ['GET', '/api/admin/users#x'], ['GET', '/api/admin/users\\..'], ['GET', 'api/admin/users'], ['GET', 42], ['GET', null],
    ['POST', '/api/admin/user/delete'], ['POST', '/api/admin/user/disable'], ['POST', '/api/admin/audit/clear'], ['POST', '/api/admin/coach/disconnect'],
    ['POST', '/api/media/sweep'], ['POST', '/api/admin/user/password-reset'], ['POST', '/api/admin/invites/new'], ['POST', '/api/admin/invites/revoke'],
    ['POST', '/api/admin/coach/config'], ['POST', '/api/admin/coach/connect'], ['POST', '/api/admin/coach/test'], ['POST', '/api/admin/users'],
    ['DELETE', '/api/admin/users'], ['GET', '/api/admin/coach/connect'], ['GET', '/api/register/options'], ['GET', '/api/admin/user/delete'],
  ]
  for (const [method, path] of attempts) await assert.rejects(() => adminRequest(f.apiBase, 'bearer-1', method, path), AdminError, `${method} ${path}`)
  assert.equal(f.seen.length, 0)
  assert.equal((await adminRequest(f.apiBase, 'bearer-1', 'GET', '/api/admin/users')).users.length, 3)
  assert.ok((await adminRequest(f.apiBase, 'bearer-1', 'GET', '/api/admin/user?id=uid2')).user)
  assert.equal(f.seen.length, 2)
})

test('read tools return only selected safe fields; no emails, invite codes, headers, IPs, tokens or media', async t => {
  const f = await fixture(); t.after(f.close)
  const out = {}
  for (const [name, args] of READS) out[name] = await f.tools[name].handler('bearer-1', args)
  const all = JSON.stringify(out)
  for (const leak of LEAKS) assert.ok(!all.includes(leak), `leaked ${leak}`)
  assert.deepEqual(out.list_users.users.map(u => u.id), ['uid1', 'uid2', 'uid3'])
  assert.equal(out.list_users.users[1].name, 'Friend')
  assert.equal(out.list_users.users[1].live, true)
  assert.equal(out.get_user.user.id, 'uid2')
  assert.equal(out.get_user.routines[0].name, 'Push')
  assert.equal(out.list_invites.invites.length, 2)
  assert.equal(out.list_invites.invites[0].used, true)
  assert.equal(out.list_invites.invites[0].usedByName, 'Friend')
  assert.equal(out.list_invites.invites[1].used, false)
  assert.equal(out.get_audit_log.events[0].ev, 'admin.invite.create')
  assert.equal(out.get_audit_log.events[0].tname, 'Friend')
  assert.equal(out.get_coach_status.provider, 'compat')
  assert.equal(out.get_coach_status.baseUrlHost, 'https://llm.example.test')
  assert.deepEqual(out.get_coach_status.auth, { state: 'connected', type: 'apikey' })
  assert.equal(out.get_coach_status.lastError.errorClass, 'timeout')
  assert.equal(out.get_coach_status.runtime.ok, false)
  assert.ok(!('headers' in out.get_coach_status))
})

test('read arguments are validated before any request', async t => {
  const f = await fixture(); t.after(f.close)
  for (const [name, args] of [['get_user', {}], ['get_user', { id: '../x' }], ['get_user', { id: 'a&id=b' }], ['get_audit_log', { limit: 0 }], ['get_audit_log', { limit: 201 }],
    ['get_audit_log', { limit: 1.5 }], ['get_audit_log', { before: -1 }], ['get_audit_log', { cat: 'a b' }], ['get_audit_log', { cat: 7 }]]) {
    await assert.rejects(() => f.tools[name].handler('bearer-1', args), AdminError, `${name} ${JSON.stringify(args)}`)
  }
  assert.equal(f.seen.length, 0)
  await f.tools.get_audit_log.handler('bearer-1', { limit: 5, before: 20, cat: 'admin' })
  assert.equal(f.seen[0].url, '/api/admin/audit?limit=5&before=20&cat=admin')
})

test('an oversized upstream answer fails with our own message, not its contents', async t => {
  const f = await fixture(); t.after(f.close)
  f.big = true
  await assert.rejects(() => f.tools.list_users.handler('bearer-1', {}), e => e instanceof AdminError && !e.message.includes('xxx'))
})

test('no tool exists for reset, backup replace, bulk delete, invite codes or password reset', async t => {
  const f = await fixture(); t.after(f.close)
  assert.deepEqual(Object.keys(f.tools).sort(), ['clear_audit_log', 'delete_account', 'delete_routine', 'delete_workout', 'disable_account', 'disconnect_coach',
    'get_audit_log', 'get_coach_status', 'get_user', 'list_invites', 'list_users', 'sweep_media'])
  assert.deepEqual(Object.keys(createAdminExecutors({ apiBase: 'http://unused' })).sort(), ['clear-audit', 'delete-account', 'disable-account', 'disconnect-coach', 'sweep-media'])
})

test('requesting any destructive tool only returns a link: nothing is mutated, no admin route is touched for sweep', async t => {
  const f = await fixture(); t.after(f.close)
  for (const [name, args] of [['delete_account', { id: 'uid2' }], ['disable_account', { id: 'uid2' }], ['clear_audit_log', {}], ['disconnect_coach', { provider: 'compat' }], ['sweep_media', {}]]) {
    const { url } = await f.tools[name].handler('conn1', args)
    assert.match(url, /^https:\/\/gym\.example\.test\/connector\/confirm#[A-Za-z0-9_-]{43}$/)
  }
  assert.equal(f.mutations().length, 0)
})

test('each destructive route runs only after passkey confirmation, once, with the same bearer and exact body', async t => {
  const f = await fixture(); t.after(f.close)
  const cases = [
    ['delete_account', { id: 'uid2' }, 'POST /api/admin/user/delete', { id: 'uid2' }, { deleted: { type: 'delete-account', id: 'uid2' } }],
    ['disable_account', { id: 'uid2' }, 'POST /api/admin/user/disable', { id: 'uid2', disabled: true }, { disabled: { type: 'disable-account', id: 'uid2' } }],
    ['clear_audit_log', {}, 'POST /api/admin/audit/clear', {}, { cleared: true }],
    ['disconnect_coach', { provider: 'compat' }, 'POST /api/admin/coach/disconnect', { provider: 'compat' }, { disconnected: { type: 'disconnect-coach', id: 'compat' } }],
    ['sweep_media', {}, 'POST /api/media/sweep', {}, { swept: true, removed: 2, freedBytes: 10 }],
  ]
  for (const [name, args, route, body, expected] of cases) {
    const before = f.mutations().length
    const { summary, result } = await approve(f, name, args)
    assert.ok(summary.type && summary.id, name)
    if (name === 'delete_account') assert.match(summary.effect, /training history.*photos or videos/)
    assert.deepEqual(result, expected, name)
    const calls = f.mutations().slice(before)
    assert.equal(calls.length, 1, name)
    assert.equal(calls[0].route, route)
    assert.deepEqual(JSON.parse(calls[0].body), body)
    assert.equal(calls[0].headers.authorization, 'Bearer bearer-1')
    assert.equal(calls[0].headers.cookie, undefined)
    assert.ok(!JSON.stringify(result).includes('/media/private') && !JSON.stringify(result).includes('RESETCODE'))
  }
  assert.equal(f.seen.some(x => /password-reset|invites\/(new|revoke)|coach\/(config|connect|test)/.test(x.url)), false)
})

test('a non-admin cannot mint any admin confirmation, and nothing is sent upstream but the check', async t => {
  const f = await fixture(); t.after(f.close)
  f.admin = false
  for (const [name, args] of [['delete_account', { id: 'uid2' }], ['disable_account', { id: 'uid2' }], ['clear_audit_log', {}], ['disconnect_coach', { provider: 'compat' }]]) {
    await assert.rejects(() => f.tools[name].handler('conn1', args), bad, name)
  }
  assert.equal(f.service.pending.size, 0)
  assert.equal(f.mutations().length, 0)
})

test('delete and disable refuse unknown, admin, self and malformed targets at mint time', async t => {
  const f = await fixture(); t.after(f.close)
  for (const name of ['delete_account', 'disable_account']) {
    for (const id of ['nobody', 'uid3', 'uid1', '', '../x', undefined, 7]) await assert.rejects(() => f.tools[name].handler('conn1', { id }), bad, `${name} ${id}`)
  }
  assert.equal(f.service.pending.size, 0)
  assert.equal(f.mutations().length, 0)
})

test('admin rights withdrawn after the link was made, or after the passkey tap, deny execution', async t => {
  const f = await fixture(); t.after(f.close)
  let id = idOf((await f.tools.delete_account.handler('conn1', { id: 'uid2' })).url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  f.admin = false
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.mutations().length, 0)
  f.admin = true
  id = idOf((await f.tools.delete_account.handler('conn1', { id: 'uid2' })).url)
  await f.service.details(id)
  f.admin = false
  await assert.rejects(() => f.service.details(id), bad)
  assert.equal(f.mutations().length, 0)
})

test('a target that changed after details cannot be confirmed (new digest)', async t => {
  const f = await fixture(); t.after(f.close)
  const id = idOf((await f.tools.disable_account.handler('conn1', { id: 'uid2' })).url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  f.users[1].name = 'Renamed'
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.mutations().length, 0)
})

test('a target promoted to admin before execution is refused, upstream never called', async t => {
  const f = await fixture(); t.after(f.close)
  const id = idOf((await f.tools.delete_account.handler('conn1', { id: 'uid2' })).url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  f.users[1].admin = true
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.mutations().length, 0)
})

test('coach disconnect is limited to a connected provider the instance really lists', async t => {
  const f = await fixture(); t.after(f.close)
  for (const provider of ['other', 'unknown', '', '../x', undefined, 3]) await assert.rejects(() => f.tools.disconnect_coach.handler('conn1', { provider }), bad, String(provider))
  assert.equal(f.mutations().length, 0)
})

test('media sweep is the caller\'s own, available to any signed-in user, never another target or an admin path', async t => {
  const f = await fixture(); t.after(f.close)
  f.verifyUser = 'uid2'
  const { summary, result } = await approve(f, 'sweep_media', {}, 'conn2')
  assert.equal(summary.type, 'sweep-media')
  assert.equal(summary.id, 'uid2')
  assert.equal(result.swept, true)
  const calls = f.mutations()
  assert.deepEqual(calls.map(c => c.route), ['POST /api/media/sweep'])
  assert.equal(calls[0].headers.authorization, 'Bearer bearer-2')
  assert.equal(f.seen.some(x => x.url.startsWith('/api/admin/')), false)
  // Another target is never accepted, and a changed profile (revision) invalidates the link.
  await assert.rejects(() => f.service.requestConfirmation({ type: 'sweep-media', targetId: 'uid1' }, 'conn2'), bad)
  const id = idOf((await f.tools.sweep_media.handler('conn2', {})).url)
  await f.service.details(id); f.verifyUser = 'uid2'; const { cid } = await f.service.challenge(id)
  f.rev++
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.mutations().length, 1)
})

test('every admin executor carries authorize, inspect and execute; one without authorize cannot mint', async t => {
  const real = createAdminExecutors({ apiBase: 'http://unused' })
  for (const [type, executor] of Object.entries(real)) for (const fn of ['authorize', 'inspect', 'execute']) assert.equal(typeof executor[fn], 'function', `${type}.${fn}`)
  const { authorize: _dropped, ...unguarded } = real['delete-account']
  const f = await fixture({ executors: { ...real, 'delete-account': unguarded } }); t.after(f.close)
  await assert.rejects(() => f.tools.delete_account.handler('conn1', { id: 'uid2' }), bad)
  assert.equal(f.service.pending.size, 0)
  assert.equal(f.mutations().length, 0)
})

test('upstream failures during mint or execute surface only the fixed confirmation error', async t => {
  const f = await fixture(); t.after(f.close)
  await f.close()
  await assert.rejects(() => f.tools.delete_account.handler('conn1', { id: 'uid2' }), e => bad(e) && !String(e.message).includes('127.0.0.1'))
})

test('the executor itself asks /api/me: a non-admin answer or another user ID cannot mint even if admin routes would answer', async t => {
  const f = await fixture(); t.after(f.close)
  for (const set of [() => { f.meAdmin = false }, () => { f.meAdmin = true; f.meId = 'someone-else' }]) {
    set()
    for (const [name, args] of [['delete_account', { id: 'uid2' }], ['disable_account', { id: 'uid2' }], ['clear_audit_log', {}], ['disconnect_coach', { provider: 'compat' }]]) {
      await assert.rejects(() => f.tools[name].handler('conn1', args), bad, name)
    }
  }
  assert.equal(f.service.pending.size, 0)
  assert.equal(f.mutations().length, 0)
})
