// @vitest-environment happy-dom

/* QA, v1.3.9 (t8): "Reset everything" on one device was undone by the next device that pushed a
   change of its own — its push got the 409, the merge took the union, and the wiped profile was
   back. The reset now carries its time (`resetAt`) and the names of what it wiped (`resetIds`); a
   merge with a copy that has not seen it drops exactly those (lib/sync-merge.js). And the stamp
   only moves forward: a backup restored after the reset is not wiped again by the devices that
   saw it (review of 771184c9). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { resetIdsOf } from '../lib/sync-merge.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = xs => (xs || []).map(x => x.id)
const workout = (id, end) => ({ id, d: '2026-09-20', start: end - 1000, end, exposures: [] })
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const conflict = (state, rev) => Object.assign(new Error('conflict'), { status: 409, data: { state, rev } })
const signedIn = (S, rev) => {
  localStorage.setItem('gym_sync', JSON.stringify({ rev, ts: S._ts }))
  useStore.setState({ S, user: { id: 'u1' }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
}
const PROFILE = { ...clone(DEF), _ts: 100, workouts: [workout('w1', 50), workout('w2', 60)], routines: [{ id: 'r1', name: 'A', ex: [], _ts: 10 }], bodyweight: [{ d: '2026-09-01', w: 80, t: 10 }] }

beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('Reset everything', () => {
  it('replaces the server copy with the empty one, stamped, naming what this copy and the server held', async () => {
    signedIn(clone(PROFILE), 3)
    // the server also has a workout this device never pulled
    api.mockResolvedValueOnce({ state: { ...clone(PROFILE), workouts: [...PROFILE.workouts, workout('w-elsewhere', 70)], _rev: 3 }, rev: 3 })
    api.mockResolvedValueOnce({ ok: true, rev: 4 })
    const before = Date.now()
    await useStore.getState().resetEverything()
    await useStore.getState().pushState()
    const [put] = puts()
    expect(put.baseRev).toBeUndefined()
    expect(put.state.workouts).toEqual([])
    expect(put.state.resetAt).toBeGreaterThanOrEqual(before)
    expect(put.state.resetIds.workouts).toEqual(['w1', 'w2', 'w-elsewhere'])
    expect(put.state.resetIds.routines).toEqual(['r1'])
    expect(put.state.resetIds.bodyweight).toEqual(['2026-09-01|10'])
  })

  it('a device that has not seen it and pushes a change from before keeps the reset, not the old profile', async () => {
    signedIn(clone(PROFILE), 3)
    useStore.getState().update(s => { s.restSec = 45 })   // a change made before the reset, unsent
    const resetAt = Date.now() + 1000
    const serverReset = { ...clone(DEF), _ts: resetAt, resetAt, resetIds: resetIdsOf(PROFILE), _rev: 4 }
    api.mockRejectedValueOnce(conflict(serverReset, 4))
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().pushState()

    const put = puts().at(-1)
    expect(put.baseRev).toBe(4)
    expect(put.state.workouts).toEqual([])
    expect(put.state.routines).toEqual([])
    expect(put.state.bodyweight).toEqual([])
    expect(put.state.resetAt).toBe(resetAt)
    expect(useStore.getState().S.workouts).toEqual([])
  })

  it('what that device logged after the reset is kept, whatever its clock says', async () => {
    const resetAt = Date.now() + 3600e3   // this device's clock is an hour behind the resetting one
    signedIn(clone(PROFILE), 3)
    useStore.getState().update(s => { s.workouts.push(workout('after', Date.now())) })
    const serverReset = { ...clone(DEF), _ts: resetAt, resetAt, resetIds: resetIdsOf(PROFILE), _rev: 4 }
    api.mockRejectedValueOnce(conflict(serverReset, 4))
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().pushState()
    expect(ids(puts().at(-1).state.workouts)).toEqual(['after'])
  })
})

describe('a backup restored after a reset', () => {
  it('the replace keeps the reset stamp, so it is not taken for a copy from before the reset', async () => {
    const T1 = Date.now() - 3600e3
    signedIn({ ...clone(DEF), _ts: T1, resetAt: T1, resetIds: resetIdsOf(PROFILE) }, 4)
    const backup = { ...clone(PROFILE), _ts: 50 }   // an old backup: no stamp
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    useStore.getState().importBackup(backup)
    await useStore.getState().pushState()
    const put = puts().at(-1)
    expect(ids(put.state.workouts)).toEqual(['w1', 'w2'])
    expect(put.state.resetAt).toBe(T1)
  })

  it('a device that saw the reset keeps the restored backup when it merges its own change in', async () => {
    const T1 = Date.now() - 3600e3
    const resetIds = resetIdsOf(PROFILE)
    signedIn({ ...clone(DEF), _ts: T1, resetAt: T1, resetIds }, 4)
    useStore.getState().update(s => { s.workouts.push(workout('gym-today', Date.now())) })
    // the server after the restore on the other device: the backup's workouts, the stamp kept
    const serverAfterImport = { ...clone(PROFILE), _ts: Date.now() - 1000, resetAt: T1, resetIds, _rev: 5 }
    api.mockRejectedValueOnce(conflict(serverAfterImport, 5))
    api.mockResolvedValueOnce({ ok: true, rev: 6 })
    await useStore.getState().pushState()
    expect(ids(puts().at(-1).state.workouts).sort()).toEqual(['gym-today', 'w1', 'w2'])
  })
})
