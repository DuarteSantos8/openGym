// Run only against a throwaway stack with PASSWORD_LOGIN=1: creates a test account.
// Verifies nginx -> Node -> ASP.NET -> Node /api/me using the real auth implementation.
import assert from 'node:assert/strict'

const base = process.argv[2] || 'http://localhost:8080'
const name = 'Nutrition CI'
const call = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(15000) })
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
const logout = await call('/api/logout/all', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
assert.equal(logout.status, 200)
assert.equal((await call('/api/nutrition/hello', { headers: { Authorization: `Bearer ${token}` } })).status, 401)
assert.equal((await call('/api/health')).status, 200)
console.log('Nutrition smoke passed: cookie, bearer, identity spoofing, session revocation, existing API health.')
