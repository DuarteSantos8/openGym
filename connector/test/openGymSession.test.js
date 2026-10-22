import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server.js'
import {
  establishSession, connect, sealBearer, openBearer, sameOrigin, HandoffError,
} from '../src/openGymSession.js'

const BEARER = 'uid1:9999999999999:0.signature-of-the-openGym-session'
const CODE = 'ABCD2345'
const COOKIE = '__Host-gymsid=sess-token; other=secret-unrelated'

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

let api, script
beforeEach(async () => {
  script = {}
  const live = new Set()
  api = await listen((req, res, body) => {
    const route = `${req.method} ${req.url}`
    if (script[route]) return script[route](req, res, body)
    if (route === 'POST /api/pair/create') {
      if (!(req.headers.cookie || '').includes('gymsid=sess-token')) return reply(res, 401, { error: 'not signed in' })
      live.add(CODE)
      return reply(res, 200, { code: CODE })
    }
    if (route === 'POST /api/pair/redeem') {
      const { code } = JSON.parse(body || '{}')
      if (!live.delete(code)) return reply(res, 400, { error: 'invalid or expired code', code: 'pair-invalid' })
      return reply(res, 200, { token: BEARER, user: { id: 'uid1', name: 'Ana', admin: false } })
    }
    reply(res, 404, { error: 'nope' })
  })
})
afterEach(() => new Promise(r => api.srv.close(r)))

const opts = (over = {}) => ({ apiBase: api.url, loginUserId: 'uid1', ...over })
const routes = () => api.seen.map(s => s.route)

test('session cookie goes only to pair/create; redeem and everything else carry none', async () => {
  const out = await establishSession(COOKIE, opts())
  assert.deepEqual(out, { user: { id: 'uid1', name: 'Ana', admin: false }, bearer: BEARER })
  assert.deepEqual(routes(), ['POST /api/pair/create', 'POST /api/pair/redeem'])
  const [create, redeem] = api.seen
  assert.equal(create.headers.cookie, '__Host-gymsid=sess-token', 'only the session cookie is forwarded')
  assert.equal(redeem.headers.cookie, undefined)
  assert.equal(redeem.headers.authorization, undefined)
  assert.equal(create.headers.authorization, undefined)
})

test('the pairing code is redeemed exactly once, with only the code in the body', async () => {
  await establishSession(COOKIE, opts())
  const redeems = api.seen.filter(s => s.route === 'POST /api/pair/redeem')
  assert.equal(redeems.length, 1)
  assert.deepEqual(JSON.parse(redeems[0].body), { code: CODE })
})

test('no session cookie: refuses without calling openGym', async () => {
  for (const jar of ['', 'other=1', undefined]) {
    await assert.rejects(() => establishSession(jar, opts()), e => e instanceof HandoffError && e.code === 'not-signed-in')
  }
  assert.deepEqual(routes(), [])
})

test('a cookie jar object works the same as a header string', async () => {
  await establishSession({ '__Host-gymsid': 'sess-token', other: 'x' }, opts())
  assert.equal(api.seen[0].headers.cookie, '__Host-gymsid=sess-token')
})

test('login user id must match the redeemed user id; mismatch fails closed', async () => {
  await assert.rejects(() => establishSession(COOKIE, opts({ loginUserId: 'uid2' })), e => e.code === 'mismatch')
  for (const bad of [undefined, '', null, 7]) {
    await assert.rejects(() => establishSession(COOKIE, opts({ loginUserId: bad })), e => e.code === 'mismatch')
  }
})

test('disabled, expired and unknown upstream answers all fail closed', async () => {
  const cases = [
    ['POST /api/pair/create', 401, { error: 'not signed in' }, 'not-signed-in'], // disabled account: sessionOf is null
    ['POST /api/pair/create', 403, { error: 'this account has been disabled', code: 'disabled' }, 'disabled'],
    ['POST /api/pair/create', 500, { error: 'boom' }, 'upstream'],
    ['POST /api/pair/create', 200, { nope: true }, 'upstream'],
    ['POST /api/pair/redeem', 400, { error: 'invalid or expired code', code: 'pair-invalid' }, 'expired'],
    ['POST /api/pair/redeem', 403, { error: 'x', code: 'disabled' }, 'disabled'],
    ['POST /api/pair/redeem', 502, { error: 'bad gateway' }, 'upstream'],
    ['POST /api/pair/redeem', 200, { user: { id: 'uid1' } }, 'upstream'],            // no token
    ['POST /api/pair/redeem', 200, { token: BEARER }, 'upstream'],                    // no user
    ['POST /api/pair/redeem', 200, { token: '', user: { id: 'uid1' } }, 'upstream'],
    ['POST /api/pair/redeem', 200, { token: BEARER, user: { id: 5 } }, 'upstream'],
  ]
  for (const [route, status, body, code] of cases) {
    script = { [route]: (req, res) => reply(res, status, body) }
    await assert.rejects(() => establishSession(COOKIE, opts()), e => e instanceof HandoffError && e.code === code, `${route} ${status} -> ${code}`)
  }
})

test('non-JSON, oversized and unreachable answers fail closed', async () => {
  script = { 'POST /api/pair/create': (req, res) => { res.writeHead(200); res.end('<html>') } }
  await assert.rejects(() => establishSession(COOKIE, opts()), e => e.code === 'upstream')
  script = { 'POST /api/pair/create': (req, res) => { res.writeHead(200); res.end(JSON.stringify({ code: CODE, pad: 'x'.repeat(100_000) })) } }
  await assert.rejects(() => establishSession(COOKIE, opts()), e => e.code === 'upstream')
  const dead = api.url
  await new Promise(r => api.srv.close(r))
  await assert.rejects(() => establishSession(COOKIE, { apiBase: dead, loginUserId: 'uid1' }), e => e.code === 'upstream')
  api.srv = http.createServer().listen(0) // so afterEach can close something
})

test('a malformed pairing code is never sent on to redeem', async () => {
  for (const code of ['', 'abc', 'ABCD2345/../x', 'A'.repeat(64), 5, null]) {
    api.seen.length = 0
    script = { 'POST /api/pair/create': (req, res) => reply(res, 200, { code }) }
    await assert.rejects(() => establishSession(COOKIE, opts()), e => e.code === 'upstream')
    assert.deepEqual(routes(), ['POST /api/pair/create'])
  }
})

test('a redirect is never followed: the cookie cannot leak to another origin', async () => {
  const evil = await listen((req, res) => reply(res, 200, { code: CODE }))
  try {
    script = { 'POST /api/pair/create': (req, res) => { res.writeHead(307, { location: `${evil.url}/steal` }); res.end() } }
    await assert.rejects(() => establishSession(COOKIE, opts()), e => e.code === 'upstream')
    assert.equal(evil.seen.length, 0)
    script = {
      'POST /api/pair/create': (req, res) => reply(res, 200, { code: CODE }),
      'POST /api/pair/redeem': (req, res) => { res.writeHead(302, { location: `${evil.url}/steal` }); res.end() },
    }
    await assert.rejects(() => establishSession(COOKIE, opts()), e => e.code === 'upstream')
    assert.equal(evil.seen.length, 0)
  } finally { await new Promise(r => evil.srv.close(r)) }
})

test('errors never carry the cookie, pairing code or bearer', async () => {
  const leaks = [CODE, BEARER, 'sess-token', 'secret-unrelated']
  const flows = [
    () => establishSession(COOKIE, opts({ loginUserId: 'uid2' })),
    () => { script = { 'POST /api/pair/redeem': (req, res) => reply(res, 500, { error: `${CODE} ${BEARER}` }) }; return establishSession(COOKIE, opts()) },
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

// ---- connect(): what the browser is allowed to see -----------------------------------------
test('connect stores the bearer sealed under the caller-bound connection id', async () => {
  const store = new Map()
  const expectedConnectionId = 'caller-bound-connection-id'
  const out = await connect(COOKIE, { ...opts(), key: KEY, store, expectedConnectionId })
  assert.deepEqual(out, { connectionId: expectedConnectionId })
  const rec = store.get(expectedConnectionId)
  assert.equal(rec.userId, 'uid1')
  assert.equal(openBearer(rec.sealed, KEY, 'uid1'), BEARER)
  const everything = JSON.stringify(out) + JSON.stringify(rec)
  assert.ok(!everything.includes(BEARER) && !everything.includes(CODE))
})

test('connect stores nothing when the handoff fails', async () => {
  const store = new Map()
  const expectedConnectionId = 'caller-bound-connection-id'
  await assert.rejects(() => connect(COOKIE, { ...opts({ loginUserId: 'uid2' }), key: KEY, store, expectedConnectionId }), e => e.code === 'mismatch')
  await assert.rejects(() => connect(COOKIE, { ...opts(), key: crypto.randomBytes(5), store, expectedConnectionId }), /32/)
  assert.equal(store.size, 0)
})

test('connect rejects missing or non-string caller ID before spending a pairing code', async () => {
  for (const expectedConnectionId of [undefined, null, 7, {}, '']) {
    await assert.rejects(() => connect(COOKIE, { ...opts(), key: KEY, store: new Map(), expectedConnectionId }), /connection id/i)
  }
  assert.deepEqual(routes(), [])
})

test('connect checks the key before it spends a pairing code', async () => {
  await assert.rejects(() => connect(COOKIE, { ...opts(), key: undefined, store: new Map(), expectedConnectionId: 'caller-bound-connection-id' }), /32/)
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

test('connect.html is static: no account data, no templating, never handles pairing or bearer', () => {
  assert.ok(!/\{\{|<%|\$\{user|__USER__|__DATA__/.test(pageSrc))
  assert.ok(!/bearer|pair|token/i.test(pageSrc), 'page must not know about pairing codes or bearers')
  assert.match(pageSrc, /\/api\/login\/options/)
  assert.match(pageSrc, /\/api\/login\/verify/)
  assert.ok(!/<script[^>]+src=/i.test(pageSrc), 'no external scripts')
  assert.match(pageSrc, /Content-Security-Policy/)
  assert.ok(!/connectionId/i.test(pageSrc))
  assert.match(pageSrc, /say\('Connected\.'\)/)
  assert.match(pageSrc, /say\('Could not connect\.'\)/)
  assert.ok(!/say\([^)]*connectionId/.test(pageSrc))
})

test('served connector HTML contains neither a connection ID nor dynamic account values', async () => {
  const server = createServer({ origin: 'https://gym.areum.cl', prefix: '/connector' })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/connector/connect`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/html/)
    const html = await res.text()
    assert.ok(!html.includes('connectionId'), 'the page never reads or displays a connection ID')
    assert.ok(!html.includes('caller-bound-connection-id'))
    assert.ok(!html.includes(BEARER))
    assert.ok(!html.includes(CODE))
    assert.ok(!html.includes('uid1'))
    assert.ok(!html.includes('Ana'))
  } finally { await new Promise(r => server.close(r)) }
})

test('connect.html uses the same passkey conversion as frontend/src/lib/api.js', () => {
  const api = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/api.js', import.meta.url)), 'utf8')
  for (const fn of ['bufToB64u', 'b64uToBuf', 'toRequestOptions', 'credToJSON']) {
    assert.ok(pageSrc.includes(fn), `page defines ${fn}`)
  }
  // the exact assertion fields the API reads
  for (const f of ['authenticatorData', 'signature', 'userHandle', 'clientDataJSON', 'clientExtensionResults', 'authenticatorAttachment']) {
    assert.ok(api.includes(f) && pageSrc.includes(f), f)
  }
})

test('connect.html inline script parses and never follows a redirect', () => {
  const m = pageSrc.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(m, 'one inline script')
  assert.doesNotThrow(() => new vm.Script(m[1]))
  assert.ok(!/location\.(assign|href|replace)/.test(m[1]), 'page never navigates')
  assert.match(m[1], /redirect:\s*'error'/)
})

test('a stalled openGym fails closed instead of hanging', async () => {
  script = { 'POST /api/pair/create': () => {} } // never answers
  await assert.rejects(() => establishSession(COOKIE, opts({ timeoutMs: 50 })), e => e.code === 'upstream')
})
