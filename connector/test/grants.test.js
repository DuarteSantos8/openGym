import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { createGrants } from '../src/grants.js'
import { createServer } from '../src/server.js'
import { sealBearer } from '../src/openGymSession.js'

const origin = 'https://gym.areum.cl'
const prefix = '/connector'
const callback = 'https://claude.ai/api/mcp/auth_callback'
const bearer = 'private-openGym-session'
const key = crypto.randomBytes(32)
const verifier = 'a'.repeat(43)
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
const assertion = { cid: 'cid-1', credential: { id: 'cred', response: {} } }

function fixture({ apiBase = 'http://unused', maxClients } = {}) {
  const connections = new Map()
  const stores = { codes: new Map(), access: new Map(), refreshTokens: new Map() }
  let time = Date.now(), n = 0
  const grants = createGrants({ connections, key, apiBase, now: () => time, maxClients, ...stores })
  const client = grants.registerClient({ redirect_uris: [callback, 'http://127.0.0.1:9876/callback'] })
  // each call is a fresh, already-connected openGym user session (what connect() would have stored)
  const connect = (userId = 'uid1') => { const id = `connection-${++n}`; connections.set(id, { userId, sealed: sealBearer(bearer, key, userId) }); return id }
  const code = (connectionId = connect()) => grants.issueAuthorizationCode({ connectionId, clientId: client.client_id, redirectUri: callback, codeChallenge: challenge })
  const exchange = authorizationCode => grants.exchangeCode({ code: authorizationCode, clientId: client.client_id, redirectUri: callback, codeVerifier: verifier })
  return { grants, connections, stores, client, connect, code, exchange, advance: ms => { time += ms } }
}

test('registration allowlists exact Claude callback and loopback redirects only', () => {
  const { grants } = fixture()
  for (const url of [
    'https://claude.ai/api/mcp/auth_callback/extra', 'https://claude.ai.evil.test/api/mcp/auth_callback', 'https://claude.ai/other',
    'http://example.test/cb', 'http://127.0.0.1.evil.test:123/cb', 'http://localhost:0/cb', 'http://localhost:123/cb#fragment',
    'http://localhost:123/cb?x=1', 'http://localhost/cb', 'http://user@localhost:123/cb', 'http://localhost:3000/auth',
    'http://[::1]:5000/cb', 'http://127.0.0.1:9876/other', 'http://127.0.0.1:9876/callback/..', 'http://127.0.0.1:9876/call%2Fback',
    'http://127.0.0.1:9876\\callback', 'http://127.0.0.1:9876/callback%2e%2e',
  ]) {
    assert.throws(() => grants.registerClient({ redirect_uris: [url] }), /invalid_client_metadata/, url)
  }
  for (const url of ['http://localhost:3000/callback', 'http://[::1]:5000/callback', 'http://127.0.0.1:9876/callback']) {
    assert.equal(grants.registerClient({ redirect_uris: [url] }).redirect_uris[0], url)
  }
  assert.throws(() => grants.registerClient({ redirect_uris: [callback], token_endpoint_auth_method: 'client_secret_post' }), /invalid_client_metadata/)
  assert.throws(() => grants.registerClient({ redirect_uris: [callback, 'https://evil.test/cb'] }), /invalid_client_metadata/)
})

test('PKCE S256 and exact registered redirect are mandatory', () => {
  const { grants, client, connect, code, exchange } = fixture()
  const base = { connectionId: connect(), clientId: client.client_id, redirectUri: callback, codeChallenge: challenge }
  assert.throws(() => grants.issueAuthorizationCode({ ...base, codeChallengeMethod: 'plain' }), /invalid_request/)
  assert.throws(() => grants.issueAuthorizationCode({ ...base, codeChallenge: undefined }), /invalid_request/, 'PKCE is mandatory')
  assert.throws(() => grants.issueAuthorizationCode({ ...base, codeChallenge: 'weak' }), /invalid_request/)
  assert.throws(() => grants.issueAuthorizationCode({ ...base, redirectUri: 'https://evil.test' }), /invalid_request/)
  assert.throws(() => grants.issueAuthorizationCode({ ...base, clientId: 'unregistered' }), /invalid_request/)
  const issued = code()
  assert.throws(() => grants.exchangeCode({ code: code(), clientId: client.client_id, redirectUri: callback, codeVerifier: 'b'.repeat(43) }), /invalid_grant/, 'wrong verifier')
  assert.throws(() => grants.exchangeCode({ code: code(), clientId: client.client_id, redirectUri: callback }), /invalid_grant/, 'no verifier')
  assert.throws(() => grants.exchangeCode({ code: code(), clientId: 'other', redirectUri: callback, codeVerifier: verifier }), /invalid_grant/, 'wrong client')
  assert.throws(() => grants.exchangeCode({ code: issued, clientId: client.client_id, redirectUri: 'http://127.0.0.1:9876/callback', codeVerifier: verifier }), /invalid_grant/)
  assert.throws(() => exchange(issued), /invalid_grant/, 'failed exchange burns code')
  assert.throws(() => grants.issueAuthorizationCode({ ...base, connectionId: 'not-connected' }), /invalid_grant/)
  assert.throws(() => grants.issueAuthorizationCode({ ...base, connectionId: '__proto__' }), /invalid_grant/)
})

test('a connection backs one code only, and the code expires after one minute', () => {
  const { grants, client, connect, code, exchange, advance } = fixture()
  const id = connect()
  const first = code(id)
  assert.throws(() => code(id), /invalid_grant/)
  const tokens = exchange(first)
  assert.ok(tokens.access_token, 'duplicate issue must not delete the connection the first code needs')
  const late = code()
  advance(60_000)
  assert.throws(() => exchange(late), /invalid_grant/)
  assert.equal(grants.registerClient({ redirect_uris: [callback] }).client_id.length, 43)
  assert.ok(client)
})

test('codes are single use; refresh rotates, replay revokes every token in the grant', async () => {
  const { grants, code, exchange, client } = fixture()
  const issued = code()
  assert.ok(issued.length >= 43)
  const tokens = exchange(issued)
  assert.ok(tokens.access_token.length >= 43 && tokens.refresh_token.length >= 43)
  assert.equal(JSON.stringify(tokens).includes(bearer), false)
  assert.throws(() => exchange(issued), /invalid_grant/)
  const rotated = await grants.refresh({ refreshToken: tokens.refresh_token, clientId: client.client_id })
  assert.notEqual(rotated.refresh_token, tokens.refresh_token)
  assert.notEqual(rotated.access_token, tokens.access_token)
  await assert.rejects(() => grants.refresh({ refreshToken: tokens.refresh_token, clientId: client.client_id }), /invalid_grant/)
  await assert.rejects(() => grants.refresh({ refreshToken: rotated.refresh_token, clientId: client.client_id }), /invalid_grant/)
  assert.equal(await grants.bearerForAccessToken(rotated.access_token), null)
})

test('a refresh token only works for its own client and is not spent by a wrong one', async () => {
  const { grants, code, exchange, client } = fixture()
  const t = exchange(code())
  await assert.rejects(() => grants.refresh({ refreshToken: t.refresh_token, clientId: 'other' }), /invalid_grant/)
  await assert.rejects(() => grants.refresh({ refreshToken: 'junk', clientId: client.client_id }), /invalid_grant/)
  await assert.rejects(() => grants.refresh({ refreshToken: undefined, clientId: client.client_id }), /invalid_grant/)
  assert.ok((await grants.refresh({ refreshToken: t.refresh_token, clientId: client.client_id })).access_token)
})

test('hashed secrets only; expiry and revocation fail closed and drop the sealed bearer', async () => {
  const f = fixture()
  const connectionId = f.connect()
  const t = f.exchange(f.code(connectionId))
  const dump = JSON.stringify([...f.stores.codes, ...f.stores.access, ...f.stores.refreshTokens])
  assert.ok(f.stores.access.size === 1 && f.stores.refreshTokens.size === 1)
  assert.ok(!dump.includes(t.access_token) && !dump.includes(t.refresh_token) && !dump.includes(bearer))
  await f.grants.revoke({ token: t.refresh_token, clientId: 'wrong' })
  assert.equal(f.stores.access.size, 1, 'another client cannot revoke this grant')
  await f.grants.revoke({ token: t.refresh_token, clientId: f.client.client_id })
  assert.equal(f.stores.access.size + f.stores.refreshTokens.size, 0)
  assert.equal(f.connections.has(connectionId), false, 'revoking discards the stored openGym bearer')
  assert.equal(await f.grants.bearerForAccessToken(t.access_token), null)
  await assert.rejects(() => f.grants.refresh({ refreshToken: t.refresh_token, clientId: f.client.client_id }), /invalid_grant/)
  await f.grants.revoke({ token: 'junk', clientId: f.client.client_id }) // unknown tokens: silent, like RFC 7009

  const t2 = f.exchange(f.code())
  assert.equal(t2.expires_in, 600)
  f.advance(11 * 60_000)
  assert.equal(await f.grants.bearerForAccessToken(t2.access_token), null, 'access token is short-lived')
  f.advance(31 * 86400_000)
  await assert.rejects(() => f.grants.refresh({ refreshToken: t2.refresh_token, clientId: f.client.client_id }), /invalid_grant/)
})

async function apiServer() {
  let status = 200, calls = []
  const api = http.createServer((req, res) => {
    calls.push({ path: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization })
    if (req.url === '/api/me') {
      res.writeHead(status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(status === 200 ? { user: { id: 'uid1' } } : { error: 'disabled' }))
    }
    if (req.url === '/api/login/verify') {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': '__Host-gymsid=fresh; Path=/; HttpOnly; Secure' })
      return res.end(JSON.stringify({ user: { id: 'uid1' } }))
    }
    if (req.url === '/api/pair/create') { res.writeHead(200); return res.end('{"code":"ABCD2345"}') }
    if (req.url === '/api/pair/redeem') { res.writeHead(200); return res.end(JSON.stringify({ user: { id: 'uid1' }, token: bearer })) }
    res.writeHead(404); res.end()
  })
  await new Promise(r => api.listen(0, '127.0.0.1', r))
  return { api, get status() { return status }, set status(s) { status = s }, calls, url: `http://127.0.0.1:${api.address().port}` }
}

test('bearer check uses only sealed record, checks user and permanently revokes on upstream failure', async () => {
  const upstream = await apiServer()
  try {
    const f = fixture({ apiBase: upstream.url })
    const t = f.exchange(f.code())
    assert.equal(await f.grants.bearerForAccessToken(t.access_token), bearer)
    assert.equal(upstream.calls[0].cookie, undefined)
    assert.equal(upstream.calls[0].authorization, `Bearer ${bearer}`)
    upstream.status = 401
    assert.equal(await f.grants.bearerForAccessToken(t.access_token), null)
    upstream.status = 200
    assert.equal(await f.grants.bearerForAccessToken(t.access_token), null)
    await assert.rejects(() => f.grants.refresh({ refreshToken: t.refresh_token, clientId: f.client.client_id }), /invalid_grant/)
  } finally { await new Promise(r => upstream.api.close(r)) }
})

test('OAuth HTTP flow uses server cookie, same-origin gate and stored openGym subject', async () => {
  const upstream = await apiServer()
  const server = createServer({ origin, prefix, apiBase: upstream.url, key })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data), redirect: 'manual' })
    const clientRes = await post('/connector/register', { redirect_uris: [callback] })
    assert.equal(clientRes.status, 201)
    const client = await clientRes.json()
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'opaque-state', resource: `${origin}${prefix}/mcp` })
    const authorize = await fetch(base + '/connector/authorize?' + params, { redirect: 'manual' })
    assert.equal(authorize.status, 303)
    assert.equal(authorize.headers.get('location'), '/connector/connect')
    const cookie = authorize.headers.get('set-cookie')
    assert.match(cookie, /__Host-gym-oauth=[A-Za-z0-9_-]{80,2048}; Path=\/; HttpOnly; Secure; SameSite=Lax/)
    assert.ok(!cookie.includes(bearer))
    const withCookie = { cookie: cookie.split(';')[0], origin, 'sec-fetch-site': 'same-origin' }
    const hostile = await post('/connector/connect', { ...assertion, pendingId: 'connected' }, { ...withCookie, 'sec-fetch-site': 'cross-site' })
    assert.equal(hostile.status, 403)
    const oversized = await fetch(base + '/connector/connect', { method: 'POST', headers: withCookie, body: 'x'.repeat(9000) })
    assert.equal(oversized.status, 413)
    const missing = await post('/connector/connect', { ...assertion, pendingId: 'connected' }, { origin })
    assert.equal(missing.status, 403)
    const done = await post('/connector/connect', { ...assertion, pendingId: 'forged', userId: 'attacker' }, { ...withCookie, cookie: withCookie.cookie + '; __Host-gymsid=ambient' })
    assert.equal(done.status, 200)
    const body = await done.json()
    const redirect = new URL(body.redirect)
    assert.equal(redirect.origin + redirect.pathname, callback)
    assert.equal(redirect.searchParams.get('state'), 'opaque-state')
    const code = redirect.searchParams.get('code')
    assert.ok(code && !JSON.stringify(body).includes(bearer))
    assert.equal(upstream.calls.some(c => c.cookie?.includes('ambient')), false)
    assert.equal((await post('/connector/connect', assertion, withCookie)).status, 403)
    const tokensRes = await post('/connector/token', { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback, code, code_verifier: verifier })
    assert.equal(tokensRes.status, 200)
    const tokens = await tokensRes.json()
    assert.ok(tokens.access_token && !JSON.stringify(tokens).includes(bearer))
    assert.equal((await post('/connector/token', { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback, code, code_verifier: verifier })).status, 400)
    const rev = await post('/connector/revoke', { client_id: client.client_id, token: tokens.refresh_token })
    assert.equal(rev.status, 200)
    assert.equal((await post('/connector/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token })).status, 400)
  } finally { await new Promise(r => server.close(r)); await new Promise(r => upstream.api.close(r)) }
})

test('authorize never redirects on a bad request and sets no cookie; a failed connect yields no code', async () => {
  const upstream = await apiServer()
  const server = createServer({ origin, prefix, apiBase: upstream.url, key })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data), redirect: 'manual' })
    const client = await (await post('/connector/register', { redirect_uris: [callback] })).json()
    const good = { client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: `${origin}${prefix}/mcp` }
    const bads = [
      { ...good, code_challenge_method: 'plain' }, { ...good, code_challenge_method: undefined }, { ...good, code_challenge: undefined },
      { ...good, redirect_uri: 'https://evil.test/cb' }, { ...good, client_id: 'nope' }, { ...good, response_type: 'token' },
      { ...good, resource: 'https://evil.test/mcp' }, { ...good, extra: '1' },
    ]
    for (const bad of bads) {
      const res = await fetch(`${base}/connector/authorize?${new URLSearchParams(Object.entries(bad).filter(([, v]) => v !== undefined))}`, { redirect: 'manual' })
      assert.equal(res.status, 400, JSON.stringify(bad))
      assert.equal(res.headers.get('location'), null)
      assert.equal(res.headers.get('set-cookie'), null)
    }
    const authorize = await fetch(`${base}/connector/authorize?${new URLSearchParams(good)}`, { redirect: 'manual' })
    const headers = { cookie: authorize.headers.get('set-cookie').split(';')[0], origin, 'sec-fetch-site': 'same-origin' }
    const res = await post('/connector/connect', { cid: 'cid-1' }, headers) // no credential
    assert.equal(res.status, 400)
    const text = await res.text()
    assert.ok(!/code=|redirect|ABCD2345|bearer|private-openGym/i.test(text), text)
    assert.equal((await post('/connector/connect', assertion, headers)).status, 200, 'a malformed body spends nothing')
    assert.equal((await post('/connector/connect', assertion, headers)).status, 403, 'a completed connect spends the pending record')
    assert.equal((await post('/connector/token', { grant_type: 'password', client_id: client.client_id })).status, 400)
    assert.equal((await fetch(`${base}/connector/token`, { method: 'POST', body: 'grant_type=refresh_token' })).status, 400, 'content-type is required')
  } finally { await new Promise(r => server.close(r)); await new Promise(r => upstream.api.close(r)) }
})

test('checkAuthorizeRequest pins an old client through the cookie lifetime; idle can be reclaimed after', () => {
  const { grants, client, advance } = fixture({ maxClients: 1 })
  advance(3_600_000 + 1)
  grants.checkAuthorizeRequest({ clientId: client.client_id, redirectUri: callback, codeChallenge: challenge, codeChallengeMethod: 'S256' })
  assert.throws(() => grants.registerClient({ redirect_uris: [callback] }), /temporarily_unavailable/)
  grants.checkAuthorizeRequest({ clientId: client.client_id, redirectUri: callback, codeChallenge: challenge, codeChallengeMethod: 'S256' })
  advance(5 * 60_000)
  const next = grants.registerClient({ redirect_uris: [callback] })
  assert.notEqual(next.client_id, client.client_id)
  assert.throws(() => grants.checkAuthorizeRequest({ clientId: client.client_id, redirectUri: callback, codeChallenge: challenge, codeChallengeMethod: 'S256' }), /invalid_client/)
})

test('hostile registration cannot delete a live client or its grant', async () => {
  const { grants, client, connect, code, exchange } = fixture({ maxClients: 1 })
  assert.throws(() => grants.registerClient({ redirect_uris: [callback] }), /temporarily_unavailable/)
  const t = exchange(code())
  assert.ok(t.access_token)
  assert.throws(() => grants.registerClient({ redirect_uris: [callback] }), /temporarily_unavailable/)
  const rotated = await grants.refresh({ refreshToken: t.refresh_token, clientId: client.client_id })
  assert.ok(rotated.access_token)
  const extra = grants.issueAuthorizationCode({ connectionId: connect(), clientId: client.client_id, redirectUri: callback, codeChallenge: challenge })
  assert.ok(extra.length >= 43)
})

test('oversized or unreadable /api/me identity permanently revokes; 5xx does not', async () => {
  let status = 200, body = JSON.stringify({ user: { id: 'uid1' } })
  const api = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  })
  await new Promise(r => api.listen(0, '127.0.0.1', r))
  try {
    const f = fixture({ apiBase: `http://127.0.0.1:${api.address().port}` })
    const t = f.exchange(f.code())
    assert.equal(await f.grants.bearerForAccessToken(t.access_token), bearer)
    body = JSON.stringify({ user: { id: 'uid1', pad: 'x'.repeat(9000) } })
    assert.equal(await f.grants.bearerForAccessToken(t.access_token), null)
    body = JSON.stringify({ user: { id: 'uid1' } })
    assert.equal(await f.grants.bearerForAccessToken(t.access_token), null, 'oversized 200 revokes')
    await assert.rejects(() => f.grants.refresh({ refreshToken: t.refresh_token, clientId: f.client.client_id }), /invalid_grant/)

    const t2 = f.exchange(f.code())
    body = '{"user":'
    assert.equal(await f.grants.bearerForAccessToken(t2.access_token), null)
    body = JSON.stringify({ user: { id: 'uid1' } })
    assert.equal(await f.grants.bearerForAccessToken(t2.access_token), null, 'unreadable 200 revokes')

    const t3 = f.exchange(f.code())
    status = 503
    body = 'down'
    assert.equal(await f.grants.bearerForAccessToken(t3.access_token), null)
    status = 200
    body = JSON.stringify({ user: { id: 'uid1' } })
    assert.equal(await f.grants.bearerForAccessToken(t3.access_token), bearer, '5xx is transient')
  } finally { await new Promise(r => api.close(r)) }
})

test('two concurrent POSTs with one pending cookie: one login, one fail, one grant', async () => {
  const upstream = await apiServer()
  const server = createServer({ origin, prefix, apiBase: upstream.url, key })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data), redirect: 'manual' })
    const client = await (await post('/connector/register', { redirect_uris: [callback] })).json()
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: `${origin}${prefix}/mcp` })
    const authorize = await fetch(base + '/connector/authorize?' + params, { redirect: 'manual' })
    const headers = { cookie: authorize.headers.get('set-cookie').split(';')[0], origin, 'sec-fetch-site': 'same-origin' }
    const [a, b] = await Promise.all([post('/connector/connect', assertion, headers), post('/connector/connect', assertion, headers)])
    const statuses = [a.status, b.status].sort()
    assert.deepEqual(statuses, [200, 403])
    const ok = a.status === 200 ? a : b
    const body = await ok.json()
    assert.ok(body.redirect)
    const logins = upstream.calls.filter(c => c.path === '/api/login/verify')
    assert.equal(logins.length, 1)
    const tokens = await (await post('/connector/token', { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback, code: new URL(body.redirect).searchParams.get('code'), code_verifier: verifier })).json()
    assert.ok(tokens.access_token)
  } finally { await new Promise(r => server.close(r)); await new Promise(r => upstream.api.close(r)) }
})

test('authorization request lives in the cookie, not a server pending map; a failed issue drops the connection', async () => {
  const upstream = await apiServer()
  const server = createServer({ origin, prefix, apiBase: upstream.url, key })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data), redirect: 'manual' })
    const client = await (await post('/connector/register', { redirect_uris: [callback] })).json()
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: `${origin}${prefix}/mcp` })
    const first = await fetch(base + '/connector/authorize?' + params, { redirect: 'manual' })
    const cookie1 = first.headers.get('set-cookie').split(';')[0]
    const second = await fetch(base + '/connector/authorize?' + params, { redirect: 'manual' })
    const cookie2 = second.headers.get('set-cookie').split(';')[0]
    assert.notEqual(cookie1, cookie2)
    const headers1 = { cookie: cookie1, origin, 'sec-fetch-site': 'same-origin' }
    const headers2 = { cookie: cookie2, origin, 'sec-fetch-site': 'same-origin' }
    const a = await post('/connector/connect', assertion, headers1)
    const b = await post('/connector/connect', assertion, headers2)
    assert.equal(a.status, 200)
    assert.equal(b.status, 200, 'second authorize does not evict the first cookie')
    const f = fixture()
    const id = f.connect()
    assert.equal(f.connections.has(id), true)
    assert.throws(() => f.grants.issueAuthorizationCode({ connectionId: id, clientId: 'unregistered', redirectUri: callback, codeChallenge: challenge }), /invalid_request/)
    assert.equal(f.connections.has(id), false, 'failed issue deletes the stored connection')
  } finally { await new Promise(r => server.close(r)); await new Promise(r => upstream.api.close(r)) }
})
