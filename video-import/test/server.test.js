import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

process.env.VIDEO_IMPORT_TOKEN = 'sekret-token'
const { handle } = await import('../src/server.js')
const jobs = await import('../src/jobs.js')
jobs._setDeps({
  metadata: async () => ({ id: 'dQw4w9WgXcQ', channel_id: 'UC1', duration: 100 }),
  download: async () => { throw Object.assign(new Error('no network in tests'), { code: 'download' }) }
})

const server = http.createServer((req, res) => handle(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
after(() => { jobs._reset(); server.close() })

const call = (method, path, body, token = 'sekret-token') => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {})
}).then(async r => ({ status: r.status, body: await r.json() }))

test('without the token nothing but /health answers', async () => {
  assert.equal((await call('POST', '/jobs', { url: 'https://youtu.be/dQw4w9WgXcQ', owner: 'u1' }, null)).status, 401)
  assert.equal((await call('POST', '/jobs', { url: 'https://youtu.be/dQw4w9WgXcQ', owner: 'u1' }, 'wrong')).status, 401)
  const h = await call('GET', '/health', null, null)
  assert.ok(h.status === 200 || h.status === 503)
  assert.ok('tools' in h.body)
})

test('a job is created, read and cancelled over HTTP', async () => {
  const bad = await call('POST', '/jobs', { url: 'https://vimeo.com/1', owner: 'u1' })
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'bad-url')
  const made = await call('POST', '/jobs', { url: 'https://youtu.be/dQw4w9WgXcQ', owner: 'u1' })
  assert.equal(made.status, 202)
  assert.match(made.body.id, /^[0-9a-f]{24}$/)
  let got
  for (let i = 0; i < 100; i++) {
    got = await call('GET', '/jobs/' + made.body.id)
    if (got.body.status === 'error') break
    await new Promise(r => setTimeout(r, 10))
  }
  assert.equal(got.body.status, 'error')
  assert.equal(got.body.code, 'download')
  assert.equal((await call('DELETE', '/jobs/' + made.body.id)).body.status, 'error', 'cancelling a finished job changes nothing')
  assert.equal((await call('GET', '/jobs/' + 'f'.repeat(24))).status, 404)
  assert.equal((await call('POST', '/jobs/' + made.body.id + '/roi', { name: { x: 0, y: 0, w: 0.5, h: 0.5 } })).status, 409)
  assert.equal((await fetch(base + '/jobs', { method: 'POST', headers: { Authorization: 'Bearer sekret-token' }, body: '[1]' })).status, 400)
})
