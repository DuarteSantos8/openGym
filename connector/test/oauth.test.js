import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.js'

const origin = 'https://gym.areum.cl'
const prefix = '/connector'
const issuer = `${origin}${prefix}`
const mcpUrl = `${issuer}/mcp`
const prmUrl = `${issuer}/.well-known/oauth-protected-resource`

let server, base
before(async () => {
  server = createServer({ origin, prefix })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => new Promise(r => server.close(r)))

const json = async p => (await fetch(base + p)).json()

test('unauthenticated POST /connector/mcp -> 401 with resource_metadata challenge', async () => {
  const res = await fetch(`${base}${prefix}/mcp`, { method: 'POST', body: '{}' })
  assert.equal(res.status, 401)
  const h = res.headers.get('www-authenticate')
  assert.match(h, /^Bearer /)
  assert.ok(h.includes(`resource_metadata="${prmUrl}"`), h)
})

test('a bearer token is not accepted yet (stub fails closed)', async () => {
  const res = await fetch(`${base}${prefix}/mcp`, { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}' })
  assert.equal(res.status, 401)
})

test('protected-resource metadata names the exact MCP URL', async () => {
  const res = await fetch(`${base}${prefix}/.well-known/oauth-protected-resource`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^application\/json/)
  const doc = await res.json()
  assert.equal(doc.resource, mcpUrl)
  assert.deepEqual(doc.authorization_servers, [issuer])
  assert.deepEqual(doc.bearer_methods_supported, ['header'])
})

test('authorization-server metadata at the RFC 8414 path-inserted URL', async () => {
  const res = await fetch(`${base}/.well-known/oauth-authorization-server${prefix}`)
  assert.equal(res.status, 200)
  const doc = await res.json()
  assert.equal(doc.issuer, issuer)
  assert.equal(doc.authorization_endpoint, `${issuer}/authorize`)
  assert.equal(doc.token_endpoint, `${issuer}/token`)
  assert.equal(doc.registration_endpoint, `${issuer}/register`)
  assert.deepEqual(doc.response_types_supported, ['code'])
  assert.deepEqual(doc.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(doc.grant_types_supported, ['authorization_code', 'refresh_token'])
  assert.deepEqual(doc.token_endpoint_auth_methods_supported, ['none'])
  assert.equal(doc.refresh_token_rotation, true)
})

test('unknown paths 404', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404)
  assert.equal((await fetch(`${base}${prefix}/mcp/extra`, { method: 'POST' })).status, 404)
})

test('discovery documents follow origin/prefix inputs', async () => {
  const s = createServer({ origin: 'https://example.test', prefix: '/c' })
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  try {
    const b = `http://127.0.0.1:${s.address().port}`
    const prm = await (await fetch(`${b}/c/.well-known/oauth-protected-resource`)).json()
    assert.equal(prm.resource, 'https://example.test/c/mcp')
    const as = await (await fetch(`${b}/.well-known/oauth-authorization-server/c`)).json()
    assert.equal(as.issuer, 'https://example.test/c')
  } finally { await new Promise(r => s.close(r)) }
})
