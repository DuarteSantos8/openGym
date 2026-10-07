// @vitest-environment happy-dom

/* A sign-in whose adoption could not read the server (a 502, a dropped connection) holds sync. A
   sign-out in that state counted nothing as owed and wiped the guest's workouts and whatever was
   logged during the hold, with nothing stashed. (QA 2026-10-06, also in v1.3.9.) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => true }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const w = (id, d = '2026-09-01') => ({ id, d, start: 1, end: 2, entries: [] })
const ids = xs => (xs || []).map(x => x.id).sort()
const badGateway = () => Object.assign(new Error('HTTP 502'), { status: 502 })

beforeEach(() => { localStorage.clear(); api.mockReset(); useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('signing out while a sign-in is held', () => {
  it('asks first, keeps the guest\'s and the held copy\'s workouts, and adds them back on the next sign-in', async () => {
    useStore.getState().update(s => { s.workouts = [w('g1'), w('g2', '2026-09-02')] })
    const U = { id: 'u1', name: 'Olga' }
    useStore.getState().setUser(U, { adopt: true })
    api.mockRejectedValueOnce(badGateway())
    await expect(useStore.getState().adoptProfile(async () => true)).rejects.toThrow()
    useStore.getState().update(s => { s.workouts.push(w('h1', '2026-09-03')) })   // trains during the hold

    expect(useStore.getState().unsyncedChanges().owed).toBe(true)
    api.mockResolvedValue({ ok: true })
    const asked = await useStore.getState().signOut()
    expect(asked.owed).toBe(true)
    expect(ids(useStore.getState().S.workouts)).toEqual(['g1', 'g2', 'h1'])   // nothing wiped yet
    const forced = await useStore.getState().signOut({ force: true })
    expect(forced.stashed).toBe(true)
    const stash = Object.values(JSON.parse(localStorage.getItem('gym_stash')))[0]
    expect(ids(stash.state.workouts)).toEqual(['g1', 'g2', 'h1'])

    // back as the same account: the server's profile, with the kept workouts added to it
    const server = { ...clone(DEF), _ts: 50, restSec: 70, workouts: [w('w1', '2026-08-01')], _rev: 3 }
    api.mockReset()
    api.mockImplementation(async (p, o) => (o?.method === 'PUT' ? { ok: true, rev: 4 } : { state: clone(server), rev: 3 }))
    useStore.getState().setUser(U, { adopt: true })
    await useStore.getState().adoptProfile(async () => false)
    const S = useStore.getState().S
    expect(ids(S.workouts)).toEqual(['g1', 'g2', 'h1', 'w1'])
    expect(S.restSec).toBe(70)   // the account's settings
  })
})
