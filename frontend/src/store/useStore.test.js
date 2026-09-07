// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', () => ({
  api: apiMock,
  setRemoteAuth: vi.fn(),
  pairRedeem: vi.fn()
}))

describe('state push conflict recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
    localStorage.clear()
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1', name: 'Phone user' }))
    localStorage.setItem('gym_sync_meta_v1', JSON.stringify({ revision: '"base"' }))
    localStorage.setItem('gym_sync_base_v1', JSON.stringify({ routines: [{ id: 'r1', name: 'Base' }], workouts: [] }))
    localStorage.setItem('gym_state_v1', JSON.stringify({ routines: [{ id: 'r1', name: 'Phone old' }], workouts: [] }))
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('merges edits made before a 412 recovery fetch into the retry payload', async () => {
    const { useStore } = await import('./useStore.js')
    const store = useStore.getState()
    const putBodies = []
    apiMock.mockImplementation(async (path, options = {}) => {
      if (path !== '/api/data') throw new Error('unexpected api path')
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body)
        putBodies.push(body.state)
        if (putBodies.length === 1) {
          // This edit lands while the stale request is in flight. The recovery merge must read it
          // from the store, not reuse the old request snapshot.
          store.update(s => { s.routines[0].name = 'Phone newer' }, false)
          const error = new Error('stale revision'); error.status = 412; throw error
        }
        return { revision: '"merged"' }
      }
      return {
        state: { routines: [{ id: 'r1', name: 'Base' }, { id: 'r2', name: 'Remote addition' }], workouts: [] },
        revision: '"remote"'
      }
    })

    await expect(store.pushState()).resolves.toBe(true)
    expect(putBodies).toHaveLength(2)
    expect(putBodies[1].routines).toEqual([
      { id: 'r1', name: 'Phone newer' },
      { id: 'r2', name: 'Remote addition' }
    ])
  })

  it('merges the latest local edit after a lost-response 409 before retrying', async () => {
    const { useStore } = await import('./useStore.js')
    const store = useStore.getState()
    const putBodies = []
    apiMock.mockImplementation(async (path, options = {}) => {
      if (path !== '/api/data') throw new Error('unexpected api path')
      if (options.method === 'PUT') {
        putBodies.push(JSON.parse(options.body).state)
        if (putBodies.length === 1) {
          store.update(s => { s.routines[0].name = 'Phone newer' }, false)
          const error = new Error('idempotency conflict'); error.status = 409; throw error
        }
        return { revision: '"merged"' }
      }
      return {
        state: { routines: [{ id: 'r1', name: 'Base' }, { id: 'r2', name: 'Remote addition' }], workouts: [] },
        revision: '"remote"'
      }
    })

    await expect(store.pushState()).resolves.toBe(false)
    // The 409 handler schedules a retry; invoking it directly keeps this regression deterministic
    // while also proving the rotated mutation can commit the merged state.
    await expect(store.pushState()).resolves.toBe(true)
    expect(putBodies[1].routines).toEqual([
      { id: 'r1', name: 'Phone newer' },
      { id: 'r2', name: 'Remote addition' }
    ])
  })
})
