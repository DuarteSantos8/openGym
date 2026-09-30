// @vitest-environment happy-dom

/* A v1 profile — on this device or on the server — sits behind the migration screen, untouched,
   until OK; then it is backed up, converted, and loaded through the normal sync path. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { apiMock, toast } = vi.hoisted(() => ({ apiMock: vi.fn(), toast: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: apiMock }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

const KEY = 'gym_state_v1'
const BACKUP = 'gym_state_v1.pre-engine-v1'
const V1 = {
  unit: 'kg', _ts: 50,
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear', warmupSets: 2 }] }],
  workouts: [{ id: 'w1', d: '2026-01-05', start: 1, routineIds: ['r1'], entries: [{ id: '0025', rid: 'r1', target: { sets: 3, reps: 5, weight: 60 }, sets: [{ r: 5, w: 60, done: true }] }] }],
  active: { id: 'a1', d: '2026-01-06', start: 2, routineIds: ['r1'], entries: [{ id: '0025', rid: 'r1', target: { sets: 3, reps: 5, weight: 62.5 }, sets: [{ r: 5, w: 62.5, done: true }] }] }
}
const raw = JSON.stringify(V1)
const canonical = rev => ({ state: { engineSchemaVersion: 2, prescriptions: {}, oneRepMaxes: {}, progression: {}, routines: [], workouts: [], _ts: 10, _rev: rev }, rev })
const refused = (status, error) => Object.assign(new Error(error), { status, data: { error } })
const byPath = routes => apiMock.mockImplementation(async (path, opts) => {
  const hit = routes[path]
  if (hit === undefined) throw refused(404, 'unexpected ' + path)
  if (hit instanceof Error) throw hit
  return typeof hit === 'function' ? hit(opts) : hit
})
const paths = () => apiMock.mock.calls.map(([p]) => p)
const puts = () => apiMock.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const fresh = async () => { vi.resetModules(); return (await import('./useStore.js')).useStore }
const guest = () => localStorage.setItem('gym_guest', '1')
const signedIn = () => { localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' })); localStorage.setItem('gym_owner', 'u1') }
const status = (revision, required = true) => ({ required, schemaVersion: required ? 1 : 2, revision, summary: required ? { routines: 1, workouts: 1, bytes: 10 } : null })

beforeEach(() => { localStorage.clear(); apiMock.mockReset(); toast.mockReset() })

describe('a v1 copy on this device', () => {
  it('is held untouched behind the gate until OK', async () => {
    localStorage.setItem(KEY, raw); guest()
    const useStore = await fresh()
    byPath({ '/api/config': {}, '/api/me': refused(401, 'not signed in') })
    await useStore.getState().boot()
    const { migration, S, A } = useStore.getState()
    expect(migration).toMatchObject({ phase: 'confirm', serverRev: null, summary: { routines: 1, workouts: 1, bytes: raw.length } })
    expect(S.routines).toEqual([])
    expect(A).toBeNull()
    useStore.getState().update(s => { s.unit = 'lb' })
    expect(localStorage.getItem(KEY)).toBe(raw)
    expect(localStorage.getItem(BACKUP)).toBeNull()
    expect(paths()).not.toContain('/api/data/migrate-engine-v2')
  })

  it('OK backs up the exact string, converts, restores the in-progress workout and opens the app', async () => {
    localStorage.setItem(KEY, raw); guest()
    const useStore = await fresh()
    byPath({ '/api/config': {}, '/api/me': refused(401, 'not signed in') })
    await useStore.getState().boot()
    await useStore.getState().confirmMigration()
    expect(localStorage.getItem(BACKUP)).toBe(raw)
    const stored = JSON.parse(localStorage.getItem(KEY))
    expect(stored.engineSchemaVersion).toBe(2)
    expect(stored.routines[0].ex[0]).toMatchObject({ occurrenceId: 'r1:o0', warmup: { mode: 'smart', count: 2 } })
    const { migration, S, A } = useStore.getState()
    expect(migration).toBeNull()
    expect(S.workouts[0].exposures).toHaveLength(1)
    expect(S.prescriptions[A.exposures[0].prescriptionId]).toBeTruthy()
  })

  it('never replaces a backup an earlier attempt left', async () => {
    localStorage.setItem(KEY, raw); localStorage.setItem(BACKUP, 'older'); guest()
    const useStore = await fresh()
    byPath({ '/api/config': {}, '/api/me': refused(401, 'not signed in') })
    await useStore.getState().boot()
    await useStore.getState().confirmMigration()
    expect(localStorage.getItem(BACKUP)).toBe('older')
  })
})

describe('a v1 profile on the server', () => {
  it('opens the gate; OK migrates it at the status revision and then syncs', async () => {
    signedIn()
    const useStore = await fresh()
    let migrated = false
    byPath({
      '/api/config': {}, '/api/me': { user: { id: 'u1' } },
      '/api/data': () => { if (!migrated) throw refused(409, 'migration-required'); return canonical(8) },
      '/api/data/migration-status': status(7),
      '/api/data/migrate-engine-v2': () => { migrated = true; return { migrated: true, revision: 8 } }
    })
    await useStore.getState().boot()
    expect(useStore.getState().migration).toMatchObject({ phase: 'confirm', serverRev: 7 })
    await useStore.getState().confirmMigration()
    const post = apiMock.mock.calls.find(([p]) => p === '/api/data/migrate-engine-v2')
    expect(JSON.parse(post[1].body)).toEqual({ confirmed: true, baseRev: 7 })
    expect(useStore.getState().migration).toBeNull()
    expect(JSON.parse(localStorage.getItem('gym_sync')).rev).toBe(8)
  })

  it('returns to a fresh status instead of migrating a stale snapshot', async () => {
    signedIn()
    const useStore = await fresh()
    let revision = 7
    byPath({
      '/api/config': {}, '/api/me': { user: { id: 'u1' } },
      '/api/data': refused(409, 'migration-required'),
      '/api/data/migration-status': () => status(revision),
      '/api/data/migrate-engine-v2': () => { revision = 9; throw refused(409, 'migration-state-changed') }
    })
    await useStore.getState().boot()
    await useStore.getState().confirmMigration()
    expect(useStore.getState().migration).toMatchObject({ phase: 'confirm', serverRev: 9 })
  })

  it('a failed server step keeps the gate, the local backup and the converted local copy', async () => {
    signedIn(); localStorage.setItem(KEY, raw)
    const useStore = await fresh()
    byPath({
      '/api/config': {}, '/api/me': { user: { id: 'u1' } },
      '/api/data/migration-status': status(3),
      '/api/data/migrate-engine-v2': refused(500, 'migration-failed')
    })
    await useStore.getState().boot()
    await useStore.getState().confirmMigration()
    expect(useStore.getState().migration.phase).toBe('error')
    expect(localStorage.getItem(BACKUP)).toBe(raw)
    expect(JSON.parse(localStorage.getItem(KEY)).engineSchemaVersion).toBe(2)
    expect(puts()).toHaveLength(0)
    await useStore.getState().retryMigration()
    expect(paths().filter(p => p === '/api/data/migration-status')).toHaveLength(2)
    expect(useStore.getState().migration.phase).toBe('confirm')
  })

  it('a stale v1 copy on a device whose server profile is already v2 still asks, converts only locally, then merges', async () => {
    signedIn(); localStorage.setItem(KEY, raw)
    const useStore = await fresh()
    byPath({
      '/api/config': {}, '/api/me': { user: { id: 'u1' } },
      '/api/data/migration-status': status(8, false),
      '/api/data': opts => (opts?.method === 'PUT' ? { ok: true, rev: 9 } : canonical(8))
    })
    await useStore.getState().boot()
    expect(useStore.getState().migration).toMatchObject({ phase: 'confirm', serverRev: null })
    await useStore.getState().confirmMigration()
    expect(paths()).not.toContain('/api/data/migrate-engine-v2')
    const [put] = puts()
    expect(put.baseRev).toBe(8)
    expect(put.state.engineSchemaVersion).toBe(2)
    expect(put.state.workouts[0].exposures).toHaveLength(1)
    expect(useStore.getState().migration).toBeNull()
  })

  it('a resume check while the conversion runs neither reopens the gate nor pulls nor writes', async () => {
    signedIn()
    const useStore = await fresh()
    let migrated = false, finish
    byPath({
      '/api/config': {}, '/api/me': { user: { id: 'u1' } },
      '/api/data': () => { if (!migrated) throw refused(409, 'migration-required'); return canonical(8) },
      '/api/data/migration-status': status(7),
      '/api/data/migrate-engine-v2': () => { migrated = true; return new Promise(resolve => { finish = resolve }) }
    })
    await useStore.getState().boot()
    const done = useStore.getState().confirmMigration()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const pulls = paths().filter(p => p === '/api/data').length
    window.dispatchEvent(new Event('focus'))
    await useStore.getState().pullState()
    expect(useStore.getState().migration.phase).toBe('working')
    expect(paths().filter(p => p === '/api/data').length).toBe(pulls)
    expect(localStorage.getItem(KEY)).toBeNull()
    finish({ migrated: true, revision: 8 })
    await done
    expect(useStore.getState().migration).toBeNull()
  })
})

describe('MigrationGate', () => {
  it('offers exactly one action before, none during, and only Try again after a failure', async () => {
    const useStore = await fresh()
    const { default: MigrationGate } = await import('../views/MigrationGate.jsx')
    act(() => useStore.setState({ migration: { phase: 'confirm', summary: { routines: 2, workouts: 40, bytes: 2048 } } }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<MigrationGate />))
    expect(host.textContent).toContain('Your training data needs an upgrade')
    expect(host.textContent).toContain('40 workouts')
    expect([...host.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['OK'])
    act(() => useStore.setState({ migration: { phase: 'working', stage: 'convert' } }))
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(host.textContent).toContain('Converting training data')
    act(() => useStore.setState({ migration: { phase: 'error' } }))
    expect([...host.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Try again'])
    act(() => root.unmount())
  })
})
