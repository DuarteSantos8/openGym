// @vitest-environment happy-dom

/* A different account signing in on a copy whose session ended without a sign-out wiped that copy
   unless it owed its server something. When the server had lost the account (rebuilt, the
   account deleted, the data directory gone), that was the last copy of weeks of history; and a
   workout running here, which never reaches a server, was wiped even for an account that comes
   back. Now the copy is kept aside, comes back when that account signs in here again, and can be
   saved as a backup file. (QA 2026-10-06, also in v1.3.9.) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const w = (id, d = '2026-09-01') => ({ id, d, start: 1, end: 2, entries: [] })
const ids = xs => (xs || []).map(x => x.id).sort()

beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

// Olga's copy, in step with her server, whose session has ended (boot's 401 leaves it so)
const olgasCopy = ({ active = null, ...extra } = {}) => {
  localStorage.setItem('gym_owner', 'olga')
  localStorage.setItem('gym_owner_name', 'Olga')
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 9, ts: 500 }))
  useStore.setState({ S: { ...clone(DEF), _ts: 500, workouts: [w('o1'), w('o2', '2026-09-02')], routines: [{ id: 'r1', name: 'Push', ex: [] }], ...extra }, A: active, user: null, ready: true })
}

describe('another account on a copy whose session ended', () => {
  it('a synced copy is kept aside, not wiped, and can be read back for a backup file', async () => {
    olgasCopy()
    useStore.getState().setUser({ id: 'yuri', name: 'Yuri' })
    expect(useStore.getState().S.workouts).toEqual([])
    const kept = await useStore.getState().keptChanges()
    expect(kept.map(k => k.uid)).toEqual(['olga'])
    const state = await useStore.getState().keptState(kept[0].server, 'olga')
    expect(ids(state.workouts)).toEqual(['o1', 'o2'])
    expect(state.routines.map(r => r.id)).toEqual(['r1'])
  })

  it('a running workout comes back when that account signs in here again', async () => {
    olgasCopy({ active: { id: 'run', start: 1, exposures: [], entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }] }] } })
    useStore.getState().setUser({ id: 'yuri', name: 'Yuri' })
    expect(useStore.getState().A).toBe(null)
    // Yuri signs out; Olga signs in again
    useStore.setState({ user: null })
    localStorage.removeItem('gym_owner')
    const server = { ...clone(DEF), _ts: 500, workouts: [w('o1'), w('o2', '2026-09-02')], _rev: 9 }
    api.mockImplementation(async (p, o) => (o?.method === 'PUT' ? { ok: true, rev: 10 } : { state: clone(server), rev: 9 }))
    useStore.getState().setUser({ id: 'olga', name: 'Olga' }, { adopt: true })
    await useStore.getState().adoptProfile(async () => false)
    expect(useStore.getState().A?.id).toBe('run')
  })

  it('a proper sign-out still leaves nothing behind for the next account', async () => {
    localStorage.removeItem('gym_owner')
    useStore.setState({ S: { ...clone(DEF), _ts: 500, workouts: [w('g1')] }, user: null, ready: true })
    useStore.getState().setUser({ id: 'yuri', name: 'Yuri' })
    expect(await useStore.getState().keptChanges()).toEqual([])
  })
})
