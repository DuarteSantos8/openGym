// Disposable CI/native stack only. This creates accounts/products and must never target production.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

const base = process.argv[2] || 'http://localhost:8080'
const target = new URL(base)
assert.ok(process.argv.includes('--disposable') && target.protocol === 'http:' &&
  ['localhost', '127.0.0.1'].includes(target.hostname), 'Explicit --disposable and a loopback HTTP stack are required')
const call = (path, options = {}) => fetch(base + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) })
const name = 'MCP CI ' + crypto.randomUUID().slice(0, 8)
const signup = await call('/api/register/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ name, password: 'MCP River stone garden 734!' }) })
assert.equal(signup.status, 200)
const cookie = signup.headers.getSetCookie()[0].split(';')[0]
const jar = new Map([cookie.split('=')])
const browser = async (path, options = {}) => {
  const response = await call(path, { ...options, headers: { ...options.headers, Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } })
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(';')[0]; const split = pair.indexOf('=')
    jar.set(pair.slice(0, split), pair.slice(split + 1))
  }
  return response
}
const verifier = crypto.randomBytes(32).toString('base64url')
const resource = (await (await call('/.well-known/oauth-protected-resource')).json()).resource
const metadata = await (await call('/.well-known/oauth-authorization-server')).json()
let response = await browser(new URL(metadata.authorization_endpoint).pathname + '?' + new URLSearchParams({
  client_id: 'mcp-ci', redirect_uri: 'https://client.example/callback', response_type: 'code', resource,
  scope: 'training.read nutrition.read nutrition.write offline_access', prompt: 'consent', state: 'ci-state',
  code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'
}))
let code
for (let step = 0; step < 12; step++) {
  const location = response.headers.get('location')
  if (location?.startsWith('https://client.example/callback')) {
    const callback = new URL(location)
    assert.equal(callback.searchParams.get('error'), null)
    assert.equal(callback.searchParams.get('state'), 'ci-state')
    code = callback.searchParams.get('code'); break
  }
  if (location) {
    const next = new URL(location, base)
    assert.equal(next.origin, target.origin)
    response = await browser(next.pathname + next.search); continue
  }
  const html = await response.text()
  assert.equal(response.status, 200)
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1]
  assert.ok(csrf)
  response = await browser(new URL(response.url).pathname, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: new URLSearchParams({ csrf, decision: 'allow' }) })
}
assert.ok(code)
const exchange = await call(new URL(metadata.token_endpoint).pathname, { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
    client_id: 'mcp-ci', grant_type: 'authorization_code', code, code_verifier: verifier,
    redirect_uri: 'https://client.example/callback', resource
  }) })
assert.equal(exchange.status, 200)
const { access_token: token } = await exchange.json()
const rpc = async (method, params, expected = 200) => {
  const result = await call('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  assert.equal(result.status, expected)
  const text = await result.text()
  return JSON.parse(result.headers.get('content-type')?.startsWith('text/event-stream') ? /^data: (.+)$/m.exec(text)[1] : text)
}
const tool = async (name, args, error) => {
  const envelope = await rpc('tools/call', { name, arguments: args })
  assert.equal(envelope.result.isError || false, !!error, JSON.stringify(envelope))
  if (error) assert.equal(envelope.result.structuredContent.code, error)
  return envelope.result.structuredContent
}
assert.equal((await rpc('tools/list', {})).result.tools.length, 16)
const productResponse = await call('/api/nutrition/products', { method: 'POST', headers: {
  Cookie: cookie, Origin: base, 'Content-Type': 'application/json'
}, body: JSON.stringify({ name: 'MCP buckwheat', calories: 300, protein: 10, fat: 2, carbohydrates: 60 }) })
assert.equal(productResponse.status, 201)
const product = await productResponse.json()
assert.equal((await tool('nutrition_search_products', { search: 'buckwheat' })).products[0].id, product.id)
const entry = { entry_id: crypto.randomUUID(), product_id: product.id, quantity_grams: 200, date: '2026-10-13', time: '12:00' }
const saved = await tool('nutrition_create_entry', entry)
assert.equal(saved.nutrition.calories, 600)
assert.deepEqual(await tool('nutrition_create_entry', entry), saved)
await tool('nutrition_create_entry', { ...entry, quantity_grams: 300 }, 'idempotency_conflict')
const diary = await tool('nutrition_get_diary', { date: entry.date })
assert.equal(diary.entries.length, 1)
assert.equal(diary.totals.calories, 600)
const changed = await tool('nutrition_update_entry', { entry_id: entry.entry_id, quantity_grams: 100, date: entry.date })
assert.equal(changed.nutrition.calories, 300)
await tool('nutrition_delete_entry', { entry_id: entry.entry_id, confirmed: true })
await tool('nutrition_create_entry', entry, 'entry_deleted')
assert.equal((await tool('nutrition_get_diary', { date: entry.date })).entries.length, 0)
await call('/api/logout/all', { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{}' })
await rpc('tools/list', {}, 401)
console.log('MCP OAuth + real Nutrition API: discovery, consent, scoped writes, retry/conflict/delete and revocation passed.')
