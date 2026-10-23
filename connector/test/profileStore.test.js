import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createProfileStore, ProfileConflictError } from '../src/profileStore.js'

const copy = value => structuredClone(value)
const valid = { routines: [{ id: 'old', name: 'Original' }], workouts: [], _wid: 'wid-1' }

async function fixture(handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      const route = `${req.method} ${req.url}`
      const body = Buffer.concat(chunks).toString('utf8')
      seen.push({ route, body: body ? JSON.parse(body) : null, headers: req.headers })
      try {
        const answer = await handler(route, seen.at(-1), seen)
        if (!answer) return
        res.writeHead(answer[0], { 'content-type': 'application/json' })
        res.end(JSON.stringify(answer[1]))
      } catch (error) {
        res.writeHead(500)
        res.end(String(error))
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const store = createProfileStore({ apiBase: `http://127.0.0.1:${server.address().port}` })
  return { store, seen, close: () => new Promise(resolve => server.close(resolve)) }
}

const append = state => ({ ...state, routines: [...state.routines, { id: 'new', name: 'Added' }] })

test('409 reapplies narrow patch to fresh state; keeps untouched routine and second writer workout', async t => {
  const initial = copy(valid)
  const concurrent = { ...copy(valid), workouts: [{ id: 'session-2' }], routines: [{ id: 'old', name: 'Other writer' }], _wid: 'wid-2' }
  let puts = 0
  const api = await fixture((route, { body }) => {
    if (route === 'GET /api/data') return [200, { state: puts ? { ...copy(concurrent), routines: [...concurrent.routines, { id: 'new', name: 'Added' }], _wid: 'wid-3' } : initial, rev: puts ? 9 : 7 }]
    if (route === 'PUT /api/data') return ++puts === 1
      ? [409, { error: 'conflict', rev: 8, state: concurrent }]
      : [200, { ok: true, rev: 9, wid: 'wid-3' }]
    if (route === 'GET /api/data/rev') return [200, { rev: 9, wid: 'wid-3' }]
    return [404, {}]
  })
  t.after(api.close)
  const result = await api.store.updateProfile('secret', append)
  assert.deepEqual(result.routines, [{ id: 'old', name: 'Other writer' }, { id: 'new', name: 'Added' }])
  assert.deepEqual(result.workouts, [{ id: 'session-2' }])
  assert.deepEqual(api.seen.filter(x => x.route === 'PUT /api/data').map(x => ({ baseRev: x.body.baseRev, baseWid: x.body.baseWid, state: x.body.state })), [
    { baseRev: 7, baseWid: 'wid-1', state: { ...initial, routines: [...initial.routines, { id: 'new', name: 'Added' }] } },
    { baseRev: 8, baseWid: 'wid-2', state: { ...concurrent, routines: [...concurrent.routines, { id: 'new', name: 'Added' }] } },
  ])
  assert.equal(api.seen.every(x => x.headers.authorization === 'Bearer secret' && !x.headers.cookie), true)
  assert.equal(api.seen.some(x => x.body && 'stamped' in x.body), false)
  assert.equal(api.seen.some(x => x.route === 'GET /api/data/rev'), true)
})

test('after 200 checks disk revision and returns server-restored document, not the PUT response revision', async t => {
  let reads = 0
  const latest = { ...copy(valid), routines: [...valid.routines, { id: 'new', name: 'Added' }], workouts: [{ id: 'recovered' }], _wid: 'server-wid' }
  const api = await fixture(route => {
    if (route === 'GET /api/data') return ++reads === 1 ? [200, { state: valid, rev: 11 }] : [200, { state: latest, rev: 13 }]
    if (route === 'PUT /api/data') return [200, { ok: true, rev: 12, wid: 'response-wid' }]
    if (route === 'GET /api/data/rev') return [200, { rev: 13, wid: 'server-wid' }]
    return [404, {}]
  })
  t.after(api.close)
  assert.deepEqual(await api.store.updateProfile('secret', append), latest)
  assert.equal(reads, 2)
  assert.deepEqual(api.seen.map(x => x.route), ['GET /api/data', 'PUT /api/data', 'GET /api/data/rev', 'GET /api/data'])
})

test('next update reads authoritative revision, never caches response rev', async t => {
  let rev = 3
  let wid = 'start'
  const bases = []
  const api = await fixture((route, { body }) => {
    if (route === 'GET /api/data') return [200, { rev, state: { routines: [{ id: 'old' }], workouts: [], _wid: wid } }]
    if (route === 'PUT /api/data') { bases.push(body.baseRev); rev += 2; wid = `wid-${rev}`; return [200, { rev: rev - 1, wid }] }
    if (route === 'GET /api/data/rev') return [200, { rev, wid }]
    return [404, {}]
  })
  t.after(api.close)
  await api.store.updateProfile('secret', state => ({ ...state, name: 'A' }))
  await api.store.updateProfile('secret', state => ({ ...state, name: 'B' }))
  assert.deepEqual(bases, [3, 5])
})

test('rejects missing, array, metadata-only or non-object state before any PUT', async t => {
  for (const state of [null, [], 'bad', {}, { _rev: 1, _ts: 10 }, { _wid: 'only-metadata' }]) {
    const api = await fixture(route => route === 'GET /api/data' ? [200, { state, rev: 0 }] : [500, {}])
    t.after(api.close)
    await assert.rejects(() => api.store.updateProfile('secret', append), /invalid profile/i)
    assert.deepEqual(api.seen.map(x => x.route), ['GET /api/data'])
  }
})

test('rejects invalid patch result without writing, leaves original unchanged', async t => {
  const api = await fixture(route => route === 'GET /api/data' ? [200, { state: valid, rev: 4 }] : [500, {}])
  t.after(api.close)
  await assert.rejects(() => api.store.updateProfile('secret', () => []), /invalid profile/i)
  assert.deepEqual(api.seen.map(x => x.route), ['GET /api/data'])
  assert.deepEqual(valid.routines, [{ id: 'old', name: 'Original' }])
})

test('persistent conflict stops at five attempts; exposes latest state without a sixth PUT', async t => {
  let n = 0
  const api = await fixture(route => {
    if (route === 'GET /api/data') return [200, { state: valid, rev: 0 }]
    if (route === 'PUT /api/data') return [409, { error: 'conflict', rev: ++n, state: { ...copy(valid), _wid: `wid-${n}`, workouts: [{ id: `other-${n}` }] } }]
    return [500, {}]
  })
  t.after(api.close)
  await assert.rejects(() => api.store.updateProfile('secret', append), e => {
    assert.ok(e instanceof ProfileConflictError)
    assert.equal(e.profile.workouts[0].id, 'other-5')
    return true
  })
  assert.equal(n, 5)
  assert.deepEqual(api.seen.filter(x => x.route === 'PUT /api/data').map(x => x.body.baseRev), [0, 1, 2, 3, 4])
})

test('same-bearer writes serialize; other bearer proceeds while first is paused', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let first = true
  const api = await fixture(async (route, { headers }) => {
    if (route === 'GET /api/data') {
      if (headers.authorization === 'Bearer A' && first) { first = false; await gate }
      return [200, { rev: 1, state: valid }]
    }
    if (route === 'PUT /api/data') return [200, { rev: 2, wid: 'next' }]
    if (route === 'GET /api/data/rev') return [200, { rev: 2, wid: 'next' }]
    return [404, {}]
  })
  t.after(() => { release(); return api.close() })
  const a1 = api.store.updateProfile('A', state => ({ ...state, name: 'first' }))
  const a2 = api.store.updateProfile('A', state => ({ ...state, name: 'second' }))
  const b = api.store.updateProfile('B', state => ({ ...state, name: 'other' }))
  await b
  assert.equal(api.seen.filter(x => x.route === 'GET /api/data' && x.headers.authorization === 'Bearer A').length, 1)
  release()
  await Promise.all([a1, a2])
  assert.deepEqual(api.seen.filter(x => x.route === 'PUT /api/data' && x.headers.authorization === 'Bearer A').map(x => x.body.state.name), ['first', 'second'])
})

test('readProfile returns state; refuses redirects, oversized bodies and unexpected status', async t => {
  let answer = [200, { rev: 0, state: valid }]
  const api = await fixture(() => answer)
  t.after(api.close)
  assert.deepEqual(await api.store.readProfile('secret'), valid)
  answer = [302, { error: 'redirect' }]
  await assert.rejects(() => api.store.readProfile('secret'), /upstream/i)
  answer = [200, { padding: 'x'.repeat(5 * 1024 * 1024 + 1) }]
  await assert.rejects(() => api.store.readProfile('secret'), /upstream/i)
  answer = [401, { error: 'unauthorized' }]
  await assert.rejects(() => api.store.readProfile('secret'), /upstream/i)
})

test('profile store has no direct state file access', () => {
  const text = readFileSync(new URL('../src/profileStore.js', import.meta.url), 'utf8')
  assert.doesNotMatch(text, /(?:node:fs|stateFile|readStateStrict|atomicWrite|state-\$\{)/)
})
