// @vitest-environment happy-dom

/* The watch's queue drained while the server sync is busy. Sets the watch logged land in the
   store through the same update() as a tap; a push that is on its way meanwhile (answered with a
   200 for the copy without them, or with a 409 and another device's copy) must not make them
   disappear: the 409's merge keeps them, and they are on the server after the push that follows.
   The workout running on this phone is this phone's own, and a merge leaves it alone, the watch's
   sets in it included.

   Real store and real lib/watch-sync.js; the API is a mock whose answers the test lets go. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => false }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { stampWorkout } from '../lib/sync-merge.js'
import { applyEvents, bindWatchActions, bindWatchAppActions, patchSetIn, _resetWatchSync } from '../lib/watch-sync.js'

const clone = v => JSON.parse(JSON.stringify(v))
const A = { id: 'acct-a', name: 'anna' }
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }
const entry = (done = [true, false]) => ({ id: '0025', target: { sets: 2, reps: 8 }, sets: done.map(d => ({ w: 60, r: 8, done: d, ...(d ? { at: 1000 } : {}) })) })
const workout = (id, over = {}) => ({ id, d: '2026-11-10', start: 1, end: 2, entries: [entry()], ...over })

let calls = []
const pending = () => calls.filter(c => !c.done)
const call = method => pending().find(c => c.method === method && c.path === '/api/data')
const answer = (c, v) => { c.done = true; c.resolve(v) }
const refuse = (c, e) => { c.done = true; c.reject(e) }
const conflict = (state, rev) => Object.assign(new Error('conflict'), { status: 409, data: { error: 'conflict', state, rev } })
async function settle () {
  for (let round = 0; round < 10 && pending().length; round++) {
    for (const c of pending()) answer(c, c.method === 'PUT' ? { ok: true, rev: 99 } : { state: null, rev: 0 })
    await flush()
  }
}

const SERVER = { ...clone(DEF), _ts: 100, unit: 'kg', workouts: [workout('w-1')], _rev: 4 }
const S = () => useStore.getState().S
const saved = id => S().workouts.find(w => w.id === id)

function signedIn (over = {}) {
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 4, ts: 100 }))
  useStore.setState({ S: { ...clone(SERVER), ...over }, user: null, ready: true })
  useStore.getState().setUser(A)
  bindWatchAppActions({
    start: vi.fn(),
    patchSet: (where, fields, opts = {}) => useStore.getState().update(s => { patchSetIn(s, where, fields, stampWorkout, opts) }),
  })
  bindWatchActions({
    setDone: (ei, si, { w, r, at }) => useStore.getState().update(s => { Object.assign(s.active.entries[ei].sets[si], { w, r, at, done: true }) }),
    finish: vi.fn(), discard: vi.fn(),
  })
}
// A set the watch logged for the workout the phone had already saved.
const late = (id = 'ev-1') => ({ id, seq: 9, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1, w: 62.5, r: 6, at: Date.now() })
const drainWatch = evs => applyEvents(evs, () => useStore.getState())

beforeEach(() => {
  localStorage.clear()
  _resetWatchSync()
  calls = []
  api.mockReset()
  api.mockImplementation((path, opts = {}) => new Promise((resolve, reject) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, resolve, reject })
  }))
})
afterEach(async () => {
  await settle()
  useStore.getState().setUser(null)
  await settle()
  _resetWatchSync()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('the watch\'s queue drained while a push is on its way', () => {
  it('a 409 with another device\'s copy: the merge keeps the watch\'s set and the other device\'s workout, and both go up', async () => {
    signedIn()
    useStore.getState().update(s => { s.restSec = 120 })
    useStore.getState().pushState()
    await flush()
    const put = call('PUT')
    expect(put).toBeTruthy()

    // the watch's set lands while the request is out
    expect(drainWatch([late()])).toEqual(['ev-1'])
    expect(saved('w-1').entries[0].sets[1]).toMatchObject({ w: 62.5, r: 6, done: true })

    // another device wrote meanwhile: its copy has w-1 as it was, and a workout of its own
    refuse(put, conflict({ ...clone(SERVER), workouts: [workout('w-1'), workout('x-1', { d: '2026-11-09' })], _ts: 150, _rev: 5 }, 5))
    await flush()
    expect(saved('w-1').entries[0].sets[1]).toMatchObject({ w: 62.5, r: 6, done: true })
    expect(S().workouts.map(w => w.id).sort()).toEqual(['w-1', 'x-1'])
    const again = call('PUT')
    expect(again.body.baseRev).toBe(5)
    expect(again.body.state.workouts.find(w => w.id === 'w-1').entries[0].sets[1]).toMatchObject({ w: 62.5, r: 6, done: true })
    answer(again, { ok: true, rev: 6 })
    await flush()
  })

  it('a 200 for the copy from before the set: the set is not taken for sent, the next push carries it', async () => {
    vi.useFakeTimers()
    try {
      signedIn()
      useStore.getState().update(s => { s.restSec = 120 })
      useStore.getState().pushState()
      await vi.advanceTimersByTimeAsync(0)
      const put = call('PUT')
      expect(put.body.state.workouts[0].entries[0].sets[1].done).toBe(false)

      drainWatch([late()])
      answer(put, { ok: true, rev: 5 })
      await vi.advanceTimersByTimeAsync(5000)
      const next = calls.filter(c => c.method === 'PUT').at(-1)
      expect(next).not.toBe(put)
      expect(next.body.state.workouts[0].entries[0].sets[1]).toMatchObject({ w: 62.5, r: 6, done: true })
      expect(next.body.baseRev).toBe(5)
      answer(next, { ok: true, rev: 6 })
      await vi.advanceTimersByTimeAsync(0)
    } finally { vi.useRealTimers() }
  })

  it('the workout running on this phone, the watch\'s sets in it, comes through a 409\'s merge untouched', async () => {
    const active = { id: 'w-live', d: '2026-11-11', start: Date.now(), name: 'Push', cur: 0, entries: [entry([false, false])] }
    signedIn({ active })
    useStore.getState().update(s => { s.restSec = 120 })
    useStore.getState().pushState()
    await flush()
    const put = call('PUT')

    drainWatch([{ id: 'ev-2', seq: 1, type: 'setDone', wid: 'w-live', exId: '0025', entryIdx: 0, setIdx: 0, w: 65, r: 5, at: Date.now() }])
    refuse(put, conflict({ ...clone(SERVER), workouts: [workout('w-1'), workout('x-1')], _ts: 150, _rev: 5 }, 5))
    await flush()
    expect(S().active.id).toBe('w-live')
    expect(S().active.entries[0].sets[0]).toMatchObject({ w: 65, r: 5, done: true })
    answer(call('PUT'), { ok: true, rev: 6 })
    await flush()
  })

  it('the same events drained twice around a merge (the ack was lost) change nothing the second time', async () => {
    signedIn()
    drainWatch([late()])
    const first = clone(saved('w-1'))
    useStore.getState().pushState()
    await flush()
    refuse(call('PUT'), conflict({ ...clone(SERVER), workouts: [workout('w-1'), workout('x-1')], _ts: 150, _rev: 5 }, 5))
    await flush()
    expect(drainWatch([late()])).toEqual(['ev-1'])
    expect(saved('w-1').entries[0].sets).toEqual(first.entries[0].sets)
    expect(S().workouts.filter(w => w.id === 'w-1')).toHaveLength(1)
  })
})
