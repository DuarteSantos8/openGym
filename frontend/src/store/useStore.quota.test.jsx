// @vitest-environment happy-dom

/* Storage full: the copy can no longer be saved, but the marker and the dirty flag (small keys)
   still could. A pull adopted another device's workouts in memory and moved the marker to their
   revision; after a restart the older saved copy loaded as one in step with that revision, said
   "synced", and its next push (a matching conditional one) deleted those workouts from the
   server and from the other device. (QA 2026-10-06, also in v1.3.9.) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ api: null }))
vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: (...a) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

const clone = v => JSON.parse(JSON.stringify(v))
const w = (id, d = '2026-09-01') => ({ id, d, start: 1, end: 2, entries: [] })
const ids = st => (st?.workouts || []).map(x => x.id).sort()
const httpError = (status, data) => Object.assign(new Error('HTTP ' + status), { status, data })

let srv
function server(doc) {
  srv = { doc: clone(doc) }
  h.api = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : undefined
    if (method === 'GET' && path === '/api/data/rev') return { rev: srv.doc._rev }
    if (method === 'GET' && path === '/api/data') return { state: clone(srv.doc), rev: srv.doc._rev }
    if (method === 'PUT') {
      if (body.baseRev != null && body.baseRev !== srv.doc._rev) throw httpError(409, { error: 'conflict', rev: srv.doc._rev, state: clone(srv.doc) })
      srv.doc = { ...body.state, _rev: srv.doc._rev + 1 }
      return { ok: true, rev: srv.doc._rev }
    }
    throw new Error('unexpected ' + path)
  }
}
async function openApp() {
  vi.resetModules()
  const m = await import('./useStore.js')
  m.useStore.setState({ user: { id: 'u1' }, ready: true })
  return m
}

let full = false
const realSet = Storage.prototype.setItem
// (spied before the first write: happy-dom keeps the method a storage first used)
vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
  if (full && k === 'gym_state_v1') throw new DOMException('quota', 'QuotaExceededError')
  return realSet.call(this, k, v)
})
beforeEach(() => {
  localStorage.clear(); full = false
  localStorage.setItem('gym_owner', 'u1')
})
afterEach(() => { localStorage.clear() })

describe('a full storage never lets the marker run ahead of the saved copy', () => {
  it('a restart after a pull that could not be saved merges, and the other device\'s workouts stay', async () => {
    let m = await openApp()
    const DEF = m.DEF
    server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    await m.useStore.getState().pullState()          // in step at rev 1, saved
    full = true
    srv.doc = { ...clone(srv.doc), _ts: 200, workouts: [w('w1'), w('b1', '2026-09-02'), w('b2', '2026-09-03')], _rev: 2 }
    await m.useStore.getState().pullState()          // adopted in memory, not saved
    expect(ids(m.useStore.getState().S)).toEqual(['b1', 'b2', 'w1'])
    // restart, still full
    m = await openApp()
    expect(ids(m.useStore.getState().S)).toEqual(['w1'])   // the older saved copy
    await m.useStore.getState().pullState()
    m.useStore.getState().update(s => { s.restSec = 45 })
    await m.useStore.getState().pushState()
    expect(ids(srv.doc)).toEqual(['b1', 'b2', 'w1'])
    expect(srv.doc.restSec).toBe(45)
  })
})
