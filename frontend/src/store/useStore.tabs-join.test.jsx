// @vitest-environment happy-dom

/* Two tabs of one browser share the saved copy. Each used to write its whole in-memory copy over
   it, so a change one tab saved and had not pushed (offline, the server down, a guest) was lost
   the moment the other tab saved anything; a second tab's pull wrote `active: null` over the
   workout running in the first; and a sign-out in one tab decided from its own stale copy and
   wiped what the other tab owed. (QA 2026-10-06, also in v1.3.9.) Each "tab" is a fresh import of
   the store sharing one localStorage, as in the other tab tests. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ api: null }))
vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: (...a) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {}, stopRest: () => {}, abandonWork: () => {} }) } }))

const clone = v => JSON.parse(JSON.stringify(v))
const w = (id, d = '2026-09-01') => ({ id, d, start: 1, end: 2, entries: [] })
const ids = st => (st?.workouts || []).map(x => x.id).sort()
const httpError = (status, data) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))
const saved = () => JSON.parse(localStorage.getItem('gym_state_v1'))

let tabs = []
let DEF
// Tabs of earlier tests still listen on the same window; each test is another account, so they
// take no part (a tab joins only copies of the account it last saw).
let OWNER = 'u0'
async function openTab(user = { id: OWNER }) {
  vi.resetModules()
  const m = await import('./useStore.js')
  DEF = m.DEF
  tabs.push(m.useStore)
  m.useStore.setState({ user, ready: true })
  return m.useStore
}
// The browser telling the other tabs that this one saved (it never tells the tab that wrote).
const announce = () => {
  window.dispatchEvent(new StorageEvent('storage', { key: 'gym_state_wid', newValue: localStorage.getItem('gym_state_wid') }))
  window.dispatchEvent(new StorageEvent('storage', { key: 'gym_active_v1', newValue: localStorage.getItem('gym_active_v1') }))
}
const savedActive = () => JSON.parse(localStorage.getItem('gym_active_v1'))

function server(doc) {
  const s = { doc: doc ? clone(doc) : null, log: [], offline: false }
  h.api = async (path, opts = {}) => {
    if (s.offline) throw new TypeError('Failed to fetch')
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : undefined
    s.log.push({ method, path, body })
    if (method === 'GET' && path === '/api/data/rev') return { rev: s.doc?._rev || 0 }
    if (method === 'GET' && path === '/api/data') return { state: s.doc ? clone(s.doc) : null, rev: s.doc?._rev || 0 }
    if (method === 'PUT' && path === '/api/data') {
      const curRev = s.doc?._rev || 0
      if (body.baseRev != null && body.baseRev !== curRev) throw httpError(409, { error: 'conflict', rev: curRev, state: clone(s.doc) })
      delete body.state.active
      body.state._rev = curRev + 1
      s.doc = body.state
      return { ok: true, rev: body.state._rev }
    }
    if (method === 'POST' && path.startsWith('/api/logout')) return { ok: true }
    throw new Error('unexpected ' + method + ' ' + path)
  }
  return s
}
const savedCopy = (doc, rev) => {
  const S = clone(doc); delete S._rev
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_sync', JSON.stringify({ rev, ts: S._ts }))
}

beforeEach(async () => {
  localStorage.clear()
  OWNER = 'u' + (Number(OWNER.slice(1)) + 1)
  localStorage.setItem('gym_owner', OWNER)
  tabs = []
  DEF = (await import('./useStore.js')).DEF
})
afterEach(() => { for (const t of tabs) t.setState({ user: null, ready: false }); localStorage.clear() })

describe('two tabs of one browser keep each other\'s changes', () => {
  it('does not replace a running v2 session with an unreadable or legacy active copy', async () => {
    server({ ...clone(DEF), _ts: 100, workouts: [], _rev: 1 })
    const A = await openTab()
    A.getState().setActive({ id: 'run', exposures: [], entries: [] })
    for (const raw of ['{bad', JSON.stringify({ id: 'old', entries: [] })]) {
      localStorage.setItem('gym_active_v1', raw)
      announce()
      expect(A.getState().A.id).toBe('run')
    }
    localStorage.removeItem('gym_active_v1')
    announce()
    expect(A.getState().A).toBeNull()
  })

  it('offline: a workout finished in a tab that is then closed survives the other tab\'s next change, and reaches the server', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    const B = await openTab()
    srv.offline = true
    B.getState().update(s => { s.workouts.push(w('w2', '2026-09-02')); s.bodyweight = [{ d: '2026-09-02', w: 77.7, t: Date.now() }] })
    await B.getState().pushState()                 // fails: offline
    B.setState({ user: null, ready: false })        // the tab is closed (no event reaches A in time)
    A.getState().update(s => { s.restSec = 45 })
    expect(ids(saved())).toEqual(['w1', 'w2'])
    expect(saved().bodyweight.map(e => e.w)).toEqual([77.7])
    expect(saved().restSec).toBe(45)
    srv.offline = false
    await A.getState().pushState()
    expect(ids(srv.doc)).toEqual(['w1', 'w2'])
    expect(srv.doc.bodyweight.map(e => e.w)).toEqual([77.7])
  })

  it('guests: what one tab logged survives the other tab\'s setting change', async () => {
    localStorage.removeItem('gym_owner')
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...clone(DEF), _ts: 100, workouts: [w('g1')] }))
    const A = await openTab(null)
    const B = await openTab(null)
    A.getState().update(s => { s.workouts.push(w('g2', '2026-09-03')) })
    B.getState().update(s => { s.restSec = 120 })
    expect(ids(saved())).toEqual(['g1', 'g2'])
    expect(saved().restSec).toBe(120)
  })

  it('a second tab\'s pull keeps the workout running in the first', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    const B = await openTab()
    A.getState().setActive({ id: 'run1', exposures: [], start: Date.now(), entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }] })
    // another device writes; B (no change of its own) pulls and adopts the server's copy
    srv.doc = { ...clone(srv.doc), workouts: [w('w1'), w('wX', '2026-09-04')], _rev: 2, _ts: 300 }
    await B.getState().pullState()
    expect(savedActive()?.id).toBe('run1')
    expect(savedActive().entries[0].sets).toHaveLength(2)
    expect(ids(saved())).toEqual(['w1', 'wX'])
  })

  it('the other tab takes a saved change into memory as soon as the browser says so', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    const B = await openTab()
    B.getState().update(s => { s.workouts.push(w('w2', '2026-09-02')) }, false)
    announce()
    expect(ids(A.getState().S)).toEqual(['w1', 'w2'])
  })

  it('sign-out in one tab counts, and keeps, what the other tab finished offline', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    const B = await openTab()
    srv.offline = true
    B.getState().update(s => { s.workouts.push(w('w2', '2026-09-02')) })
    await B.getState().pushState()
    srv.offline = false   // only tab B's push failed; A is online when it signs out
    const r = await A.getState().signOut()
    // A's last push carried B's workout before the wipe (or, had it failed, the sign-out would say it is owed)
    expect(r.owed).toBe(false)
    expect(ids(srv.doc)).toEqual(['w1', 'w2'])
  })
  // QA retest 2026-10-06: the tab that signed in (or signed up) still compared against the owner it
  // had loaded with, so it took no part in the join until it had saved once itself, and that save
  // wrote its copy over a weigh-in and a running workout another tab had logged.
  it('a tab that just signed in sees the other tab\'s saves and keeps them, running workout included', async () => {
    localStorage.removeItem('gym_owner')
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...clone(DEF), _ts: 100, workouts: [w('g1')] }))
    const srv = server(null)
    const A = await openTab(null)
    A.getState().setUser({ id: OWNER, name: 'Tess' })   // signs up here; nothing saved since
    const B = await openTab()                              // opened afterwards, on the account
    srv.offline = true
    B.getState().update(s => {
      s.bodyweight = [{ d: '2026-09-05', w: 66.6, t: Date.now() }]
    })
    B.getState().setActive({ id: 'run2', exposures: [], start: Date.now(), entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }] }] })
    announce()
    expect(A.getState().S.bodyweight.map(e => e.w)).toEqual([66.6])
    expect(A.getState().A?.id).toBe('run2')
    A.getState().update(s => { s.restSec = 135 })
    expect(saved().bodyweight.map(e => e.w)).toEqual([66.6])
    expect(savedActive()?.id).toBe('run2')
    expect(saved().restSec).toBe(135)
  })

  it('a tab that just signed in joins a closed tab\'s save on its next change', async () => {
    localStorage.removeItem('gym_owner')
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...clone(DEF), _ts: 100, workouts: [w('g1')] }))
    const srv = server(null)
    const A = await openTab(null)
    A.getState().setUser({ id: OWNER, name: 'Tess' })
    const B = await openTab()
    srv.offline = true
    B.getState().update(s => { s.workouts.push(w('w2', '2026-09-02')); s.bodyweight = [{ d: '2026-09-05', w: 66.6, t: Date.now() }] })
    B.setState({ user: null, ready: false })   // closed before the browser told A
    A.getState().update(s => { s.restSec = 135 })
    expect(ids(saved())).toEqual(['g1', 'w2'])
    expect(saved().bodyweight.map(e => e.w)).toEqual([66.6])
  })

  it('a tab that signed out joins what another signed-out tab saves next', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    await A.getState().signOut()
    const B = await openTab(null)   // a guest tab opened after the sign-out
    B.getState().update(s => { s.workouts.push(w('g9', '2026-09-09')) })
    A.getState().update(s => { s.restSec = 50 })
    expect(ids(saved())).toEqual(['g9'])
    expect(saved().restSec).toBe(50)
  })
  it('a sign-in asks about what another guest tab saved too, and then joins only the account\'s saves', async () => {
    localStorage.removeItem('gym_owner')
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...clone(DEF), _ts: 100, workouts: [w('g1')] }))
    server(null)
    const A = await openTab(null)
    const B = await openTab(null)
    B.getState().update(s => { s.workouts.push(w('g2', '2026-09-02')) })   // A not told yet
    A.getState().setUser({ id: OWNER, name: 'Tess' }, { adopt: true })
    expect(JSON.parse(localStorage.getItem('gym_adopt')).pre.workouts.sort()).toEqual(['g1', 'g2'])
  })
})
