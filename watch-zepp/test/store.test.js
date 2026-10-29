// What the watch keeps between launches (lib/store.js), and one exchange with the server through
// the phone (syncOnce), against a stand-in for the Side Service.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, syncOnce } from '../lib/store.js'
import * as C from '../lib/session.js'

const mem = () => { const m = new Map(); return { getItem: k => m.get(k), setItem: (k, v) => m.set(k, v), m } }
const snapshot = { v: 1, unit: 'kg', active: { id: 'w-1', name: 'Push', entries: [{ id: 'sq', name: 'Squat', sets: [{ w: 100, r: 5, done: false }] }] }, ready: null, settings: { lang: 'de' }, streak: { weeks: 3, thisWeekDone: true } }

test('the session and the outbox survive the app being closed', () => {
  const storage = mem()
  const s1 = createStore(storage)
  const s0 = C.applySnapshot(s1.state, C.parseSnapshot(snapshot))
  const [next, ev] = C.tick(s0, { ei: 0, si: 0, w: 100, r: 5, at: 1, id: 'e1' })
  s1.commit(next, ev)
  const s2 = createStore(storage)
  assert.equal(s2.state.workout.entries[0].sets[0].done, true)
  assert.deepEqual(s2.outbox.map(e => e.id), ['e1'])
  s2.settle(['e1'])
  assert.deepEqual(createStore(storage).outbox, [])
  // a broken copy is a fresh start, not a crash
  storage.setItem('og_state', '{nope')
  assert.deepEqual(createStore(storage).state, C.emptyState())
})

test('a sync sends the outbox and takes the snapshot', async () => {
  const store = createStore(mem())
  store.commit(store.state, { id: 'e1', type: 'finish', wid: 'w-0', at: 1 })
  const request = async ({ method, params }) => {
    assert.equal(method, 'sync')
    assert.deepEqual(params.events.map(e => e.id), ['e1'])
    return { accepted: ['e1'], json: JSON.stringify(snapshot), at: 5 }
  }
  assert.equal(await syncOnce(store, request, { now: 10 }), 'ok')
  assert.deepEqual(store.outbox, [])
  assert.equal(store.state.workout.id, 'w-1')
  assert.equal(store.state.streak.weeks, 3)
  assert.equal(store.state.settings.lang, 'de')
  assert.deepEqual(store.link, { paired: true, at: 10, away: false })
})

test('an unpaired watch, and a phone out of reach, keep the outbox', async () => {
  const store = createStore(mem())
  store.commit(store.state, { id: 'e1', type: 'finish', wid: 'w-0', at: 1 })
  assert.equal(await syncOnce(store, async () => ({ unpaired: true })), 'unpaired')
  assert.equal(store.link.paired, false)
  assert.equal(await syncOnce(store, async () => { throw new Error('timeout') }), 'away')
  assert.equal(store.link.away, true)
  assert.equal(await syncOnce(store, async () => ({ error: 'offline' })), 'away')
  assert.equal(store.outbox.length, 1)
})
