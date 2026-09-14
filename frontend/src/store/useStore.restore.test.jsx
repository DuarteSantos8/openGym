// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
// pushState reaches the toast through a lazy import of useUI (which imports this store) — the
// tests only need to see that it was asked, not a rendered toast.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, hasData, restoredStateFor, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const routine = id => ({ id, name: id, ex: [] })
const workout = id => ({ id, d: '2026-09-01', entries: [] })
const httpError = status => Object.assign(new Error('HTTP ' + status), { status })

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('saved workout state sync and restore', () => {
  it('returns null for an older or dirty local state', () => {
    const local = { ...clone(DEF), _ts: 20, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 10, routines: [routine('remote')] }

    expect(restoredStateFor(local, remote)).toBeNull()
    expect(restoredStateFor(local, { ...remote, _ts: 30 }, true)).toBeNull()
  })

  it('overlays defaults and carries the device-local active workout', () => {
    const active = { id: 'active-1', routineId: 'local', entries: [] }
    const local = { ...clone(DEF), active }
    const restored = restoredStateFor(local, { _ts: 20, routines: [routine('remote')] })

    expect(restored.routines.map(r => r.id)).toEqual(['remote'])
    expect(restored.active).toEqual(active)
    expect(restored.restSec).toBe(90)
  })

  it('adopts a newer clean remote state while preserving a local active workout', async () => {
    const active = { id: 'active-1', d: '2026-08-29', routineId: 'local', name: 'Local', entries: [] }
    const local = { ...clone(DEF), _ts: 10, routines: [routine('local')], active }
    const remote = { ...clone(DEF), _ts: 20, routines: [routine('remote')], active: null }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValue({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['remote'])
    expect(useStore.getState().S.active).toEqual(active)
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active).toEqual(active)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('pushes local data instead of replacing it when the local state is newer', async () => {
    const local = { ...clone(DEF), _ts: 20, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 10, routines: [routine('remote')] }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValueOnce({ state: remote }).mockResolvedValueOnce({})

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(2)
    expect(api.mock.calls[1][0]).toBe('/api/data')
    expect(JSON.parse(api.mock.calls[1][1].body).state.routines.map(r => r.id)).toEqual(['local'])
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['local'])
  })

  // A dirty copy is one the server has not seen yet — not one that outranks the server's. With a
  // revision in the answer the two are merged and the merge is pushed against that revision.
  it('merges a dirty local state with the server copy and pushes the merge', async () => {
    const local = { ...clone(DEF), _ts: 10, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 20, routines: [routine('remote')], _rev: 3 }
    localStorage.setItem('gym_dirty', '1')
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValueOnce({ state: remote, rev: 3 }).mockResolvedValueOnce({ ok: true, rev: 4 })

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(2)
    const put = JSON.parse(api.mock.calls[1][1].body)
    expect(put.baseRev).toBe(3)
    expect(put.state.routines.map(r => r.id).sort()).toEqual(['local', 'remote'])
    expect(useStore.getState().S.routines.map(r => r.id).sort()).toEqual(['local', 'remote'])
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(JSON.parse(localStorage.getItem('gym_sync'))).toEqual({ rev: 4, ts: useStore.getState().S._ts })
  })

  // A server from before revisions answers without one; then the old rule holds and the dirty
  // copy is pushed as it is.
  it('pushes a dirty local state as-is to a server without revisions', async () => {
    const local = { ...clone(DEF), _ts: 10, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 20, routines: [routine('remote')] }
    localStorage.setItem('gym_dirty', '1')
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockResolvedValueOnce({ state: remote }).mockResolvedValueOnce({})

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(2)
    expect(JSON.parse(api.mock.calls[1][1].body).state.routines.map(r => r.id)).toEqual(['local'])
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['local'])
  })

  it('restores a remote state over defaults when the local profile is empty', async () => {
    const remote = { _ts: 30, routines: [routine('remote')], workouts: [] }
    api.mockResolvedValue({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['remote'])
    expect(useStore.getState().S.restSec).toBe(90)
    expect(useStore.getState().S.lang).toBe('en')
  })

  it('keeps the local saved state when the restore request fails', async () => {
    const local = { ...clone(DEF), _ts: 10, routines: [routine('local')] }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    api.mockRejectedValue(new Error('offline'))

    await useStore.getState().pullState()

    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['local'])
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('an adopted server state keeps the timestamp it came with', async () => {
    const remote = { ...clone(DEF), _ts: 20, routines: [routine('remote')] }
    useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: true })
    api.mockResolvedValue({ state: remote })

    await useStore.getState().pullState()

    expect(useStore.getState().S._ts).toBe(20)
    expect(JSON.parse(localStorage.getItem('gym_state_v1'))._ts).toBe(20)
  })

  // Device B logs a workout at T1 and pushes it 1.5 s later; device A reloads inside that window
  // and adopts the server copy from T0 < T1. If adopting re-stamped A's copy with its own clock,
  // A's next reload would see the server (T1) as older and push its stale copy over B's workout.
  it('an unchanged adopted copy does not push over a newer change from another device', async () => {
    useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: true })
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 1000000, workouts: [workout('w1')] } })
    await useStore.getState().pullState()
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1'])

    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 1010000, workouts: [workout('w1'), workout('w2-from-B')] } })
    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(2)
    expect(api.mock.calls.every(([, opts]) => !opts)).toBe(true)   // two GETs, no PUT
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1', 'w2-from-B'])
    expect(useStore.getState().S._ts).toBe(1010000)
  })
})

// The saved copy is owned by whoever last signed in on this device. An expired or revoked session
// only drops the user (boot's 401 path), so the data is still here when the next profile signs in.
describe('signing in as a different profile', () => {
  const active = { id: 'A-active', d: '2026-09-01', routineId: 'A', name: 'A', entries: [] }
  const signInAsAThenExpire = () => {
    useStore.getState().setUser({ id: 'A', name: 'A' })
    useStore.getState().replaceState({ ...clone(DEF), _ts: 20, routines: [routine('A-routine')], bodyweight: [{ d: '2026-09-01', kg: 80 }], active })
    useStore.getState().setUser(null)
    expect(hasData(useStore.getState().S)).toBe(true)
  }

  it('does not move the previous profile data into a brand-new account', async () => {
    signInAsAThenExpire()
    localStorage.setItem('gym_history_edit_pending', JSON.stringify({ id: 'A-workout' }))
    api.mockResolvedValue({ state: null })

    useStore.getState().setUser({ id: 'B', name: 'B' })
    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(1)   // the GET only — nothing was pushed under B
    expect(useStore.getState().S.routines).toEqual([])
    expect(useStore.getState().S.bodyweight).toEqual([])
    expect(useStore.getState().S.active).toBeNull()
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).routines).toEqual([])
    expect(localStorage.getItem('gym_owner')).toBe('B')
    expect(localStorage.getItem('gym_history_edit_pending')).toBeNull()
  })

  it('adopts the new profile own state even when it is older or a push failed after expiry', async () => {
    signInAsAThenExpire()
    localStorage.setItem('gym_dirty', '1')   // a debounced push that hit the 401
    const remoteB = { ...clone(DEF), _ts: 10, routines: [routine('B-routine')], active: null }
    api.mockResolvedValue({ state: remoteB })

    useStore.getState().setUser({ id: 'B', name: 'B' })
    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(1)
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['B-routine'])
    expect(useStore.getState().S.active).toBeNull()   // A's in-progress workout is not carried over
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('the same profile signing in again keeps and pushes its newer local copy', async () => {
    signInAsAThenExpire()
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 10, routines: [routine('remote')] } }).mockResolvedValueOnce({})

    useStore.getState().setUser({ id: 'A', name: 'A' })
    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(2)
    expect(JSON.parse(api.mock.calls[1][1].body).state.routines.map(r => r.id)).toEqual(['A-routine'])
    expect(useStore.getState().S.active).toEqual(active)
  })

  // The check above runs in the tab that signs in. A second tab of the same browser still holding
  // A learns about B through the storage event the sign-in fires.
  it('a tab still holding the previous profile drops it when another profile signs in elsewhere', async () => {
    vi.useFakeTimers()
    try {
      useStore.getState().setUser({ id: 'A', name: 'A' })
      useStore.getState().replaceState({ ...clone(DEF), _ts: 20, routines: [routine('A-routine')], active }, true)   // arms a push
      api.mockResolvedValue({})

      // B's setUser in the other tab: it wiped the copy, wrote defaults, then recorded the owner.
      // B's own data only lands there after its pull — this tab never re-reads it.
      localStorage.setItem('gym_state_v1', JSON.stringify({ ...clone(DEF), _ts: 30 }))
      localStorage.setItem('gym_owner', 'B')
      window.dispatchEvent(new StorageEvent('storage', { key: 'gym_owner', oldValue: 'A', newValue: 'B' }))

      expect(useStore.getState().user).toBeNull()
      expect(hasData(useStore.getState().S)).toBe(false)
      expect(useStore.getState().S.active).toBeNull()

      vi.advanceTimersByTime(3000)   // the push armed under A must not fire under B's cookie
      useStore.getState().update(s => { s.routines.push(routine('typed-after')) })
      vi.advanceTimersByTime(3000)
      await useStore.getState().pushState()

      expect(api).not.toHaveBeenCalled()
      expect(JSON.parse(localStorage.getItem('gym_state_v1')).routines.map(r => r.id)).toEqual(['typed-after'])
    } finally { vi.useRealTimers() }
  })

  // A sign-out elsewhere removes the owner. Storage events arrive per key, so this tab may see
  // the owner go while gym_state_v1 still holds A's copy — it must not keep that copy either way.
  it('a tab still holding the previous profile drops its data when that profile signs out elsewhere', async () => {
    useStore.getState().setUser({ id: 'A', name: 'A' })
    useStore.getState().replaceState({ ...clone(DEF), _ts: 20, routines: [routine('A-routine')], bodyweight: [{ d: '2026-09-01', kg: 80 }], active })
    api.mockResolvedValue({ state: null })

    localStorage.removeItem('gym_owner')   // gym_state_v1 still holds A's copy at this instant
    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_owner', oldValue: 'A', newValue: null }))

    expect(useStore.getState().user).toBeNull()
    expect(hasData(useStore.getState().S)).toBe(false)
    expect(useStore.getState().S.active).toBeNull()

    useStore.getState().setUser({ id: 'C', name: 'C' })
    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(1)   // the GET only — nothing of A's was pushed under C
    expect(api.mock.calls[0][1]).toBeUndefined()
    expect(hasData(useStore.getState().S)).toBe(false)
  })

  // The listener above reacts to the owner key alone, so the wiped copy has to be in storage
  // before the owner is removed — the same order setUser uses when it records a new owner.
  it('signing out removes the owner only after the wiped copy is written', async () => {
    useStore.getState().setUser({ id: 'A', name: 'A' })
    useStore.getState().replaceState({ ...clone(DEF), _ts: 20, routines: [routine('A-routine')] })
    api.mockResolvedValue({})

    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const real = globalThis.localStorage
    const writes = []
    const recording = new Proxy(real, {
      get(target, prop) {
        const v = Reflect.get(target, prop)
        if (prop === 'setItem' || prop === 'removeItem') return (...args) => { writes.push(prop + ' ' + args[0]); return v.apply(target, args) }
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    Object.defineProperty(globalThis, 'localStorage', { value: recording, configurable: true })
    try { await useStore.getState().signOut() }
    finally { Object.defineProperty(globalThis, 'localStorage', desc) }

    expect(globalThis.localStorage).toBe(real)
    expect(writes).toContain('removeItem gym_owner')
    expect(writes.lastIndexOf('removeItem gym_owner')).toBeGreaterThan(writes.lastIndexOf('setItem gym_state_v1'))
    expect(writes.lastIndexOf('removeItem gym_owner')).toBeGreaterThan(writes.lastIndexOf('removeItem gym_state_v1'))
    expect(localStorage.getItem('gym_owner')).toBeNull()
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).routines).toEqual([])
  })

  it('a storage event for another key or the same profile changes nothing', () => {
    useStore.getState().setUser({ id: 'A', name: 'A' })
    useStore.getState().replaceState({ ...clone(DEF), _ts: 20, routines: [routine('A-routine')] })

    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_state_v1', newValue: '{}' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_owner', oldValue: 'A', newValue: 'A' }))

    expect(useStore.getState().user).toEqual({ id: 'A', name: 'A' })
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['A-routine'])
  })

  it('guest data built after a sign-out still moves into a newly created profile', async () => {
    api.mockResolvedValue({})
    useStore.getState().setUser({ id: 'A', name: 'A' })
    await useStore.getState().signOut()
    expect(localStorage.getItem('gym_owner')).toBeNull()
    expect(hasData(useStore.getState().S)).toBe(false)

    useStore.getState().update(s => { s.routines.push(routine('guest')) }, false)
    api.mockClear()
    useStore.getState().setUser({ id: 'B', name: 'B' })
    expect(hasData(useStore.getState().S)).toBe(true)   // what the register sheet checks before pushing
    await useStore.getState().pushState()

    expect(api).toHaveBeenCalledTimes(1)
    expect(api.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(api.mock.calls[0][1].body).state.routines.map(r => r.id)).toEqual(['guest'])
  })
})

describe('push failures', () => {
  it('says once that the server refused the upload as too large, and keeps the copy dirty', async () => {
    useStore.setState({ S: { ...clone(DEF), routines: [routine('local')] }, user: { id: 'user-1' }, ready: true })

    api.mockRejectedValueOnce(httpError(401))
    await useStore.getState().pushState()
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(toast).not.toHaveBeenCalled()

    api.mockRejectedValueOnce(httpError(413))
    await useStore.getState().pushState()
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0][0]).toMatch(/too large/)
    expect(localStorage.getItem('gym_dirty')).toBe('1')

    api.mockRejectedValueOnce(httpError(413))
    await useStore.getState().pushState()
    await new Promise(r => setTimeout(r, 0))
    expect(toast).toHaveBeenCalledTimes(1)

    // A push that goes through ends the streak: the next refusal is news again.
    api.mockResolvedValueOnce({})
    await useStore.getState().pushState()
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    api.mockRejectedValueOnce(httpError(413))
    await useStore.getState().pushState()
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2))
  })
})
