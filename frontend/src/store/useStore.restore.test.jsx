// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

import { api } from '../lib/api.js'
import { DEF, restoredStateFor, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const routine = id => ({ id, name: id, ex: [] })

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

  it('pushes local data instead of overwriting a dirty local state', async () => {
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
})
