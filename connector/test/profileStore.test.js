import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createProfileStore, ProfileConflictError } from '../src/profileStore.js'

const copy = value => structuredClone(value)
const valid = { routines: [{ id: 'old', name: 'Original' }], workouts: [], name: 'Ana', _wid: 'wid-1' }

function upsertRoutine(state, routine) {
  const routines = (Array.isArray(state.routines) ? state.routines : []).filter(entry => entry.id !== routine.id)
  return { ...state, routines: [...routines, routine] }
}
const addNew = state => upsertRoutine(state, { id: 'new', name: 'Added' })

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
        if (answer === 'drop') { req.socket.destroy(); return }
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
  const result = await api.store.updateProfile('secret', addNew)
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
  assert.deepEqual(await api.store.updateProfile('secret', addNew), latest)
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
    await assert.rejects(() => api.store.updateProfile('secret', addNew), /invalid profile/i)
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
  await assert.rejects(() => api.store.updateProfile('secret', addNew), e => {
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

test('ordinary path refuses dropped keys, truncated lists, and a fixed subset even if the patch is idempotent', async t => {
  const current = {
    routines: [{ id: 'keep' }, { id: 'also' }], workouts: [{ id: 'w1' }], name: 'Ana', unit: 'kg', _wid: 'wid-1',
  }
  for (const patch of [
    () => ({ name: 'x' }),
    () => ({ _f: {} }),
    state => ({ ...state, routines: [{ id: 'keep' }] }),
    state => ({ ...state, workouts: [] }),
    state => { const next = { ...state }; delete next.unit; return next },
    () => ({ name: 'x', routines: [{ id: 'keep' }], workouts: [{ id: 'w1' }] }),
  ]) {
    const api = await fixture(route => route === 'GET /api/data' ? [200, { state: current, rev: 2 }] : [500, {}])
    t.after(api.close)
    await assert.rejects(() => api.store.updateProfile('secret', patch), /invalid profile/i)
    assert.deepEqual(api.seen.map(x => x.route), ['GET /api/data'])
  }
})

test('409 retry also refuses a patch that would drop a concurrent writer key or id', async t => {
  const initial = { routines: [{ id: 'old' }], workouts: [], name: 'Ana', _wid: 'wid-1' }
  const concurrent = { routines: [{ id: 'old' }], workouts: [{ id: 'session-2' }], name: 'Ana', extra: 1, _wid: 'wid-2' }
  const subset = () => ({ name: 'Ana', routines: [{ id: 'old' }], workouts: [] })
  let puts = 0
  const api = await fixture(route => {
    if (route === 'GET /api/data') return [200, { state: initial, rev: 7 }]
    if (route === 'PUT /api/data') {
      puts++
      return [409, { error: 'conflict', rev: 8, state: concurrent }]
    }
    return [500, {}]
  })
  t.after(api.close)
  await assert.rejects(() => api.store.updateProfile('secret', subset), /invalid profile/i)
  assert.equal(puts, 1)
})

test('allowDelete still keeps unrelated ids unless they are the explicit target; caller must passkey-gate this option', async t => {
  const current = { routines: [{ id: 'keep' }, { id: 'gone' }], workouts: [{ id: 'w1' }], name: 'Ana', _wid: 'wid-1' }
  const latest = { routines: [{ id: 'keep' }], workouts: [{ id: 'w1' }], name: 'Ana', _wid: 'wid-2' }
  const api = await fixture(route => {
    if (route === 'GET /api/data') return [200, { state: current, rev: 4 }]
    if (route === 'PUT /api/data') return [200, { ok: true, rev: 5, wid: 'wid-2' }]
    if (route === 'GET /api/data/rev') return [200, { rev: 5, wid: 'wid-2' }]
    return [404, {}]
  })
  t.after(api.close)
  await api.store.updateProfile('secret', state => ({
    ...state, routines: state.routines.filter(entry => entry.id !== 'gone'),
  }), { allowDelete: true, ids: ['gone'] })
  assert.deepEqual(api.seen.find(x => x.route === 'PUT /api/data').body.state.routines, [{ id: 'keep' }])
  assert.deepEqual(api.seen.find(x => x.route === 'PUT /api/data').body.state.workouts, [{ id: 'w1' }])

  for (const [patch, options] of [
    [() => ({ name: 'x' }), { allowDelete: true, ids: ['gone'] }],
    [state => ({ ...state, routines: [] }), { allowDelete: true, ids: ['gone'] }],
    [state => ({ ...state, routines: state.routines.filter(entry => entry.id !== 'gone'), workouts: [] }), { allowDelete: true, ids: ['gone'] }],
    [state => ({ ...state, routines: state.routines.filter(entry => entry.id !== 'gone') }), { allowDelete: true }],
    [state => ({ ...state, routines: state.routines.filter(entry => entry.id !== 'gone') }), { allowDelete: true, ids: [] }],
    [state => ({ ...state, routines: state.routines.filter(entry => entry.id !== 'gone') }), { ids: ['gone'] }],
  ]) {
    const refuse = await fixture(route => route === 'GET /api/data' ? [200, { state: current, rev: 4 }] : [500, {}])
    t.after(refuse.close)
    await assert.rejects(() => refuse.store.updateProfile('secret', patch, options), /invalid profile/i)
    // malformed options fail before any request; the rest after the single read. Never a write.
    assert.equal(refuse.seen.every(x => x.route === 'GET /api/data'), true)
  }
})

test('patch larger than 5 MiB is refused before any PUT', async t => {
  const api = await fixture(route => route === 'GET /api/data' ? [200, { state: valid, rev: 1 }] : [500, {}])
  t.after(api.close)
  await assert.rejects(() => api.store.updateProfile('secret', state => ({ ...state, note: 'x'.repeat(5 * 1024 * 1024) })), /invalid profile/i)
  assert.deepEqual(api.seen.map(x => x.route), ['GET /api/data'])
})

test('a throwing response stream never echoes the secret error text', async t => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"rev":0,"state":')
    setTimeout(() => res.destroy(new Error('bearer=secret-token leaked')), 5)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const store = createProfileStore({ apiBase: `http://127.0.0.1:${server.address().port}` })
  await assert.rejects(() => store.readProfile('secret'), e => {
    assert.match(e.message, /^profile upstream unavailable$/)
    assert.doesNotMatch(e.message, /secret-token|bearer=/)
    assert.equal(e.cause, undefined)
    return true
  })
})

test('lost PUT response is not retried in the same call; a later idempotent call does not duplicate', async t => {
  let puts = 0
  let rev = 1
  const stored = { routines: [{ id: 'old', name: 'Original' }], workouts: [], name: 'Ana', _wid: 'wid-1' }
  const api = await fixture((route, { body }) => {
    if (route === 'GET /api/data') return [200, { state: copy(stored), rev }]
    if (route === 'PUT /api/data') {
      puts++
      stored.routines = copy(body.state.routines)
      stored._wid = `wid-${puts + 1}`
      rev += 1
      if (puts === 1) return 'drop'
      return [200, { ok: true, rev, wid: stored._wid }]
    }
    if (route === 'GET /api/data/rev') return [200, { rev, wid: stored._wid }]
    return [404, {}]
  })
  t.after(api.close)
  await assert.rejects(() => api.store.updateProfile('secret', addNew), /upstream/i)
  assert.equal(puts, 1)
  const again = await api.store.updateProfile('secret', addNew)
  assert.equal(puts, 2)
  assert.equal(again.routines.filter(entry => entry.id === 'new').length, 1)
})

test('profile store has no direct state file access', () => {
  const text = readFileSync(new URL('../src/profileStore.js', import.meta.url), 'utf8')
  assert.doesNotMatch(text, /(?:node:fs|stateFile|readStateStrict|atomicWrite|state-\$\{)/)
})
