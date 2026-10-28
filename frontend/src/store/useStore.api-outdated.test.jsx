// @vitest-environment happy-dom

/* The web app updated before the API. An old server knows no engine gate and answers GET /api/data
   with the v1 document as it stands. Every adopt path overlays DEF on what the server returns, and
   DEF carries engineSchemaVersion 2: taken as it is, the v1 profile was labelled v2 with `entries`
   where exposures belong, the next change pushed that label back, and once the API caught up its
   status read "not required" — the migration never ran and the v1 backup was never written. A
   v1 answer is a server still to be updated: the migration screen opens (and says so, from the
   404 on /migration-status), nothing is adopted and nothing is pushed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock, toast } = vi.hoisted(() => ({ apiMock: vi.fn(), toast: vi.fn() }))
vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: apiMock }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => false }))

const KEY = 'gym_state_v1'
const V1 = {
  unit: 'kg', _ts: 50,
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear', warmupSets: 2 }] }],
  workouts: [{ id: 'w1', d: '2026-01-05', start: 1, routineIds: ['r1'], entries: [{ id: '0025', rid: 'r1', target: { sets: 3, reps: 5, weight: 60 }, sets: [{ r: 5, w: 60, done: true }] }] }]
}
const refused = (status, error) => Object.assign(new Error(error), { status, data: { error } })
const byPath = routes => apiMock.mockImplementation(async (path, opts) => {
  const hit = routes[path]
  if (hit === undefined) throw refused(404, 'unexpected ' + path)
  if (hit instanceof Error) throw hit
  return typeof hit === 'function' ? hit(opts) : hit
})
const puts = () => apiMock.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const fresh = async () => { vi.resetModules(); return (await import('./useStore.js')).useStore }
const signedIn = () => { localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' })); localStorage.setItem('gym_owner', 'u1') }
// An API from before the engine: no gate, no /migration-status, the v1 document answered as is.
const oldApi = (data, extra = {}) => ({
  '/api/config': {}, '/api/me': { user: { id: 'u1' } },
  '/api/data': opts => { if (opts?.method === 'PUT') return { ok: true, rev: (data.rev || 0) + 1 }; return data },
  '/api/data/rev': { rev: data.rev || 0 },
  '/api/data/migration-status': refused(404, 'not found'),
  ...extra
})
const v1Shaped = st => !!st && st.engineSchemaVersion !== 2 || (st?.workouts || []).some(w => Array.isArray(w.entries) && !Array.isArray(w.exposures))

beforeEach(() => { localStorage.clear(); apiMock.mockReset(); toast.mockReset() })
afterEach(() => { vi.restoreAllMocks() })

// After every scenario: the v1 document is nowhere in this client, and nothing v1-shaped left it.
async function expectRefused(useStore) {
  const { S, migration } = useStore.getState()
  expect(S.workouts.map(w => w.id)).not.toContain('w1')
  expect(S.workouts.some(w => Array.isArray(w.entries))).toBe(false)
  expect(migration).toMatchObject({ phase: 'error', reason: 'api-outdated' })
  // A change behind the gate is neither saved nor pushed (persist is gated), so nothing reaches a
  // server that still holds v1 — and whatever left before the gate closed was never v1-shaped.
  useStore.getState().update(s => { s.restSec = 45 })
  await new Promise(r => setTimeout(r, 30))
  expect(puts().filter(p => v1Shaped(p.state))).toEqual([])
  expect(puts()).toEqual([])
  const stored = localStorage.getItem(KEY)
  if (stored) expect(JSON.parse(stored).workouts || []).toEqual([])
}

describe('a v1 answer from a server that has not been updated', () => {
  it('a fresh sign-in on a revisioned server does not adopt it (the first pull)', async () => {
    signedIn()
    const useStore = await fresh()
    byPath(oldApi({ state: { ...V1, _rev: 3 }, rev: 3 }))
    await useStore.getState().boot()
    await expectRefused(useStore)
  })

  it('a fresh sign-in on a server from before revisions does not adopt it (restoredStateFor)', async () => {
    signedIn()
    const useStore = await fresh()
    byPath(oldApi({ state: V1 }))
    await useStore.getState().boot()
    await expectRefused(useStore)
  })

  it('a device in step with the server does not adopt the v1 document it moved to', async () => {
    signedIn()
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 2, ts: 10 }))
    const useStore = await fresh()
    byPath(oldApi({ state: { ...V1, _rev: 3 }, rev: 3 }))
    await useStore.getState().boot()
    await expectRefused(useStore)
  })

  it('a sign-in that takes the server profile does not take a v1 one (takeServer)', async () => {
    const useStore = await fresh()
    byPath(oldApi({ state: { ...V1, _rev: 3 }, rev: 3 }))
    useStore.setState({ user: { id: 'u1' }, ready: true })
    localStorage.setItem('gym_owner', 'u1')
    await useStore.getState().adoptProfile(async () => false).catch(() => {})
    await expectRefused(useStore)
  })
})
