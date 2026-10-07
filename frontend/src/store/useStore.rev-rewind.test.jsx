// @vitest-environment happy-dom

/* The server's data can go back in time: a restored nightly backup, a write lost to a power cut.
   The revision is a counter, so the same number then names a different document. Every write
   carries a write id and its ancestors' (`_wid`, `_wids`, api/server.js), and a device never takes
   a document that does not descend from the one it last synced: it merges and pushes instead, so
   what it had confirmed comes back rather than vanishing here too (QA 2026-10-06). The server below
   answers like api/server.js. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const workout = id => ({ id, d: '2026-10-01', start: 1, entries: [] })
const ids = xs => (xs || []).map(x => x.id).sort()
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const httpError = (status, data) => Object.assign(new Error('HTTP ' + status), { status, data })
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))

let doc, n = 0
const write = state => { const wids = [...(doc?._wids || []), ...(doc?._wid ? [doc._wid] : [])]; doc = { ...clone(state), _rev: (doc?._rev || 0) + 1, _wids: wids, _wid: 'w' + (++n) }; return doc }
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('gym_owner', USER.id); api.mockReset(); doc = null; n = 0
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
  api.mockImplementation(async (path, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : null
    if (path === '/api/data/rev') return { rev: doc?._rev || 0, wid: doc?._wid }
    if ((o.method || 'GET') === 'GET') return { state: clone(doc), rev: doc?._rev || 0 }
    if (body.baseRev != null && (body.baseRev !== (doc?._rev || 0) || (body.baseWid && doc?._wid && body.baseWid !== doc._wid))) throw httpError(409, { error: 'conflict', rev: doc._rev, state: clone(doc) })
    write(body.state)
    return { ok: true, rev: doc._rev, wid: doc._wid }
  })
})
const signedIn = S => useStore.setState({ S, user: USER, ready: true, sync: { ...fresh } })

describe('the server went back in time', () => {
  it('a workout confirmed at rev 2 is pushed back when the server comes back at rev 1', async () => {
    write({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    const r1 = clone(doc)
    write({ ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('LegDay')] })
    signedIn({ ...clone(doc), _ts: 200 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 2, ts: 200, wid: doc._wid }))
    doc = r1   // host reset: the write of rev 2 never reached the disk
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(ids(useStore.getState().S.workouts)).toEqual(['LegDay', 'w1'])
    expect(ids(doc.workouts)).toEqual(['LegDay', 'w1'])
  })

  it('the same revision number naming another device\'s document is pulled and merged, not overwritten', async () => {
    write({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    const r1 = clone(doc)
    write({ ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('LegDay')] })
    signedIn({ ...clone(doc), _ts: 200 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 2, ts: 200, wid: doc._wid }))
    doc = r1                                                              // restored backup at rev 1
    write({ ...clone(r1), _ts: 300, workouts: [workout('w1'), workout('B_Push')] })   // device B: rev 2 again
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(ids(doc.workouts)).toEqual(['B_Push', 'LegDay', 'w1'])
    expect(ids(useStore.getState().S.workouts)).toEqual(['B_Push', 'LegDay', 'w1'])
  })

  it('an answer that left before this device\'s own push landed is not taken over the newer copy', async () => {
    write({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    const r1 = clone(doc)
    write({ ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('w2')] })   // this device's push
    signedIn({ ...clone(doc), _ts: 200 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 2, ts: 200, wid: doc._wid }))
    const real = api.getMockImplementation()
    api.mockImplementation(async (path, o = {}) => ((o.method || 'GET') === 'GET' && path === '/api/data' ? { state: clone(r1), rev: 1 } : real(path, o)))
    await useStore.getState().pullState()
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w2'])
  })
})
