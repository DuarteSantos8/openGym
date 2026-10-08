// @vitest-environment happy-dom

/* Two tabs of one browser, one account (#283), and the other ways a client could write over
   newer server data without a 409. Each "tab" is a fresh import of the store (vi.resetModules),
   so two tabs are two closures sharing one localStorage, as in a browser. The server below
   answers like api/server.js: GET /api/data and /api/data/rev, PUT /api/data refused with the
   current document when `baseRev` is given and not the current revision. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ api: null }))
vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: (...a) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

const clone = v => JSON.parse(JSON.stringify(v))
const w = (id, d = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const ids = st => (st?.workouts || []).map(x => x.id)
const httpError = (status, data) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))
const saved = () => JSON.parse(localStorage.getItem('gym_state_v1'))

let tabs = []
let DEF
// A tab opened now: it loads the saved copy and its marker from storage, as a page load does.
async function openTab(user = { id: 'u1' }) {
  vi.resetModules()
  const m = await import('./useStore.js')
  DEF = m.DEF
  tabs.push(m.useStore)
  m.useStore.setState({ user, ready: true })
  return m.useStore
}

function server(doc) {
  const s = { doc: doc ? clone(doc) : null, log: [] }
  s.handler = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : undefined
    s.log.push({ method, path, body })
    if (method === 'GET' && path === '/api/data/rev') return { rev: s.doc?._rev || 0 }
    if (method === 'GET' && path === '/api/data') return { state: s.doc ? clone(s.doc) : null, rev: s.doc?._rev || 0 }
    if (method === 'PUT' && path === '/api/data') {
      const curRev = s.doc?._rev || 0
      if (body.baseRev != null && body.baseRev !== curRev) throw httpError(409, { error: 'conflict', rev: curRev, state: s.doc ? clone(s.doc) : null })
      delete body.state.active
      body.state._rev = curRev + 1
      s.doc = body.state
      return { ok: true, ts: body.state._ts || null, rev: body.state._rev }
    }
    if (method === 'POST' && path.startsWith('/api/logout')) return { ok: true }
    throw new Error('unexpected ' + method + ' ' + path)
  }
  // Another device writes (its own conditional PUT, always current).
  s.otherDevice = (mut, ts) => { const d = clone(s.doc); mut(d); d._ts = ts; d._rev = (s.doc?._rev || 0) + 1; s.doc = d }
  s.puts = () => s.log.filter(e => e.method === 'PUT').map(e => e.body)
  h.api = s.handler
  return s
}
// Storage as a tab that last synced revision `rev` of `doc` leaves it.
const savedCopy = (doc, rev) => {
  const S = clone(doc)
  delete S._rev
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_sync', JSON.stringify({ rev, ts: S._ts }))
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('gym_owner', 'u1')
  tabs = []
  DEF = (await import('./useStore.js')).DEF
})
afterEach(() => { for (const t of tabs) t.setState({ user: null, ready: false }); localStorage.clear() })

describe('a tab left open does not overwrite what another tab synced (#283)', () => {
  it('the stale tab quotes its own revision: its push is refused, merged, and the other tab\'s workout survives', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    const B = await openTab()

    B.getState().update(s => { s.workouts.push(w('w2', '2026-09-02')) })   // B finishes a workout
    await B.getState().pushState()
    expect(srv.doc._rev).toBe(2)
    expect(JSON.parse(localStorage.getItem('gym_sync')).rev).toBe(2)       // the shared marker moved

    A.getState().update(s => { s.restSec = 60 })                           // A, untouched since, changes a setting
    await A.getState().pushState()

    expect(srv.puts().slice(-2).map(p => p.baseRev)).toEqual([1, 2])       // refused, merged, pushed again
    expect(ids(srv.doc)).toEqual(['w1', 'w2'])
    expect(srv.doc.restSec).toBe(60)
    expect(ids(A.getState().S)).toEqual(['w1', 'w2'])
    expect(ids(saved())).toEqual(['w1', 'w2'])
  })

  it('a rev check in the stale tab compares with its own revision and pulls', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    const B = await openTab()
    B.getState().update(s => { s.workouts.push(w('w2', '2026-09-02')) })
    await B.getState().pushState()

    window.dispatchEvent(new Event('online'))   // checkRev(true) in both tabs, like the poll or a focus
    await tick()
    expect(ids(A.getState().S)).toEqual(['w1', 'w2'])
    expect(srv.puts()).toHaveLength(1)          // A adopted; nothing of its own to push
  })

  it('a full pull in the stale tab with a change of its own merges instead of pushing over', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    A.getState().update(s => { s.restSec = 60 }, false)   // an edit whose push has not run yet
    srv.otherDevice(d => { d.workouts.push(w('w2', '2026-09-02')) }, 200)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 2, ts: 200 }))   // written by another tab

    await A.getState().pullState()

    expect(srv.puts().map(p => p.baseRev)).toEqual([2])
    expect(ids(srv.doc)).toEqual(['w1', 'w2'])
    expect(srv.doc.restSec).toBe(60)
  })

  it('another tab\'s marker moving makes a clean tab check the server and follow', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    srv.otherDevice(d => { d.workouts.push(w('w2', '2026-09-02')) }, 200)
    const marker = JSON.stringify({ rev: 2, ts: 200 })
    localStorage.setItem('gym_sync', marker)
    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_sync', newValue: marker }))
    await tick()
    expect(ids(A.getState().S)).toEqual(['w1', 'w2'])
    expect(srv.log.filter(e => e.method === 'GET').map(e => e.path)).toEqual(['/api/data/rev', '/api/data'])
  })

  it('a marker at the revision the tab already has asks nothing', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    await openTab()
    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_sync', newValue: JSON.stringify({ rev: 1, ts: 100 }) }))
    await tick()
    expect(srv.log).toHaveLength(0)
  })

  it('another tab\'s failed push does not make a clean tab merge: a deletion stays deleted', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1'), w('w2', '2026-09-02')], _rev: 3 })
    savedCopy(srv.doc, 3)
    const A = await openTab()
    // Another device deletes w2; meanwhile another tab of this browser left gym_dirty behind.
    srv.otherDevice(d => { d.workouts = d.workouts.filter(x => x.id !== 'w2') }, 300)
    localStorage.setItem('gym_dirty', '1')

    await A.getState().pullState()

    expect(ids(A.getState().S)).toEqual(['w1'])
    expect(srv.puts()).toHaveLength(0)
    expect(ids(srv.doc)).toEqual(['w1'])
  })
})

describe('other ways a push could go out without a conflict check', () => {
  it('a forced push (import, reset) that fails is retried against the revision it replaced', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()

    h.api = async () => { throw httpError(502, {}) }            // the server restarting
    A.getState().replaceState({ ...clone(DEF), workouts: [w('imported')] }, true)
    await A.getState().pushState()
    expect(localStorage.getItem('gym_dirty')).toBe('1')

    h.api = srv.handler
    srv.otherDevice(d => { d.workouts.push(w('phone', '2026-09-02')) }, 150)
    A.getState().update(s => { s.restSec = 45 })
    await A.getState().pushState()

    expect(srv.puts().map(p => p.baseRev)).toEqual([1, 2])      // refused, merged, pushed
    expect(ids(srv.doc).sort()).toEqual(['imported', 'phone', 'w1'])
  })

  it('an edit on a device whose clock is behind the revision it builds on still counts as a change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(4000)
      // The copy came from a phone whose clock is ahead: its stamp is 5000.
      const srv = server({ ...clone(DEF), _ts: 5000, workouts: [w('w1')], _rev: 1 })
      savedCopy(srv.doc, 1)
      const A = await openTab()
      A.getState().update(s => { s.workouts.push(w('mine', '2026-09-03')) }, false)   // its push never ran
      expect(A.getState().S._ts).toBeGreaterThan(5000)
      srv.otherDevice(d => { d.restSec = 120 }, 6000)

      await A.getState().pullState()

      expect(ids(srv.doc)).toEqual(['w1', 'mine'])
      expect(srv.doc.restSec).toBe(120)
    } finally { vi.useRealTimers() }
  })

  it('a push answered by something that is not the server stays owed, keeps its marker, and merges later', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    h.api = async () => { throw Object.assign(new Error('not openGym data'), { status: 200, code: 'bad-response' }) }
    A.getState().update(s => { s.workouts.push(w('local', '2026-09-03')) })
    await A.getState().pushState()
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(JSON.parse(localStorage.getItem('gym_sync')).rev).toBe(1)
    expect(A.getState().sync).toMatchObject({ status: 'error', pending: true, lastError: { status: 200, code: 'bad-response' } })

    srv.otherDevice(d => { d.workouts.push(w('phone', '2026-09-02')) }, 150)
    h.api = srv.handler
    await A.getState().syncNow()
    expect(ids(srv.doc)).toEqual(['w1', 'phone', 'local'])
    expect(A.getState().sync.status).toBe('ok')
  })
})

describe('routines edited on two devices', () => {
  it('a conflict keeps each routine as it was edited last, whichever copy is newer as a whole', async () => {
    const r = (id, reps) => ({ id, name: id, ex: [{ id: 'bench', sets: 3, reps }] })
    const srv = server({ ...clone(DEF), _ts: 100, routines: [r('push', 10), r('pull', 8)], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    A.getState().update(s => { s.routines[0].ex[0].reps = 15 }, false)        // the phone edits push day
    await tick(5)
    // then another device edits pull day and, later still, a setting: its copy is newer
    srv.otherDevice(d => { d.routines[1].ex[0].reps = 12; d.routines[1]._ts = Date.now() }, Date.now() + 1000)
    await A.getState().pushState()

    const byId = Object.fromEntries(srv.doc.routines.map(x => [x.id, x.ex[0].reps]))
    expect(byId).toEqual({ push: 15, pull: 12 })
    expect(A.getState().S.routines[0]._ts).toBeGreaterThan(0)
  })
})
