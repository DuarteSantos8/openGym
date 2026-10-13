// Sent to `docker exec -i api node --input-type=module` in the CI network.
// Nutrition is never published on a host port, even for the smoke check.
import assert from 'node:assert/strict'

const base = 'http://nutrition:8080'
let ready = false
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })
    if (r.ok) { ready = true; break }
  } catch { /* A newly started process has not bound yet. */ }
  await new Promise(resolve => setTimeout(resolve, 500))
}
assert.ok(ready, 'Nutrition did not start')
const spoof = await fetch(base + '/api/nutrition/hello?name=Mallory', {
  headers: { 'X-User-Name': 'Mallory', 'X-User-Id': 'admin' },
  signal: AbortSignal.timeout(5000)
})
assert.equal(spoof.status, 401, 'Nutrition must reject unverified client identity')
console.log('Internal Nutrition health and authentication passed.')
