// @vitest-environment happy-dom

/* A request belongs to the account it was made for. One started while account A was signed in
   and answered after this device moved on (another account signed in, the session ended,
   another tab signed out) must not touch what the device holds now: not its copy, not where it
   stands with the server, not the sync status, and it must not send anything in its name. A
   409's merge used to fold A's server copy into B's and push the result under B's session.
   What A still owed is kept aside for A, as any account switch keeps it.

   Real store; the API is a mock whose every answer is held until the test lets it go, so each
   race happens in exactly one order. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => false }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const workout = (id, d = '2026-10-01') => ({ id, d, start: 1, end: 2, entries: [] })
const ids = xs => (xs || []).map(x => x.id)
const A = { id: 'acct-a', name: 'anna' }
const B = { id: 'acct-b', name: 'bruno' }
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }

// Every call waits for the test: { path, method, body, resolve, reject }.
let calls = []
const pending = () => calls.filter(c => !c.done)
const call = (method, path = '/api/data') => pending().find(c => c.method === method && c.path === path)
const answer = (c, v) => { c.done = true; c.resolve(v) }
const refuse = (c, e) => { c.done = true; c.reject(e) }
const conflict = (state, rev) => Object.assign(new Error('conflict'), { status: 409, data: { error: 'conflict', state, rev } })
const putsSince = i => calls.slice(i).filter(c => c.method === 'PUT').map(c => c.body)
// Whatever is still waiting gets an ordinary answer, so nothing hangs into the next test.
async function drain() {
  for (let round = 0; round < 10 && pending().length; round++) {
    for (const c of pending()) answer(c, c.method === 'PUT' ? { ok: true, rev: 99 } : { state: null, rev: 0 })
    await flush()
  }
}

const SERVER_A = { ...clone(DEF), _ts: 100, unit: 'kg', workouts: [workout('a1')], _rev: 4 }
const SERVER_B = { ...clone(DEF), _ts: 200, unit: 'lb', restSec: 45, workouts: [workout('b1')], _rev: 40 }

// Signed in as A on a copy in step with A's revision 4.
function asA() {
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 4, ts: 100 }))
  useStore.setState({ S: clone(SERVER_A), user: null, ready: true })
  useStore.getState().setUser(A)
}
// B signs in on this device and its sign-in settles on B's own server copy.
async function switchToB() {
  useStore.getState().setUser(B, { adopt: true })
  const adoption = useStore.getState().adoptProfile(async () => false)
  await flush()
  // A store that still waits on A's request before reading B's copy asks for it once that
  // request is answered; the test answers B's read whenever it goes out.
  return { adoption, settle: async () => { for (let i = 0; i < 5 && !call('GET'); i++) await flush(); const g = call('GET'); if (g) answer(g, { state: clone(SERVER_B), rev: 40 }); return adoption } }
}
const marker = () => JSON.parse(localStorage.getItem('gym_sync'))
const stashFor = uid => Object.values(JSON.parse(localStorage.getItem('gym_stash') || '{}')).find(e => e.uid === uid)
const noneOfA = S => ids(S.workouts).filter(id => id.startsWith('a'))

beforeEach(() => {
  localStorage.clear()
  calls = []
  api.mockReset()
  api.mockImplementation((path, opts = {}) => new Promise((resolve, reject) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, resolve, reject })
  }))
})
afterEach(async () => {
  await drain()
  useStore.getState().setUser(null)
  await drain()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('a push answered after another account signed in', () => {
  it('a 200 for A leaves B\'s revision, status and copy alone, and A\'s change stays kept for A', async () => {
    asA()
    useStore.getState().update(s => { s.workouts.push(workout('a-new', '2026-10-02')) })
    useStore.getState().pushState()
    await flush()
    const putA = call('PUT')
    expect(putA.body.state.workouts.map(w => w.id)).toContain('a-new')

    const b = await switchToB()
    await b.settle()
    expect(marker().rev).toBe(40)
    const synced = useStore.getState().sync.lastSynced

    answer(putA, { ok: true, rev: 5, wid: 'wid-a5' })
    await flush()
    const st = useStore.getState()
    expect(st.user.id).toBe('acct-b')
    expect(marker()).toMatchObject({ rev: 40 })
    expect(marker().wid).not.toBe('wid-a5')
    expect(st.sync.lastSynced).toBe(synced)
    expect(noneOfA(st.S)).toEqual([])
    expect(ids(st.S.workouts)).toEqual(['b1'])
    // A's change was kept aside for A when B signed in, push or no push.
    expect(ids(stashFor('acct-a')?.state?.workouts)).toContain('a-new')
  })

  it('a 409 for A merges nothing into B and sends nothing of A\'s under B', async () => {
    asA()
    useStore.getState().update(s => { s.workouts.push(workout('a-new', '2026-10-02')) })
    useStore.getState().pushState()
    await flush()
    const putA = call('PUT')

    const b = await switchToB()
    await b.settle()
    const from = calls.length
    // B changes something of its own and pushes it.
    useStore.getState().update(s => { s.workouts.push(workout('b-new', '2026-10-03')) })
    useStore.getState().pushState()
    await flush()

    // A's server copy moved on meanwhile: the old request comes back refused, with it attached.
    refuse(putA, conflict({ ...clone(SERVER_A), workouts: [workout('a1'), workout('a-other', '2026-10-04')], _rev: 5 }, 5))
    await flush()
    await drain()

    const st = useStore.getState()
    expect(noneOfA(st.S)).toEqual([])
    expect(ids(st.S.workouts).sort()).toEqual(['b-new', 'b1'])
    const sent = putsSince(from)
    expect(sent.length).toBeGreaterThan(0)
    for (const body of sent) expect(noneOfA(body.state)).toEqual([])
    expect(ids(stashFor('acct-a')?.state?.workouts)).toContain('a-new')
  })

  it('a failed push for A does not mark B\'s copy owed or its status failed', async () => {
    asA()
    useStore.getState().update(s => { s.restSec = 77 })
    useStore.getState().pushState()
    await flush()
    const putA = call('PUT')
    const b = await switchToB()
    await b.settle()
    expect(useStore.getState().sync.status).toBe('ok')

    refuse(putA, Object.assign(new Error('Bad gateway'), { status: 502 }))
    await flush()
    const st = useStore.getState()
    expect(st.sync.status).toBe('ok')
    expect(st.sync.lastError).toBeNull()
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(st.unsyncedChanges().owed).toBe(false)
  })
})

describe('a pull answered after another account signed in', () => {
  it('A\'s server copy never reaches B\'s copy, storage or pushes, and B adopts its own', async () => {
    asA()
    useStore.getState().pullState()
    await flush()
    const getA = call('GET')
    const from = calls.length

    const b = await switchToB()
    answer(getA, { state: { ...clone(SERVER_A), workouts: [workout('a1'), workout('a-remote', '2026-10-05')], _rev: 7 }, rev: 7 })
    await flush()
    await b.settle()
    await drain()

    const st = useStore.getState()
    expect(st.user.id).toBe('acct-b')
    expect(noneOfA(st.S)).toEqual([])
    expect(ids(st.S.workouts)).toEqual(['b1'])
    expect(st.S.unit).toBe('lb')
    expect(marker().rev).toBe(40)
    expect(noneOfA(JSON.parse(localStorage.getItem('gym_state_v1')))).toEqual([])
    for (const body of putsSince(from)) expect(noneOfA(body.state)).toEqual([])
  })

  it('B\'s sign-in reads its own copy at once instead of waiting for A\'s read', async () => {
    asA()
    useStore.getState().pullState()
    await flush()
    const getA = call('GET')
    useStore.getState().setUser(B, { adopt: true })
    const adoption = useStore.getState().adoptProfile(async () => false)
    await flush()
    const getB = pending().find(c => c.method === 'GET' && c !== getA)
    expect(getB).toBeTruthy()
    answer(getB, { state: clone(SERVER_B), rev: 40 })
    await adoption
    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])
    answer(getA, { state: clone(SERVER_A), rev: 4 })
    await flush()
    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])
  })

  it('a revision check for A answered under B starts no pull and confirms nothing', async () => {
    asA()
    const synced = useStore.getState().sync.lastSynced
    window.dispatchEvent(new Event('online'))   // checkRev(true)
    await flush()
    const revA = call('GET', '/api/data/rev')
    expect(revA).toBeTruthy()
    const b = await switchToB()
    await b.settle()
    const lastSynced = useStore.getState().sync.lastSynced
    expect(lastSynced).not.toBe(synced)
    const from = calls.length
    answer(revA, { rev: 9 })
    await flush()
    expect(calls.slice(from)).toEqual([])
    expect(useStore.getState().sync.lastSynced).toBe(lastSynced)
  })
})

describe('an adoption interrupted by another sign-in', () => {
  it('B gets its own adoption, and A\'s late answer neither applies A\'s copy nor ends B\'s hold', async () => {
    // A guest's copy; A signs in and its adoption is reading A's server copy.
    useStore.setState({ S: { ...clone(DEF), _ts: 50, workouts: [workout('g1')] }, user: null, ready: true })
    useStore.getState().setUser(A, { adopt: true })
    const adoptA = useStore.getState().adoptProfile(async () => false)
    await flush()
    const getA = call('GET')
    expect(getA).toBeTruthy()

    // Before that answer, B signs in on this device.
    useStore.getState().setUser(B, { adopt: true })
    const adoptB = useStore.getState().adoptProfile(async () => false)
    await flush()
    expect(adoptB).not.toBe(adoptA)
    const getB = pending().find(c => c.method === 'GET' && c !== getA)
    expect(getB).toBeTruthy()

    answer(getA, { state: clone(SERVER_A), rev: 4 })
    await flush()
    let st = useStore.getState()
    expect(noneOfA(st.S)).toEqual([])
    expect(st.sync.held).toBe(true)
    expect(JSON.parse(localStorage.getItem('gym_adopt'))).toMatchObject({ uid: 'acct-b' })
    expect(marker()?.rev).not.toBe(4)
    await adoptA

    answer(getB, { state: clone(SERVER_B), rev: 40 })
    await adoptB
    await drain()
    st = useStore.getState()
    expect(ids(st.S.workouts)).toEqual(['b1'])
    expect(st.sync.held).toBe(false)
    expect(marker().rev).toBe(40)
    for (const body of putsSince(0)) expect(noneOfA(body.state)).toEqual([])
    // The guest copy A's question was about is not dropped by the switch: kept aside for A.
    expect(ids(stashFor('acct-a')?.state?.workouts)).toContain('g1')
  })
})

describe('a request answered after the device was signed out', () => {
  it('the session ending (no user) drops a late push and its 409 without a retry', async () => {
    asA()
    useStore.getState().update(s => { s.workouts.push(workout('a-new', '2026-10-02')) })
    useStore.getState().pushState()
    await flush()
    const putA = call('PUT')
    useStore.getState().setUser(null)   // what boot does on a 401
    const from = calls.length
    refuse(putA, conflict({ ...clone(SERVER_A), _rev: 5 }, 5))
    await flush()
    expect(putsSince(from)).toEqual([])
    expect(marker()).toEqual({ rev: 4, ts: 100 })
    // The copy is still A's, with the change it owes A: signing in as A again merges it.
    expect(ids(useStore.getState().S.workouts)).toContain('a-new')
  })

  it('another tab signing out: a late 200 writes no revision marker over the signed-out copy', async () => {
    asA()
    useStore.getState().update(s => { s.restSec = 91 })
    useStore.getState().pushState()
    await flush()
    const putA = call('PUT')
    // The other tab's sign-out: the owner goes first, then its wiped copy.
    localStorage.removeItem('gym_owner')
    localStorage.removeItem('gym_sync')
    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_owner', oldValue: 'acct-a', newValue: null }))
    expect(useStore.getState().user).toBeNull()
    answer(putA, { ok: true, rev: 5 })
    await flush()
    expect(localStorage.getItem('gym_sync')).toBeNull()
    expect(localStorage.getItem('gym_synced_at')).toBeNull()
  })

  it('another tab signing out: a late 409 merges nothing and sends nothing', async () => {
    asA()
    useStore.getState().update(s => { s.restSec = 92 })
    useStore.getState().pushState()
    await flush()
    const putA = call('PUT')
    localStorage.removeItem('gym_owner')
    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_owner', oldValue: 'acct-a', newValue: null }))
    const from = calls.length
    refuse(putA, conflict({ ...clone(SERVER_A), workouts: [workout('a1'), workout('a-other')], _rev: 5 }, 5))
    await flush()
    expect(putsSince(from)).toEqual([])
    expect(noneOfA(useStore.getState().S)).toEqual([])
  })
})

describe('one account, nothing switched: sync as before', () => {
  it('a 409 still merges the server copy and pushes again against its revision', async () => {
    asA()
    useStore.getState().update(s => { s.workouts.push(workout('a-new', '2026-10-02')) })
    const push = useStore.getState().pushState()
    await flush()
    refuse(call('PUT'), conflict({ ...clone(SERVER_A), workouts: [workout('a1'), workout('a-other', '2026-10-04')], _rev: 5 }, 5))
    await flush()
    const retry = call('PUT')
    expect(retry.body.baseRev).toBe(5)
    expect(ids(retry.body.state.workouts).sort()).toEqual(['a-new', 'a-other', 'a1'])
    answer(retry, { ok: true, rev: 6 })
    await push
    expect(marker().rev).toBe(6)
    expect(useStore.getState().sync.status).toBe('ok')
  })

  it('a pull still adopts a newer server copy', async () => {
    asA()
    const pull = useStore.getState().pullState()
    await flush()
    answer(call('GET'), { state: { ...clone(SERVER_A), workouts: [workout('a1'), workout('a2')], _rev: 5 }, rev: 5 })
    await pull
    expect(ids(useStore.getState().S.workouts)).toEqual(['a1', 'a2'])
    expect(marker().rev).toBe(5)
  })

  it('a push asked for while one is in flight still goes after it', async () => {
    asA()
    useStore.getState().update(s => { s.restSec = 61 })
    const first = useStore.getState().pushState()
    await flush()
    useStore.getState().update(s => { s.restSec = 62 })
    useStore.getState().pushState()
    answer(call('PUT'), { ok: true, rev: 5 })
    await first
    await flush()
    const second = call('PUT')
    expect(second.body.state.restSec).toBe(62)
    expect(second.body.baseRev).toBe(5)
    answer(second, { ok: true, rev: 6 })
    await flush()
    expect(marker().rev).toBe(6)
  })
})
