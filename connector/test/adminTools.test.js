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
const LEAKS = ['secret@mail.test', 'INVITECODE1', 'ABCDEF0123456789', 'FEDCBA9876543210', '1234ABCD5678EF01', 'HEADERVALUE', 'sk-LEAK', 'owner@coach.test', 'RESETCODE', '203.0.113', 'bearer-1', 'bearer-2', '/media/private']

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
  const f = { admin: true, verifyUser: 'uid1', users: initialUsers(), coach: coach(), seen: [], big: false, rev: 7,
    passwordLogin: true, coachCfgSeen: [], forgetSeen: [], modelDelay: 0, modelsAnswer: null,
    invites: [{ code: 'ABCDEF0123456789', note: 'for Sam', created: 'c', createdBy: 'uid1', usedBy: 'uid2', usedAt: 'u', usedByName: 'Friend' },
      { code: 'FEDCBA9876543210', note: '', created: 'c', createdBy: 'uid1' }], inviteCode: '1234ABCD5678EF01' }
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
      if (route === 'POST /api/coach/forget') { f.forgetSeen.push(uid); return json(200, { ok: true, extra: 'sk-LEAK' }) }
      if (req.url.startsWith('/api/admin/')) {
        if (!isAdmin) return json(403, { error: 'forbidden' })
        const url = new URL(req.url, 'http://x')
        const p = url.pathname
        if (f.big && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"pad":"' + 'x'.repeat(6 * 1024 * 1024) + '"}') }
        if (route === 'GET /api/admin/users') return json(200, { users: f.users, invite_only: true, ...(f.passwordLogin ? { password_login: true } : {}), now: 1 })
        if (p === '/api/admin/user' && req.method === 'GET') {
          const u = f.users.find(x => x.id === url.searchParams.get('id'))
          if (!u) return json(404, { error: 'no such user' })
          return json(200, { user: { ...u, resetUntil: 99 }, unit: 'kg', lastSync: 2, routines: [{ id: 'r1', name: 'Push', emoji: 'x', count: 3 }],
            bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [{ id: 'w1', d: '2026-10-19', name: 'Monday', vol: 10, media: ['/media/private'], note: 'secret@mail.test' }] })
        }
        if (route === 'GET /api/admin/invites') return json(200, { invites: f.invites, invite_only: true })
        if (route === 'POST /api/admin/invites/new') {
          const invite = { code: f.inviteCode, note: JSON.parse(body).note, createdBy: uid, created: 'now' }
          f.invites.push(invite)
          return json(200, { invite })
        }
        if (route === 'POST /api/admin/invites/revoke') {
          f.invites = f.invites.filter(i => i.code !== JSON.parse(body).code)
          return json(200, { ok: true })
        }
        if (p === '/api/admin/audit' && req.method === 'GET') return json(200, { events: [{ id: 9, ts: 1, ev: 'admin.invite.create', ok: true, uid: 'uid1', name: 'Admin', msg: 'ABCDEF0123456789', ip: '203.0.113.0/24', tgt: 'uid2', tname: 'Friend' }], total: 4, nextBefore: null, enabled: true })
        if (route === 'GET /api/admin/coach') return json(200, f.coach)
        if (req.method === 'POST') {
          if (route === 'POST /api/admin/user/delete') return json(200, { ok: true, id: JSON.parse(body).id, extra: 'RESETCODE' })
          if (route === 'POST /api/admin/user/disable') return json(200, { ok: true, id: JSON.parse(body).id, disabled: JSON.parse(body).disabled })
          if (route === 'POST /api/admin/audit/clear') return json(200, { ok: true })
          if (route === 'POST /api/admin/user/password-reset') return json(200, { ok: true, name: 'Friend', code: 'ABCD-EFGH-JKLM', expires: 1700000000000, extra: 'RESETCODE' })
          if (route === 'POST /api/admin/coach/connect') return json(200, { ok: true, extra: 'sk-SECRET' })
          if (route === 'POST /api/admin/coach/disconnect') return json(200, { ok: true })
          if (route === 'POST /api/admin/coach/config') { f.coachCfgSeen.push(JSON.parse(body)); return json(200, { ok: true, extra: 'sk-LEAK' }) }
          if (route === 'POST /api/admin/coach/models') {
            if (f.modelDelay) return setTimeout(() => json(200, { ok: true, models: ['slow-model'], error: 'sk-LEAK exploded' }), f.modelDelay)
            return json(200, f.modelsAnswer || { ok: true, models: ['m1', 'm2'], error: 'sk-LEAK exploded' })
          }
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
  const service = createConfirmations({ connections, key, apiBase, origin, prefix: '/connector', store: createProfileStore({ apiBase }), executors: executors || createAdminExecutors({ apiBase, key }) })
  const tools = Object.fromEntries([...createAdminTools({ apiBase, key, confirmations: service, origin, modelsTimeoutMs: 300 }), ...createDestructiveTools(service)].map(t => [t.name, t]))
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
    ['POST', '/api/media/sweep'], ['POST', '/api/admin/user/password-reset'],
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
  for (const invite of out.list_invites.invites) assert.match(invite.ref, /^[A-Za-z0-9_-]{22}$/)
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

test('only explicitly supported admin tools exist; no backup replace or bulk delete', async t => {
  const f = await fixture(); t.after(f.close)
  assert.deepEqual(Object.keys(f.tools).sort(), ['clear_audit_log', 'configure_coach', 'delete_account', 'delete_routine', 'delete_workout', 'disable_account', 'disconnect_coach',
    'forget_coach', 'get_audit_log', 'get_coach_status', 'get_user', 'list_coach_models', 'list_invites', 'list_users', 'request_connect_coach', 'request_create_invite', 'request_password_reset', 'request_revoke_invite', 'sweep_media', 'test_coach'])
  assert.deepEqual(Object.keys(createAdminExecutors({ apiBase: 'http://unused', key })).sort(), ['clear-audit', 'configure-coach', 'connect-coach', 'create-invite', 'delete-account', 'disable-account', 'disconnect-coach', 'forget-coach', 'password-reset', 'revoke-invite', 'sweep-media'])
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
  const real = createAdminExecutors({ apiBase: 'http://unused', key })
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

/* ------------------------------ invitations ------------------------------ */

const invitesOf = async f => (await f.tools.list_invites.handler('bearer-1', {})).invites

test('list_invites adds a stable opaque ref per invite, derived so the code cannot be recovered', async t => {
  const f = await fixture(); t.after(f.close)
  const first = await invitesOf(f), second = await invitesOf(f)
  assert.equal(first.length, 2)
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(Object.keys(first[i]).sort(), ['created', 'note', 'ref', 'used', 'usedAt', 'usedByName'])
    assert.match(first[i].ref, /^[A-Za-z0-9_-]{22}$/)
    assert.equal(first[i].ref, second[i].ref, 'stable across listings')
  }
  assert.notEqual(first[0].ref, first[1].ref)
})

test('creating an invite reveals the code only from the confirmed page, POSTing the note once', async t => {
  const f = await fixture(); t.after(f.close)
  const { summary, result } = await approve(f, 'request_create_invite', { note: 'for Sam' })
  assert.equal(summary.type, 'create-invite')
  assert.equal(summary.id, 'new')
  assert.equal(summary.name, 'New invite')
  assert.match(summary.effect, /for Sam/)
  assert.equal(result.created, true)
  assert.equal(result.note, 'for Sam')
  assert.deepEqual(result.reveal, { label: 'Invite code', value: '1234ABCD5678EF01' })
  const calls = f.mutations().filter(x => x.route === 'POST /api/admin/invites/new')
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].body), { note: 'for Sam' })
  assert.equal(calls[0].headers.authorization, 'Bearer bearer-1')
  // The link and the tool answer never carry the code; the reveal is not stored either.
  assert.equal(JSON.stringify(result).includes('ABCDEF0123456789'), false)
})

test('create invite note is optional and trimmed; wrong types, notes over 60 chars or extra keys refuse', async t => {
  const f = await fixture(); t.after(f.close)
  const { summary, result } = await approve(f, 'request_create_invite', { note: '  padded  ' })
  assert.equal(result.note, 'padded')
  assert.match(summary.effect, /padded/)
  assert.equal(result.reveal.value, '1234ABCD5678EF01')
  for (const note of [7, {}, 'x'.repeat(61)]) {
    await assert.rejects(() => f.tools.request_create_invite.handler('conn1', { note }), bad)
  }
  await assert.rejects(async () => f.tools.request_create_invite.handler('conn1', { note: 'ok', extra: 1 }), AdminError)
  await assert.rejects(async () => f.tools.request_create_invite.handler('conn1', 'note'), AdminError)
  assert.equal(f.service.pending.size, 0)
  assert.equal(f.mutations().length, 1)
})

test('create invite refuses an upstream code of any other shape instead of revealing it', async t => {
  const f = await fixture(); t.after(f.close)
  f.inviteCode = 'short'
  const id = idOf((await f.tools.request_create_invite.handler('conn1', { note: 'x' })).url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.mutations().filter(x => x.route === 'POST /api/admin/invites/new').length, 1)
  // The one-time pending record is gone: no retry can mint another reveal from the same link.
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
})

test('revoking by ref resolves server-side and destroys exactly that invite', async t => {
  const f = await fixture(); t.after(f.close)
  const ref = (await invitesOf(f))[1].ref
  const { summary, result } = await approve(f, 'request_revoke_invite', { ref })
  assert.equal(summary.type, 'revoke-invite')
  assert.equal(summary.id, ref)
  assert.match(summary.name, /^Invite [A-Za-z0-9_-]{1,8}$/)
  assert.deepEqual(result, { revoked: { ref } })
  const calls = f.mutations().filter(x => x.route === 'POST /api/admin/invites/revoke')
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].body), { code: 'FEDCBA9876543210' })
  // Upstream no longer lists it: the same ref is stale and mints nothing.
  await assert.rejects(() => f.tools.request_revoke_invite.handler('conn1', { ref }), bad)
  assert.equal(f.invites.length, 1)
})

test('revoke refuses a used, unknown or stale ref before any link', async t => {
  const f = await fixture(); t.after(f.close)
  const mint = ref => f.tools.request_revoke_invite.handler('conn1', { ref })
  const listed = await invitesOf(f)
  await assert.rejects(() => mint(listed[0].ref), bad, 'already used') // fixture invites[0].usedBy
  await assert.rejects(() => mint('A'.repeat(22)), bad, 'well-formed but unknown')
  for (const ref of ['', '../x', 'A'.repeat(23), 7]) await assert.rejects(() => mint(ref), bad, String(ref))
  // A record that changed after the ref was listed no longer resolves.
  const stale = (await invitesOf(f))[1].ref
  f.invites[1].note = 'changed afterwards'
  await assert.rejects(() => mint(stale), bad, 'stale')
  assert.equal(f.service.pending.size, 0)
  assert.equal(f.mutations().length, 0)
})

test('any current admin can revoke another admin’s unused invite without exposing its code', async t => {
  const f = await fixture(); t.after(f.close)
  f.invites.push({ code: '9999888877776666', note: '', created: 'c', createdBy: 'uid3' })
  const ref = (await invitesOf(f))[2].ref
  const link = await f.tools.request_revoke_invite.handler('conn1', { ref })
  assert.deepEqual(Object.keys(link), ['url'])
  assert.doesNotMatch(JSON.stringify(link), /9999888877776666/)
  const id = idOf(link.url)
  const { summary } = await f.service.details(id)
  assert.equal(summary.id, ref)
  assert.doesNotMatch(JSON.stringify(summary), /9999888877776666/)
  const { cid } = await f.service.challenge(id)
  assert.deepEqual(await f.service.confirm(id, { cid, credential: credential() }), { revoked: { ref } })
  const posts = f.mutations().filter(x => x.route === 'POST /api/admin/invites/revoke')
  assert.equal(posts.length, 1)
  assert.deepEqual(JSON.parse(posts[0].body), { code: '9999888877776666' })
})

test('two invites that resolve to the same ref are ambiguous: no link, and execute refuses too', async t => {
  const f = await fixture(); t.after(f.close)
  const ref = (await invitesOf(f))[1].ref
  const id = idOf((await f.tools.request_revoke_invite.handler('conn1', { ref })).url)
  const { digest } = await f.service.details(id)
  // A byte-identical second record resolves to the same ref.
  f.invites.push(structuredClone(f.invites[1]))
  await assert.rejects(() => f.tools.request_revoke_invite.handler('conn1', { ref }), bad)
  const executors = createAdminExecutors({ apiBase: f.apiBase, key })
  await assert.rejects(() => executors['revoke-invite'].execute({ userId: 'uid1', bearer: 'bearer-1' }, ref, digest), AdminError)
  assert.equal(f.mutations().length, 0)
})

test('refs depend on the connector key: another key gives other refs for the same invites', async t => {
  const f = await fixture(); t.after(f.close)
  const ours = (await invitesOf(f)).map(i => i.ref)
  const theirs = (await createAdminTools({ apiBase: f.apiBase, key: randomBytes(32), confirmations: f.service }).find(x => x.name === 'list_invites').handler('bearer-1', {})).invites.map(i => i.ref)
  assert.equal(ours.length, 2)
  for (let i = 0; i < 2; i++) assert.notEqual(ours[i], theirs[i])
})

test('revoke re-proves the invite inside execute: changed after challenge, or a wrong stored digest, never POSTs', async t => {
  const f = await fixture(); t.after(f.close)
  const ref = (await invitesOf(f))[1].ref
  const id = idOf((await f.tools.request_revoke_invite.handler('conn1', { ref })).url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  f.invites[1].note = 'changed after challenge'
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.mutations().length, 0)
  // Directly: an execute handed a stored digest that is not the invite's record refuses before POST.
  const executors = createAdminExecutors({ apiBase: f.apiBase, key })
  const current = (await invitesOf(f))[1].ref
  await assert.rejects(() => executors['revoke-invite'].execute({ userId: 'uid1', bearer: 'bearer-1' }, current, 'wrong-digest'), AdminError)
  assert.equal(f.mutations().length, 0)
})

test('invite confirmations execute at most once: a replayed confirm never re-POSTs', async t => {
  const f = await fixture(); t.after(f.close)
  for (const [name, args] of [['request_create_invite', {}], ['request_revoke_invite', { ref: (await invitesOf(f))[1].ref }]]) {
    const id = idOf((await f.tools[name].handler('conn1', args)).url)
    await f.service.details(id); const { cid } = await f.service.challenge(id)
    await f.service.confirm(id, { cid, credential: credential() })
    await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  }
  const posts = f.mutations().filter(x => /\/api\/admin\/invites\/(new|revoke)/.test(x.url))
  assert.deepEqual(posts.map(x => x.route), ['POST /api/admin/invites/new', 'POST /api/admin/invites/revoke'])
})

test('a non-admin cannot mint or confirm invite actions, and admin rights withdrawn deny execution', async t => {
  const f = await fixture(); t.after(f.close)
  f.admin = false
  await assert.rejects(() => f.tools.request_create_invite.handler('conn1', {}), bad)
  await assert.rejects(() => f.tools.request_revoke_invite.handler('conn1', { ref: 'A'.repeat(22) }), bad)
  assert.equal(f.service.pending.size, 0)
  f.admin = true
  const id = idOf((await f.tools.request_create_invite.handler('conn1', {})).url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  f.admin = false
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.mutations().length, 0)
})

test('password reset requires enabled login, admin, existing non-admin other account', async t => {
  const f = await fixture(); t.after(f.close)
  const mint = id => f.tools.request_password_reset.handler('conn1', { id })
  f.passwordLogin = false
  await assert.rejects(() => mint('uid2'), bad)
  f.passwordLogin = true
  for (const id of ['uid1', 'uid3', 'missing', '../x']) await assert.rejects(() => mint(id), bad)
  f.admin = false
  await assert.rejects(() => mint('uid2'), bad)
  assert.equal(f.mutations().length, 0)
})

test('password reset reveals only browser result once and refuses changed target or disabled login', async t => {
  const f = await fixture(); t.after(f.close)
  const mint = async () => idOf((await f.tools.request_password_reset.handler('conn1', { id: 'uid2' })).url)
  let id = await mint()
  const details = await f.service.details(id)
  assert.match(details.summary.effect, /password.*sessions.*passkeys/i)
  assert.doesNotMatch(JSON.stringify(details), /ABCD-EFGH-JKLM/)
  let { cid } = await f.service.challenge(id)
  f.users[1].name = 'Changed'
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  id = await mint(); await f.service.details(id); ({ cid } = await f.service.challenge(id))
  f.passwordLogin = false
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  f.passwordLogin = true
  id = await mint(); await f.service.details(id); ({ cid } = await f.service.challenge(id))
  const result = await f.service.confirm(id, { cid, credential: credential() })
  assert.deepEqual(result, { reset: true, id: 'uid2', reveal: { label: 'Password reset code', value: 'ABCD-EFGH-JKLM', expires: 1700000000000 } })
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  const calls = f.mutations()
  assert.deepEqual(calls.map(x => x.route), ['POST /api/admin/user/password-reset'])
  assert.deepEqual(JSON.parse(calls[0].body), { id: 'uid2' })
  assert.equal(calls[0].headers.authorization, 'Bearer bearer-1')
  assert.equal(calls[0].headers.cookie, undefined)
  assert.doesNotMatch(JSON.stringify([...f.service.pending.values()]), /ABCD-EFGH-JKLM/)
})

test('Coach link projects only safe provider capabilities; browser credentials validate before a single POST', async t => {
  const f = await fixture(); t.after(f.close)
  const mint = async provider => idOf((await f.tools.request_connect_coach.handler('conn1', { provider })).url)
  const id = await mint('compat')
  const details = await f.service.details(id)
  assert.match(details.summary.effect, /replac/i)
  assert.deepEqual(details.summary.provider, { id: 'compat', label: 'Compatible', connected: true, apiKey: true, setupToken: false, deviceLogin: false })
  assert.doesNotMatch(JSON.stringify(details), /HEADERVALUE|sk-LEAK|owner@coach.test|\/v1/)
  // Wrong provider, a type the provider does not take, empty token: no upstream POST.
  for (const data of [{ provider: 'other', type: 'apikey', token: 'sk-SECRET' }, { provider: 'compat', type: 'oauth', token: 'sk-SECRET' }, { provider: 'compat', type: 'apikey', token: '' }]) {
    const fresh = await mint('compat'); await f.service.details(fresh); const challenge = await f.service.challenge(fresh)
    await assert.rejects(() => f.service.confirm(fresh, { cid: challenge.cid, credential: credential(), coach: data }), e => bad(e) && !e.message.includes('sk-SECRET'))
  }
  assert.equal(f.mutations().length, 0)
  const ok = await mint('compat'); await f.service.details(ok); const { cid } = await f.service.challenge(ok)
  const result = await f.service.confirm(ok, { cid, credential: credential(), coach: { provider: 'compat', type: 'apikey', token: 'sk-SECRET', account: 'owner@coach.test' } })
  assert.deepEqual(result, { connected: { provider: 'compat' } })
  await assert.rejects(() => f.service.confirm(ok, { cid, credential: credential(), coach: { provider: 'compat', type: 'apikey', token: 'sk-SECRET' } }), bad)
  const calls = f.mutations()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].route, 'POST /api/admin/coach/connect')
  assert.deepEqual(JSON.parse(calls[0].body), { provider: 'compat', type: 'apikey', token: 'sk-SECRET', account: 'owner@coach.test' })
  assert.equal(calls[0].headers.authorization, 'Bearer bearer-1')
  assert.equal(calls[0].headers.cookie, undefined)
  assert.doesNotMatch(JSON.stringify([...f.service.pending.values()]), /sk-SECRET/)
})

/* ------------------------------ coach settings and forget ------------------------------ */

const noLeak = value => assert.doesNotMatch(JSON.stringify(value), /sk-LEAK|HEADERVALUE|owner@coach\.test/)

test('configure_coach applies an ordinary patch at once: only sent fields, both caps unchanged, admin re-proved', async t => {
  const f = await fixture(); t.after(f.close)
  const result = await f.tools.configure_coach.handler('bearer-1', { enabled: false, provider: 'compat', model: 'm2', community: true, maxMessageLen: 400, maxOutputTokens: 2048 })
  assert.deepEqual(result, { saved: true })
  assert.deepEqual(f.coachCfgSeen, [{ enabled: false, provider: 'compat', model: 'm2', community: true, maxMessageLen: 400, maxOutputTokens: 2048 }])
  assert.equal(f.seen.filter(x => x.route === 'POST /api/admin/coach/config')[0].headers.authorization, 'Bearer bearer-1')
  // A non-admin gets the upstream 403, and a withdrawn admin (me says no) sends nothing at all.
  f.admin = false
  await assert.rejects(() => f.tools.configure_coach.handler('bearer-1', { enabled: true }), e => e instanceof AdminError && e.status === 403)
  f.admin = true
  f.meAdmin = false
  await assert.rejects(() => f.tools.configure_coach.handler('bearer-1', { enabled: true }), AdminError)
  assert.equal(f.coachCfgSeen.length, 1)
})

test('configure_coach refuses secret fields, bad shapes and out-of-range values before any request', async t => {
  const f = await fixture(); t.after(f.close)
  const bad = [
    { baseUrl: 'https://evil.test' }, { headers: { a: 'b' } }, { token: 'sk-LEAK' }, { account: 'me' },
    { enabled: 'yes' }, { provider: '../x' }, { provider: 'a'.repeat(41) }, { model: 'm'.repeat(81) }, { community: 1 },
    { maxMessageLen: 199 }, { maxMessageLen: 4001 }, { maxMessageLen: 1.5 }, { maxOutputTokens: 1023 }, { maxOutputTokens: 65537 },
    { caps: { perProfileDaily: 201, instanceDaily: 50 } }, { caps: { perProfileDaily: 5, instanceDaily: 5001 } },
    { caps: { perProfileDaily: -1, instanceDaily: 50 } }, { caps: {} }, { caps: { perProfileDaily: 1.5, instanceDaily: 50 } },
    { caps: { perProfileDaily: 5, instanceDaily: 50, extra: 1 } }, { enabled: true, extra: 1 },
  ]
  for (const args of bad) await assert.rejects(() => f.tools.configure_coach.handler('bearer-1', args), AdminError, JSON.stringify(args))
  assert.equal(f.seen.length, 0)
})

test('raising a cap, or setting either cap to 0, only returns a confirmation link and never POSTs', async t => {
  const f = await fixture(); t.after(f.close)
  for (const caps of [{ perProfileDaily: 6, instanceDaily: 50 }, { perProfileDaily: 5, instanceDaily: 51 }, { perProfileDaily: 0, instanceDaily: 50 }, { perProfileDaily: 5, instanceDaily: 0 }]) {
    const result = await f.tools.configure_coach.handler('bearer-1', { caps }, 'conn1')
    assert.deepEqual(Object.keys(result), ['url'], JSON.stringify(caps))
    assert.match(result.url, /^https:\/\/gym\.example\.test\/connector\/confirm#[A-Za-z0-9_-]{43}$/)
    assert.doesNotMatch(JSON.stringify(result), /saved/)
  }
  assert.equal(f.coachCfgSeen.length, 0)
  // Other edits cannot ride along with a raise, and a non-admin cannot mint the link either.
  await assert.rejects(() => f.tools.configure_coach.handler('bearer-1', { caps: { perProfileDaily: 6, instanceDaily: 50 }, enabled: true }, 'conn1'), AdminError)
  f.admin = false
  await assert.rejects(() => f.tools.configure_coach.handler('bearer-1', { caps: { perProfileDaily: 6, instanceDaily: 50 } }, 'conn1'), e => e instanceof AdminError && e.status === 403)
  assert.equal(f.service.pending.size, 1, 'the last valid link stays pending; refusal mints no new link')
})

test('lowering both caps is an immediate POST carrying exactly those two values', async t => {
  const f = await fixture(); t.after(f.close)
  const result = await f.tools.configure_coach.handler('bearer-1', { caps: { perProfileDaily: 4, instanceDaily: 49 } })
  assert.deepEqual(result, { saved: true })
  assert.deepEqual(f.coachCfgSeen, [{ caps: { perProfileDaily: 4, instanceDaily: 49 } }])
  // Equal values are not a raise either.
  assert.deepEqual(await f.tools.configure_coach.handler('bearer-1', { caps: { perProfileDaily: 5, instanceDaily: 50 } }), { saved: true })
  assert.equal(f.coachCfgSeen.length, 2)
})

test('partial cap patches preserve the untouched live cap; 0 is unlimited and requires a link when raised', async t => {
  const f = await fixture(); t.after(f.close)
  f.coach.caps.instanceDaily = 60
  assert.deepEqual(await f.tools.configure_coach.handler('bearer-1', { caps: { perProfileDaily: 4 } }), { saved: true })
  assert.deepEqual(f.coachCfgSeen, [{ caps: { perProfileDaily: 4, instanceDaily: 60 } }])
  const { url } = await f.tools.configure_coach.handler('bearer-1', { caps: { instanceDaily: 0 } }, 'conn1')
  assert.match(url, /\/confirm#/)
  assert.equal(f.coachCfgSeen.length, 1)
  const id = idOf(url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  await f.service.confirm(id, { cid, credential: credential() })
  assert.deepEqual(f.coachCfgSeen[1], { caps: { perProfileDaily: 5, instanceDaily: 0 } })
  // Existing unlimited 0 is higher than every finite cap: changing it to 200 lowers, not raises.
  f.coach.caps.perProfileDaily = 0
  assert.deepEqual(await f.tools.configure_coach.handler('bearer-1', { caps: { perProfileDaily: 200 } }), { saved: true })
  assert.deepEqual(f.coachCfgSeen[2], { caps: { perProfileDaily: 200, instanceDaily: 60 } })
})

test('a confirmed cap raise re-checks admin and the unchanged baseline, then POSTs both caps; a changed baseline never POSTs', async t => {
  const f = await fixture(); t.after(f.close)
  const caps = { perProfileDaily: 6, instanceDaily: 50 }
  const id = idOf((await f.tools.configure_coach.handler('bearer-1', { caps }, 'conn1')).url)
  const { summary } = await f.service.details(id)
  assert.equal(summary.type, 'configure-coach')
  assert.match(summary.effect, /cap/i)
  noLeak(summary)
  const { cid } = await f.service.challenge(id)
  f.coach.caps = { perProfileDaily: 7, instanceDaily: 50 }
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.coachCfgSeen.length, 0)
  f.coach.caps = { perProfileDaily: 5, instanceDaily: 50 }
  const fresh = idOf((await f.tools.configure_coach.handler('bearer-1', { caps }, 'conn1')).url)
  await f.service.details(fresh); const challenge = await f.service.challenge(fresh)
  f.admin = false
  await assert.rejects(() => f.service.confirm(fresh, { cid: challenge.cid, credential: credential() }), bad)
  assert.equal(f.coachCfgSeen.length, 0)
  f.admin = true
  const ok = idOf((await f.tools.configure_coach.handler('bearer-1', { caps: { perProfileDaily: 0, instanceDaily: 40 } }, 'conn1')).url)
  await f.service.details(ok); const okChallenge = await f.service.challenge(ok)
  const result = await f.service.confirm(ok, { cid: okChallenge.cid, credential: credential() })
  assert.deepEqual(result, { saved: true })
  assert.deepEqual(f.coachCfgSeen, [{ caps: { perProfileDaily: 0, instanceDaily: 40 } }])
  await assert.rejects(() => f.service.confirm(ok, { cid: okChallenge.cid, credential: credential() }), bad)
  assert.equal(f.coachCfgSeen.length, 1)
})

test('list_coach_models returns at most 50 names and drops the provider error text', async t => {
  const f = await fixture(); t.after(f.close)
  const out = await f.tools.list_coach_models.handler('bearer-1', {})
  assert.deepEqual(out, { models: ['m1', 'm2'] })
  noLeak(out)
  f.modelsAnswer = { ok: false, models: ['m'.repeat(90), ...Array.from({ length: 60 }, (_, i) => `model-${i}`)], error: 'sk-LEAK exploded' }
  const bounded = await f.tools.list_coach_models.handler('bearer-1', {})
  assert.equal(bounded.models.length, 50)
  assert.ok(bounded.models.every(m => m.length <= 80))
  noLeak(bounded)
  f.admin = false
  await assert.rejects(() => f.tools.list_coach_models.handler('bearer-1', {}), e => e instanceof AdminError && e.status === 403 && !e.message.includes('sk-LEAK'))
})

test('list_coach_models fails closed when the provider is slow, without its details', async t => {
  const f = await fixture(); t.after(f.close)
  f.modelDelay = 2000
  const started = Date.now()
  await assert.rejects(() => f.tools.list_coach_models.handler('bearer-1', {}), e => e instanceof AdminError && !e.message.includes('sk-LEAK') && !e.message.includes('slow-model'))
  assert.ok(Date.now() - started < 5000, 'bounded by the models timeout')
})

test('test_coach returns the Admin link and never calls the test route', async t => {
  const f = await fixture(); t.after(f.close)
  const out = await f.tools.test_coach.handler('bearer-1', {})
  assert.equal(out.url, 'https://gym.example.test/#/admin')
  assert.equal(out.ran, false)
  assert.match(JSON.stringify(out), /not run|not executed/i)
  assert.equal(f.seen.some(x => x.url === '/api/admin/coach/test'), false)
  f.admin = false
  await assert.rejects(() => f.tools.test_coach.handler('bearer-1', {}), e => e instanceof AdminError && e.status === 403)
  f.admin = true
  f.meAdmin = false
  await assert.rejects(() => f.tools.test_coach.handler('bearer-1', {}), AdminError)
  assert.equal(f.seen.some(x => x.url === '/api/admin/coach/test'), false)
})

test('forget_coach lets any signed-in user forget only their own profile, once, after a passkey', async t => {
  const f = await fixture(); t.after(f.close)
  f.verifyUser = 'uid2'
  const { summary, result } = await approve(f, 'forget_coach', {}, 'conn2')
  assert.equal(summary.type, 'forget-coach')
  assert.equal(summary.id, 'uid2')
  assert.match(summary.effect, /coach/i)
  assert.deepEqual(result, { forgotten: true })
  const calls = f.mutations().filter(x => x.route === 'POST /api/coach/forget')
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].body), {})
  assert.equal(calls[0].headers.authorization, 'Bearer bearer-2')
  assert.deepEqual(f.forgetSeen, ['uid2'])
  assert.equal(f.seen.some(x => x.url.startsWith('/api/admin/')), false)
  noLeak(result)
  // No caller-chosen target: another user id is refused before any request.
  await assert.rejects(async () => f.tools.forget_coach.handler('conn2', { id: 'uid1' }), AdminError)
  // A session that no longer matches the stored user cannot mint.
  f.meId = 'someone-else'
  await assert.rejects(() => f.tools.forget_coach.handler('conn2', {}), bad)
  assert.equal(f.forgetSeen.length, 1)
})

test('forget_coach executes at most once and re-checks the signed-in user right before the POST', async t => {
  const f = await fixture(); t.after(f.close)
  f.verifyUser = 'uid2'
  const id = idOf((await f.tools.forget_coach.handler('conn2', {})).url)
  await f.service.details(id); const { cid } = await f.service.challenge(id)
  f.meId = 'someone-else'
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential() }), bad)
  assert.equal(f.forgetSeen.length, 0)
  f.meId = null
  const fresh = idOf((await f.tools.forget_coach.handler('conn2', {})).url)
  await f.service.details(fresh); const challenge = await f.service.challenge(fresh)
  await f.service.confirm(fresh, { cid: challenge.cid, credential: credential() })
  await assert.rejects(() => f.service.confirm(fresh, { cid: challenge.cid, credential: credential() }), bad)
  assert.deepEqual(f.forgetSeen, ['uid2'])
})

test('Coach refuses withdrawn admin, changed provider, invalid secret without reflecting input', async t => {
  const f = await fixture(); t.after(f.close)
  const mint = async () => idOf((await f.tools.request_connect_coach.handler('conn1', { provider: 'compat' })).url)
  let id = await mint(); await f.service.details(id); let { cid } = await f.service.challenge(id)
  f.coach.providers[0].apiKey = false
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential(), coach: { provider: 'compat', type: 'apikey', token: 'sk-SECRET' } }), bad)
  f.coach.providers[0].apiKey = true
  id = await mint(); await f.service.details(id); ({ cid } = await f.service.challenge(id))
  f.admin = false
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential(), coach: { provider: 'compat', type: 'apikey', token: 'sk-SECRET' } }), bad)
  f.admin = true
  id = await mint(); await f.service.details(id); ({ cid } = await f.service.challenge(id))
  await assert.rejects(() => f.service.confirm(id, { cid, credential: credential(), coach: { provider: 'compat', type: 'apikey', token: 'sk-SECRET', extra: 'sk-SECRET' } }), e => bad(e) && !e.message.includes('sk-SECRET'))
  assert.equal(f.mutations().length, 0)
})
