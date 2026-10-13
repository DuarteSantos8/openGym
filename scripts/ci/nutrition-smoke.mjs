// Run only against a throwaway stack with PASSWORD_LOGIN=1: creates a test account.
// Verifies nginx -> Node -> ASP.NET -> Node /api/me using the real auth implementation.
import assert from 'node:assert/strict'

const base = process.argv[2] || 'http://localhost:8080'
const name = 'Nutrition CI'
const call = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(15000) })
if (process.argv.includes('--verify-persistence')) {
  const login = await call('/api/login/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name, password: 'River stone garden 734!' }) })
  assert.equal(login.status, 200)
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] }
  const products = await call('/api/nutrition/products?search=CI%20persistence', { headers })
  assert.equal(products.status, 200)
  assert.equal((await products.json()).products[0]?.name, 'CI persistence')
  const diary = await call('/api/nutrition/diary?date=2026-10-15', { headers })
  assert.equal(diary.status, 200)
  const day = await diary.json()
  assert.equal(day.entries.length, 1)
  assert.deepEqual(day.totals, { calories: 84, protein: 2, fat: 4, carbohydrates: 6 })
  console.log('Nutrition persistent storage survived process/container recreation and repeated migrations.')
  process.exit(0)
}
for (const headers of [{}, { 'X-User-Name': 'Mallory' }, { Authorization: 'Bearer forged' }]) {
  assert.equal((await call('/api/nutrition/hello', { headers })).status, 401)
}
const signup = await call('/api/register/password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ name, password: 'River stone garden 734!' })
})
assert.equal(signup.status, 200, 'Test signup needs PASSWORD_LOGIN=1 and ORIGIN matching this URL')
const cookie = signup.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie, 'Signup must issue an existing openGym session cookie')
const token = cookie.slice(cookie.indexOf('=') + 1)
for (const headers of [{ Cookie: cookie }, { Authorization: `Bearer ${token}` }]) {
  const answer = await call('/api/nutrition/hello?name=Mallory', { headers: { ...headers, 'X-User-Name': 'Mallory' } })
  assert.equal(answer.status, 200)
  assert.deepEqual(await answer.json(), { message: `Hi, ${name}!` })
  assert.equal(answer.headers.get('cache-control'), 'no-store')
}
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const request = async (path, method = 'GET', body, status = 200) => {
  const response = await call('/api/nutrition' + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
  assert.equal(response.status, status, `${method} ${path}`)
  return response.json()
}
const product = await request('/products', 'POST', { name: 'CI buckwheat', brand: 'Test', calories: 123.456, protein: 12.345, fat: 6.789, carbohydrates: 45.678 }, 201)
assert.equal((await request('/products?search=buckwheat&userId=admin')).products[0].id, product.id)
const payload = { id: crypto.randomUUID(), productId: product.id, quantityGrams: 33.333, date: '2026-10-13', time: '12:15' }
const entry = await request('/entries', 'POST', payload, 201)
assert.equal(entry.nutrition.calories, 41.15158848)
assert.deepEqual(await request('/entries', 'POST', payload), entry)
await request('/products/' + product.id, 'PUT', { name: 'Changed', calories: 500, protein: 1, fat: 2, carbohydrates: 3 })
assert.equal((await request('/diary?date=2026-10-13')).totals.calories, 41.15158848)
await request('/products/' + product.id, 'DELETE')
assert.equal((await request('/entries/' + entry.id, 'PUT', { quantityGrams: 100, date: '2026-10-14', time: null })).nutrition.calories, 123.456)
assert.equal((await request('/diary?date=2026-10-13')).entries.length, 0)
await request('/entries/' + entry.id, 'DELETE')
await request('/entries', 'POST', payload, 410)
assert.deepEqual((await request('/diary?date=2026-10-14')).totals, { calories: 0, protein: 0, fat: 0, carbohydrates: 0 })
const persisted = await request('/products', 'POST', { name: 'CI persistence', calories: 42, protein: 1, fat: 2, carbohydrates: 3 }, 201)
await request('/entries', 'POST', { id: crypto.randomUUID(), productId: persisted.id, quantityGrams: 200, date: '2026-10-15', time: null }, 201)
const logout = await call('/api/logout/all', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
assert.equal(logout.status, 200)
assert.equal((await call('/api/nutrition/hello', { headers: { Authorization: `Bearer ${token}` } })).status, 401)
assert.equal((await call('/api/health')).status, 200)
console.log('Nutrition smoke passed: cookie/bearer auth, product/diary CRUD, decimal totals, immutable snapshots, retry/deletion safety, session revocation, existing API health.')
