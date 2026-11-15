// node --test cloudflare/worker.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failover, homelabUp } from './worker.js'

const env = { CF_API_TOKEN: 't', ZONE_ID: 'z' }
// health: list of statuses (or 'throw'/'fallback') returned by the homelab checks in order
function rig(health, routes = []) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const m = init.method || 'GET'
    if (url.includes('api.cloudflare.com')) {
      calls.push(m)
      if (m === 'GET') return Response.json({ success: true, result: routes })
      if (m === 'POST') { const r = { id: 'r1', ...JSON.parse(init.body) }; routes.push(r); return Response.json({ success: true, result: r }) }
      if (m === 'DELETE') { routes.splice(0); return Response.json({ success: true, result: {} }) }
    }
    const h = health.shift()
    if (h === 'throw') throw new Error('timeout')
    if (h === 'fallback') return new Response(null, { status: 200, headers: { 'x-served-by': 'cloudflare-fallback' } })
    return new Response(null, { status: h })
  }
  return { fetch, calls, routes, sleep: async () => {}, gap: 0 }
}

test('homelab up: no route is ever added', async () => {
  const d = rig([200, 200, 200, 200])
  assert.equal(await failover(env, d), 'homelab')
  assert.deepEqual(d.calls, ['GET'])
})
test('one blip does not switch', async () => {
  const d = rig([200, 530, 200, 'throw'])
  assert.equal(await failover(env, d), 'homelab')
  assert.deepEqual(d.calls, ['GET'])
})
test('two failures in a row add the route', async () => {
  const d = rig([200, 530, 'throw', 530])
  assert.equal(await failover(env, d), 'fallback')
  assert.deepEqual(d.calls, ['GET', 'POST'])
  assert.equal(d.routes[0].pattern, 'opengym.ch/*')
  assert.equal(d.routes[0].script, 'opengym')
})
test('while in fallback, the copy answering counts as down', async () => {
  const d = rig(['fallback', 'fallback', 'fallback', 'fallback'], [{ id: 'r1', pattern: 'opengym.ch/*' }])
  assert.equal(await failover(env, d), 'fallback')
  assert.deepEqual(d.calls, ['GET'])
})
test('two good checks remove the route again', async () => {
  const d = rig(['fallback', 200, 200, 200], [{ id: 'r1', pattern: 'opengym.ch/*' }])
  assert.equal(await failover(env, d), 'homelab')
  assert.deepEqual(d.calls, ['GET', 'DELETE'])
})
test('without the token it does nothing', async () => {
  const d = rig([530, 530])
  assert.equal(await failover({}, d), 'unconfigured')
  assert.deepEqual(d.calls, [])
})
test('a redirect means up, a 404 on the homepage (Traefik without the container) means down', async () => {
  assert.equal(await homelabUp('https://x', async () => new Response(null, { status: 404 })), false)
  assert.equal(await homelabUp('https://x', async () => new Response(null, { status: 301 })), true)
  assert.equal(await homelabUp('https://x', async () => new Response(null, { status: 502 })), false)
})
