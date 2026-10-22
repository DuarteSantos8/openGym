import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server.js'
import {
  establishSession, connect, createPending, sealBearer, openBearer, sameOrigin, HandoffError,
} from '../src/openGymSession.js'

const BEARER = 'uid1:9999999999999:0.signature-of-the-openGym-session'
const CODE = 'ABCD2345'
const FRESH = '__Host-gymsid=fresh-session'
const ASSERTION = {
  cid: 'cid-1',
  credential: {
    id: 'cred-1', rawId: 'cmF3', type: 'public-key',
    response: { clientDataJSON: 'Y2Q', authenticatorData: 'YWQ', signature: 'c2ln', userHandle: null },
  },
}
const LOGIN_COOKIES = [
  '__Host-gymsid=fresh-session; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax',
  'gymsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
]

// A fake openGym API that records every request it sees. `script` overrides replies per route.
async function listen(handler) {
  const seen = []
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      seen.push({ route: `${req.method} ${req.url}`, headers: req.headers, body })
      handler(req, res, body)
    })
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  return { srv, seen, url: `http://127.0.0.1:${srv.address().port}` }
}
const reply = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(obj))
}

let api, script, who
beforeEach(async () => {
  script = {}
  who = { login: 'uid1', redeem: 'uid1' }
  const live = new Set()
  api = await listen((req, res, body) => {
    const route = `${req.method} ${req.url}`
    if (script[route]) return script[route](req, res, body)
    if (route === 'POST /api/login/verify') {
      if (JSON.parse(body || '{}').cid !== 'cid-1') return reply(res, 400, { error: 'challenge expired', code: 'challenge-expired' })
      return reply(res, 200, { user: { id: who.login, name: 'Ana', admin: false } }, { 'set-cookie': LOGIN_COOKIES })
    }
    if (route === 'POST /api/pair/create') {
      if (req.headers.cookie !== FRESH) return reply(res, 401, { error: 'not signed in' })
      live.add(CODE)
      return reply(res, 200, { code: CODE })
    }
    if (route === 'POST /api/pair/redeem') {
      const { code } = JSON.parse(body || '{}')
      if (!live.delete(code)) return reply(res, 400, { error: 'invalid or expired code', code: 'pair-invalid' })
      return reply(res, 200, { token: BEARER, user: { id: who.redeem, name: 'Ana', admin: false } })
    }
    reply(res, 404, { error: 'nope' })
  })
})
afterEach(() => new Promise(r => api.srv.close(r)))

const run = (over = {}, ...a) => establishSession(a.length ? a[0] : ASSERTION, { apiBase: api.url, ...over })
const routes = () => api.seen.map(s => s.route)
const fail = code => e => e instanceof HandoffError && e.code === code

// ---- the assertion is the only credential the connector takes from the browser ---------------
test('the user comes from openGym verifying the assertion, never from the caller', async () => {
  const out = await run({ loginUserId: 'uid2', userId: 'uid2' }) // caller-supplied identities are ignored
  assert.deepEqual(out, { user: { id: 'uid1', name: 'Ana', admin: false }, bearer: BEARER })
  const [verify] = api.seen
  assert.equal(verify.route, 'POST /api/login/verify')
  assert.deepEqual(JSON.parse(verify.body), ASSERTION)
  assert.equal(verify.headers.cookie, undefined, 'login/verify carries no cookie')
  assert.equal(verify.headers.authorization, undefined)
})

test('the fresh session cookie goes only to pair/create; login and redeem carry none', async () => {
  await run({ cookie: 'gymsid=ambient-browser-cookie' }) // an ambient browser cookie is never an input
  assert.deepEqual(routes(), ['POST /api/login/verify', 'POST /api/pair/create', 'POST /api/pair/redeem'])
  const [verify, create, redeem] = api.seen
  assert.equal(create.headers.cookie, FRESH, 'only the fresh session cookie, not the legacy expiry')
  assert.equal(verify.headers.cookie, undefined)
  assert.equal(redeem.headers.cookie, undefined)
  assert.equal(redeem.headers.authorization, undefined)
  assert.ok(!JSON.stringify(api.seen).includes('ambient-browser-cookie'))
})

test('the pairing code is redeemed exactly once, with only the code in the body', async () => {
  await run()
  const redeems = api.seen.filter(s => s.route === 'POST /api/pair/redeem')
  assert.equal(redeems.length, 1)
  assert.deepEqual(JSON.parse(redeems[0].body), { code: CODE })
})

test('the result carries no cookie and no pairing code', async () => {
  const text = JSON.stringify(await run())
  assert.ok(!text.includes('fresh-session') && !text.includes(CODE))
})

test('redeemed user id must equal the login user id; mismatch fails closed', async () => {
  who.redeem = 'uid2'
  await assert.rejects(() => run(), fail('mismatch'))
})

test('a malformed assertion is refused before any request', async () => {
  const long = 'x'.repeat(300)
  const bad = [undefined, null, 'str', {}, { cid: '' , credential: {} }, { cid: 5, credential: {} }, { cid: long, credential: {} },
    { cid: 'cid-1' }, { cid: 'cid-1', credential: 'x' }, { cid: 'cid-1', credential: null }, { cid: 'cid-1', credential: [] }]
  for (const a of bad) await assert.rejects(() => run({}, a), fail('bad-assertion'))
  assert.deepEqual(routes(), [])
})

test('only cid and credential are sent on to openGym', async () => {
  await run({}, { ...ASSERTION, userId: 'uid2', cookie: 'x=y', extra: 1 })
  assert.deepEqual(JSON.parse(api.seen[0].body), ASSERTION)
})

// ---- the session cookie the connector accepts from openGym ----------------------------------
test('Set-Cookie handling mirrors api/server.js: refuse missing, empty, duplicate or odd values', async () => {
  const jars = [
    [],
    ['gymsid=; Path=/; Max-Age=0'],
    ['__Host-gymsid=a; Path=/', '__Host-gymsid=b; Path=/'],
    ['gymsid=a; Path=/', 'gymsid=b; Path=/'],
    ['__Host-gymsid=a,b; Path=/'],
    ['__Host-gymsid=a b; Path=/'],
    ['other=zzz; Path=/'],
  ]
  for (const jar of jars) {
    api.seen.length = 0
    script = { 'POST /api/login/verify': (req, res) => reply(res, 200, { user: { id: 'uid1' } }, jar.length ? { 'set-cookie': jar } : {}) }
    await assert.rejects(() => run(), fail('upstream'), JSON.stringify(jar))
    assert.deepEqual(routes(), ['POST /api/login/verify'], 'no pair/create without a usable session cookie')
  }
})

test('the host-only cookie is preferred; a legacy-only session still works; equal duplicates are fine', async () => {
  const send = jar => { script = { 'POST /api/login/verify': (req, res) => reply(res, 200, { user: { id: 'uid1', name: 'Ana' } }, { 'set-cookie': jar }) } }
  send(['gymsid=legacy-val; Path=/', '__Host-gymsid=fresh-session; Path=/'])
  await run()
  assert.equal(api.seen[1].headers.cookie, FRESH)
  send(['__Host-gymsid=fresh-session; Path=/', '__Host-gymsid=fresh-session; Path=/'])
  api.seen.length = 0
  await run()
  assert.equal(api.seen[1].headers.cookie, FRESH)
  script = {
    'POST /api/login/verify': (req, res) => reply(res, 200, { user: { id: 'uid1', name: 'Ana' } }, { 'set-cookie': ['gymsid=fresh-session; Path=/'] }),
    'POST /api/pair/create': (req, res) => reply(res, req.headers.cookie === 'gymsid=fresh-session' ? 200 : 401, { code: CODE }),
    'POST /api/pair/redeem': (req, res) => reply(res, 200, { token: BEARER, user: { id: 'uid1', name: 'Ana' } }),
  }
  api.seen.length = 0
  await run()
  assert.equal(api.seen[1].headers.cookie, 'gymsid=fresh-session')
})

// ---- fail closed ---------------------------------------------------------------------------
test('disabled, expired, unknown and malformed upstream answers all fail closed', async () => {
  const cases = [
    ['POST /api/login/verify', 400, { error: 'x', code: 'challenge-expired' }, 'login-failed'],
    ['POST /api/login/verify', 404, { error: 'x', code: 'unknown-credential' }, 'login-failed'],
    ['POST /api/login/verify', 403, { error: 'x', code: 'disabled' }, 'disabled'],
    ['POST /api/login/verify', 500, { error: 'boom' }, 'upstream'],
    ['POST /api/login/verify', 200, { nope: true }, 'upstream'],
    ['POST /api/login/verify', 200, { user: { id: 5 } }, 'upstream'],
    ['POST /api/login/verify', 200, { user: { id: 'uid1' } }, 'upstream'], // no Set-Cookie at all
    ['POST /api/pair/create', 401, { error: 'not signed in' }, 'not-signed-in'],
    ['POST /api/pair/create', 403, { error: 'x', code: 'disabled' }, 'disabled'],
    ['POST /api/pair/create', 500, { error: 'boom' }, 'upstream'],
    ['POST /api/pair/create', 200, { nope: true }, 'upstream'],
    ['POST /api/pair/redeem', 400, { error: 'x', code: 'pair-invalid' }, 'expired'],
    ['POST /api/pair/redeem', 403, { error: 'x', code: 'disabled' }, 'disabled'],
    ['POST /api/pair/redeem', 502, { error: 'bad gateway' }, 'upstream'],
    ['POST /api/pair/redeem', 200, { user: { id: 'uid1' } }, 'upstream'],
    ['POST /api/pair/redeem', 200, { token: BEARER }, 'upstream'],
    ['POST /api/pair/redeem', 200, { token: '', user: { id: 'uid1' } }, 'upstream'],
    ['POST /api/pair/redeem', 200, { token: BEARER, user: { id: 5 } }, 'upstream'],
  ]
  for (const [route, status, body, code] of cases) {
    script = { [route]: (req, res) => reply(res, status, body) }
    await assert.rejects(() => run(), fail(code), `${route} ${status} -> ${code}`)
  }
})

test('non-JSON, oversized and unreachable answers fail closed', async () => {
  for (const route of ['POST /api/login/verify', 'POST /api/pair/create']) {
    script = { [route]: (req, res) => { res.writeHead(200); res.end('<html>') } }
    await assert.rejects(() => run(), fail('upstream'))
    script = { [route]: (req, res) => { res.writeHead(200); res.end(JSON.stringify({ pad: 'x'.repeat(100_000) })) } }
    await assert.rejects(() => run(), fail('upstream'))
  }
  const dead = api.url
  await new Promise(r => api.srv.close(r))
  await assert.rejects(() => establishSession(ASSERTION, { apiBase: dead }), fail('upstream'))
  api.srv = http.createServer().listen(0) // so afterEach can close something
})

test('a malformed pairing code is never sent on to redeem', async () => {
  for (const code of ['', 'abc', 'ABCD2345/../x', 'A'.repeat(64), 5, null]) {
    api.seen.length = 0
    script = { 'POST /api/pair/create': (req, res) => reply(res, 200, { code }) }
    await assert.rejects(() => run(), fail('upstream'))
    assert.deepEqual(routes(), ['POST /api/login/verify', 'POST /api/pair/create'])
  }
})

test('a redirect is never followed: the cookie, assertion and code cannot leak to another origin', async () => {
  const evil = await listen((req, res) => reply(res, 200, { code: CODE }))
  const redirect = (req, res) => { res.writeHead(307, { location: `${evil.url}/steal` }); res.end() }
  try {
    for (const route of ['POST /api/login/verify', 'POST /api/pair/create', 'POST /api/pair/redeem']) {
      script = { [route]: redirect }
      await assert.rejects(() => run(), fail('upstream'), route)
    }
    assert.equal(evil.seen.length, 0)
  } finally { await new Promise(r => evil.srv.close(r)) }
})

test('a stalled openGym fails closed instead of hanging', async () => {
  for (const route of ['POST /api/login/verify', 'POST /api/pair/create']) {
    script = { [route]: () => {} } // never answers
    await assert.rejects(() => run({ timeoutMs: 50 }), fail('upstream'))
  }
})

test('errors never carry the cookie, pairing code, bearer or assertion', async () => {
  const leaks = [CODE, BEARER, 'fresh-session', 'c2ln', 'cred-1']
  const flows = [
    () => { who.redeem = 'uid2'; return run() },
    () => { script = { 'POST /api/pair/redeem': (req, res) => reply(res, 500, { error: `${CODE} ${BEARER} fresh-session` }) }; return run() },
    () => { script = { 'POST /api/login/verify': (req, res) => reply(res, 500, { error: 'c2ln cred-1' }) }; return run() },
  ]
  for (const f of flows) {
    const e = await f().then(() => null, x => x)
    assert.ok(e instanceof HandoffError)
    const text = `${e.message} ${e.stack} ${JSON.stringify(e)}`
    for (const l of leaks) assert.ok(!text.includes(l), `leaked ${l}`)
  }
})

// ---- AES-256-GCM sealing -------------------------------------------------------------------
const KEY = crypto.randomBytes(32)

test('sealBearer/openBearer round-trip; ciphertext hides the bearer and is randomised', () => {
  const a = sealBearer(BEARER, KEY, 'uid1')
  const b = sealBearer(BEARER, KEY, 'uid1')
  assert.notEqual(a, b)
  assert.ok(!Buffer.from(a, 'base64url').includes(BEARER))
  assert.equal(openBearer(a, KEY, 'uid1'), BEARER)
})

test('sealed bearer is bound to its key, user and bytes', () => {
  const s = sealBearer(BEARER, KEY, 'uid1')
  assert.throws(() => openBearer(s, crypto.randomBytes(32), 'uid1'))
  assert.throws(() => openBearer(s, KEY, 'uid2'), 'record swapped to another user')
  const raw = Buffer.from(s, 'base64url')
  raw[raw.length - 1] ^= 1
  assert.throws(() => openBearer(raw.toString('base64url'), KEY, 'uid1'))
  assert.throws(() => openBearer('', KEY, 'uid1'))
  assert.throws(() => openBearer('AAAA', KEY, 'uid1'))
})

test('the key must be exactly 32 bytes', () => {
  for (const k of [undefined, 'a'.repeat(32), crypto.randomBytes(16), crypto.randomBytes(33)]) {
    assert.throws(() => sealBearer(BEARER, k, 'uid1'), /32/)
    assert.throws(() => openBearer('AAAA', k, 'uid1'), /32/)
  }
})

// ---- pending connection ids ----------------------------------------------------------------
test('createPending mints unguessable server-side ids with a bounded lifetime', () => {
  const pending = new Map()
  const ids = new Set()
  for (let i = 0; i < 500; i++) ids.add(createPending(pending))
  assert.equal(ids.size, 500)
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{43}$/)
  const [id] = ids
  const left = pending.get(id).exp - Date.now()
  assert.ok(left > 0 && left <= 5 * 60_000, `lifetime ${left}`)
  assert.deepEqual(Object.keys(pending.get(id)), ['exp'])
})

const ctx = (over = {}) => {
  const pending = over.pending || new Map()
  const pendingId = over.pendingId ?? createPending(pending)
  return { apiBase: api.url, key: KEY, store: new Map(), pending, pendingId, ...over }
}

test('connect stores the sealed bearer under the pending id and returns only that id', async () => {
  const c = ctx()
  const out = await connect(ASSERTION, c)
  assert.deepEqual(out, { connectionId: c.pendingId })
  const rec = c.store.get(c.pendingId)
  assert.equal(rec.userId, 'uid1')
  assert.equal(openBearer(rec.sealed, KEY, 'uid1'), BEARER)
  const everything = JSON.stringify(out) + JSON.stringify(rec)
  for (const s of [BEARER, CODE, 'fresh-session']) assert.ok(!everything.includes(s), s)
  assert.equal(c.pending.has(c.pendingId), false, 'the pending record is consumed')
})

test('a pending id works once: replay is refused without any request', async () => {
  const c = ctx()
  await connect(ASSERTION, c)
  api.seen.length = 0
  await assert.rejects(() => connect(ASSERTION, c), fail('pending'))
  assert.deepEqual(routes(), [])
  assert.equal(c.store.size, 1)
})

test('two simultaneous connects with one pending id: exactly one wins and openGym sees one login', async () => {
  const c = ctx()
  const out = await Promise.allSettled([connect(ASSERTION, c), connect(ASSERTION, c)])
  assert.deepEqual(out.map(o => o.status).sort(), ['fulfilled', 'rejected'])
  assert.ok(fail('pending')(out.find(o => o.status === 'rejected').reason))
  assert.equal(routes().filter(r => r === 'POST /api/login/verify').length, 1)
})

test('a failed handoff still burns the pending id (one use, then start over)', async () => {
  const c = ctx()
  who.redeem = 'uid2'
  await assert.rejects(() => connect(ASSERTION, c), fail('mismatch'))
  assert.equal(c.store.size, 0)
  who.redeem = 'uid1'
  api.seen.length = 0
  await assert.rejects(() => connect(ASSERTION, c), fail('pending'))
  assert.deepEqual(routes(), [])
})

test('nonexistent, malformed and expired pending ids are refused before any request', async () => {
  const unknown = crypto.randomBytes(32).toString('base64url')
  const bad = [undefined, null, 7, {}, [], '', 'short', '__proto__', 'constructor', 'a'.repeat(44), `${unknown.slice(0, 42)}!`, unknown]
  for (const pendingId of bad) await assert.rejects(() => connect(ASSERTION, ctx({ pendingId })), fail('pending'), String(pendingId))
  const pending = new Map()
  const pendingId = createPending(pending, { ttlMs: 1000, now: () => 5000 })
  await assert.rejects(() => connect(ASSERTION, ctx({ pending, pendingId, now: () => 6000 })), fail('pending'), 'expired')
  assert.equal(pending.has(pendingId), false, 'an expired record is dropped')
  assert.deepEqual(routes(), [])
})

test('connect never overwrites an existing connection, before or during the handoff', async () => {
  const existing = { userId: 'uid9', sealed: 'EXISTING' }
  const c = ctx()
  c.store.set(c.pendingId, existing)
  await assert.rejects(() => connect(ASSERTION, c), fail('pending'))
  assert.equal(c.store.get(c.pendingId), existing)
  assert.deepEqual(routes(), [])

  const d = ctx()
  script = {
    'POST /api/login/verify': (req, res) => {
      d.store.set(d.pendingId, existing) // someone else claims the id while the handoff is in flight
      reply(res, 200, { user: { id: 'uid1', name: 'Ana' } }, { 'set-cookie': LOGIN_COOKIES })
    },
  }
  await assert.rejects(() => connect(ASSERTION, d), fail('pending'))
  assert.equal(d.store.get(d.pendingId), existing)
})

test('connect stores nothing when the handoff fails', async () => {
  for (const f of [() => { who.redeem = 'uid2' }, () => { script = { 'POST /api/pair/create': (req, res) => reply(res, 500, {}) } }]) {
    f()
    const c = ctx()
    await assert.rejects(() => connect(ASSERTION, c), e => e instanceof HandoffError)
    assert.equal(c.store.size, 0)
  }
})

test('a bad key is refused before the pending id or the assertion is spent', async () => {
  for (const key of [undefined, crypto.randomBytes(5)]) {
    const c = ctx({ key })
    await assert.rejects(() => connect(ASSERTION, c), /32/)
    assert.equal(c.pending.has(c.pendingId), true)
  }
  assert.deepEqual(routes(), [])
})

test('connect refuses a malformed assertion without spending anything', async () => {
  const c = ctx()
  await assert.rejects(() => connect({ cid: 'x' }, c), fail('bad-assertion'))
  assert.deepEqual(routes(), [])
})

// ---- same-origin gate for the connector POST -----------------------------------------------
test('sameOrigin accepts only a same-origin browser request', () => {
  const o = 'https://gym.areum.cl'
  assert.equal(sameOrigin({ 'sec-fetch-site': 'same-origin' }, o), true)
  assert.equal(sameOrigin({ 'sec-fetch-site': 'same-site' }, o), false)
  assert.equal(sameOrigin({ 'sec-fetch-site': 'cross-site' }, o), false)
  assert.equal(sameOrigin({ 'sec-fetch-site': 'none' }, o), false)
  assert.equal(sameOrigin({ origin: 'https://gym.areum.cl' }, o), true)
  assert.equal(sameOrigin({ origin: 'https://evil.example' }, o), false)
  assert.equal(sameOrigin({}, o), false, 'no browser evidence at all fails closed')
})

// ---- the page ------------------------------------------------------------------------------
const pageSrc = readFileSync(fileURLToPath(new URL('../src/web/connect.html', import.meta.url)), 'utf8')
const pageScript = pageSrc.match(/<script>([\s\S]*?)<\/script>/)?.[1]

async function withServer(fn) {
  const server = createServer({ origin: 'https://gym.areum.cl', prefix: '/connector' })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try { return await fn(`http://127.0.0.1:${server.address().port}`) } finally { await new Promise(r => server.close(r)) }
}

test('connector HTML is served with a frame-denying CSP header and X-Frame-Options', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/connector/connect`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/html/)
    const csp = res.headers.get('content-security-policy')
    assert.match(csp, /frame-ancestors 'none'/)
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /connect-src 'self'/)
    assert.equal(res.headers.get('x-frame-options'), 'DENY')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('cache-control'), /no-store/)
  })
})

test('served connector HTML contains neither a connection ID nor dynamic account values', async () => {
  await withServer(async base => {
    const html = await (await fetch(`${base}/connector/connect`, { headers: { cookie: '__Host-gymsid=fresh-session; gymsid=x' } })).text()
    assert.equal(html, pageSrc, 'identical for every request: nothing is injected')
    for (const s of ['connectionId', BEARER, CODE, 'uid1', 'Ana', 'fresh-session']) assert.ok(!html.includes(s), s)
  })
})

test('POST /connector/connect without the server-issued OAuth cookie is refused', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/connector/connect`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 403)
  })
})

test('connect.html is static and never touches login/verify, pairing, tokens or account ids', () => {
  assert.ok(!/\{\{|<%|\$\{user|__USER__|__DATA__/.test(pageSrc))
  assert.ok(!/bearer|pair|token|verify|userId|connectionId/i.test(pageSrc))
  assert.match(pageSrc, /\/api\/login\/options/)
  assert.match(pageSrc, /\/connector\/connect/)
  assert.ok(!/<script[^>]+src=/i.test(pageSrc), 'no external scripts')
  assert.match(pageSrc, /Content-Security-Policy/)
  assert.ok(pageScript && !/location\.(href|replace)|window\.open/.test(pageScript), 'only location.assign, only for the server redirect')
})

test('connect.html uses the same passkey conversion as frontend/src/lib/api.js', () => {
  const api = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/api.js', import.meta.url)), 'utf8')
  for (const fn of ['bufToB64u', 'b64uToBuf', 'toRequestOptions', 'credToJSON']) assert.ok(pageSrc.includes(fn), `page defines ${fn}`)
  for (const f of ['authenticatorData', 'signature', 'userHandle', 'clientDataJSON', 'clientExtensionResults', 'authenticatorAttachment']) {
    assert.ok(api.includes(f) && pageSrc.includes(f), f)
  }
})

// Runs the real inline script against stubbed browser APIs and returns what it asked the network for.
async function runPage({ options = async () => ({ ok: true, json: async () => ({ cid: 'cid-1', options: { challenge: 'AAEC', allowCredentials: [{ id: 'AQID', type: 'public-key' }] } }) }),
  connectRes = async () => ({ ok: true, status: 200, json: async () => ({ redirect: 'https://claude.ai/api/mcp/auth_callback?code=C&state=S' }) }),
  get = async () => ({
    id: 'cred-1', rawId: new Uint8Array([1, 2]).buffer, type: 'public-key', authenticatorAttachment: null,
    getClientExtensionResults: () => ({}),
    response: { clientDataJSON: new Uint8Array([3]).buffer, authenticatorData: new Uint8Array([4]).buffer, signature: new Uint8Array([5]).buffer, userHandle: null },
  }) } = {}) {
  const calls = [], els = {}, handlers = {}, nav = []
  const el = id => (els[id] ??= { textContent: '', addEventListener: (ev, fn) => { handlers[ev] = fn } })
  const sandbox = {
    atob, btoa, Uint8Array, ArrayBuffer,
    document: { getElementById: el },
    navigator: { credentials: { get } },
    location: { assign: u => nav.push(u) },
    fetch: async (url, init = {}) => { calls.push({ url, init }); return url.startsWith('/api/login/options') ? options() : url === '/connector/connect' ? connectRes() : { ok: false } },
  }
  vm.runInContext(pageScript, vm.createContext(sandbox))
  await handlers.click()
  return { calls, nav, out: els.out.textContent }
}

test('page sends openGym only for login options and the connector only the assertion', async () => {
  const { calls, out } = await runPage()
  assert.deepEqual(calls.map(c => c.url), ['/api/login/options', '/connector/connect'])
  assert.equal(calls[0].init.credentials, 'omit')
  const post = calls[1].init
  assert.equal(post.method, 'POST')
  assert.equal(post.credentials, 'same-origin')
  assert.equal(post.redirect, 'error')
  const body = JSON.parse(post.body)
  assert.deepEqual(Object.keys(body).sort(), ['cid', 'credential'])
  assert.equal(body.cid, 'cid-1')
  assert.deepEqual(Object.keys(body.credential).sort(), ['authenticatorAttachment', 'clientExtensionResults', 'id', 'rawId', 'response', 'type'])
  assert.deepEqual(body.credential.response, { clientDataJSON: 'Aw', authenticatorData: 'BA', signature: 'BQ', userHandle: null })
  assert.equal(out, 'Connected.', 'fixed message; the response body is never rendered')
})

test('page follows only the redirect the connector returned, and only to an allowed target', async () => {
  const ok = await runPage()
  assert.deepEqual(ok.nav, ['https://claude.ai/api/mcp/auth_callback?code=C&state=S'])
  const loop = await runPage({ connectRes: async () => ({ ok: true, status: 200, json: async () => ({ redirect: 'http://127.0.0.1:8123/cb?code=C' }) }) })
  assert.deepEqual(loop.nav, ['http://127.0.0.1:8123/cb?code=C'])
  for (const redirect of ['https://evil.test/x', 'javascript:alert(1)', 'data:text/html,x', '//evil.test', 'http://evil.test/cb', 'https://claude.ai/api/mcp/auth_callback.evil.test', 'https://claude.ai/api/mcp/auth_callback/x', 'http://127.0.0.1:80@evil.test/', 7, null, undefined]) {
    const r = await runPage({ connectRes: async () => ({ ok: true, status: 200, json: async () => ({ redirect }) }) })
    assert.deepEqual(r.nav, [], String(redirect))
    assert.equal(r.out, 'Could not connect.')
  }
  const failed = await runPage({ connectRes: async () => ({ ok: false, status: 403, json: async () => ({ redirect: 'https://claude.ai/api/mcp/auth_callback?code=C' }) }) })
  assert.deepEqual(failed.nav, [])
})

test('page shows only a generic failure when anything goes wrong', async () => {
  for (const over of [
    { connectRes: async () => ({ ok: false, status: 403, json: async () => ({ error: 'uid1 is disabled', connectionId: 'SECRET-ID' }) }) },
    { options: async () => { throw new Error('network uid1') } },
    { get: async () => { throw new Error('cancelled uid1') } },
  ]) {
    const { out } = await runPage(over)
    assert.equal(out, 'Could not connect.')
  }
})
