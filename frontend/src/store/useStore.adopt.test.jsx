// @vitest-environment happy-dom

/* Signed in, the server's profile is the truth: sign-in adopts it whatever the timestamps say,
   asking only about entries the device logged while signed out; the store polls the revision
   while open and flags offline / unsynced for the banner. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const routine = id => ({ id, name: id, ex: [] })
const workout = (id, d = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const sync = () => JSON.parse(localStorage.getItem('gym_sync'))
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const paths = () => api.mock.calls.map(([p]) => p)
const signedIn = (S, extra = {}) => useStore.setState({ S, user: { id: 'user-1' }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 }, ...extra })
const netErr = () => new TypeError('Failed to fetch')

const server = { ...clone(DEF), _ts: 100, unit: 'lb', restSec: 60, workouts: [workout('w1')], routines: [routine('r1')], week: { 1: ['r1'] }, _rev: 4 }
// what a guest tracked after signing out: newer, one workout, its own routine and settings
const guest = { ...clone(DEF), _ts: 900, unit: 'kg', restSec: 120, workouts: [workout('w9', '2026-09-11')], routines: [routine('rg')], week: { 2: ['rg'] }, active: { id: 'running' } }

beforeEach(() => { localStorage.clear(); api.mockReset(); toast.mockReset(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })
afterEach(() => { vi.useRealTimers(); localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('adoptProfile — sign-in takes the server profile', () => {
  it('adopts the server copy over newer local data when the user keeps the profile as is', async () => {
    signedIn(clone(guest))
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    const ask = vi.fn(async () => false)
    const r = await useStore.getState().adoptProfile(ask)
    expect(ask).toHaveBeenCalledWith({ workouts: 1, bodyweight: 0, customEx: 0 })
    const S = useStore.getState().S
    expect(S.unit).toBe('lb'); expect(S.restSec).toBe(60)
    expect(S.workouts.map(w => w.id)).toEqual(['w1'])
    expect(S.routines.map(x => x.id)).toEqual(['r1'])
    expect(S.active).toEqual({ id: 'running' })   // the in-progress session stays with the device
    expect(puts()).toHaveLength(0)
    expect(sync()).toEqual({ rev: 4, ts: 100 })
    expect(r).toEqual({ adopted: true, added: false })
  })

  it('adds the device\'s entries to the profile when asked to, keeping the profile\'s settings and plan', async () => {
    signedIn(clone(guest))
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().adoptProfile(async () => true)
    const S = useStore.getState().S
    expect(S.unit).toBe('lb'); expect(S.week).toEqual({ 1: ['r1'] })
    expect(S.workouts.map(w => w.id)).toEqual(['w1', 'w9'])
    expect(S.routines.map(x => x.id).sort()).toEqual(['r1', 'rg'])
    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(4)
    expect(puts()[0].state.workouts.map(w => w.id)).toEqual(['w1', 'w9'])
    expect(sync().rev).toBe(5)
  })

  it('does not ask when the device has nothing the profile lacks', async () => {
    signedIn({ ...clone(DEF), _ts: 900, unit: 'kg' })
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    const ask = vi.fn(async () => true)
    await useStore.getState().adoptProfile(ask)
    expect(ask).not.toHaveBeenCalled()
    expect(useStore.getState().S.unit).toBe('lb')
    expect(puts()).toHaveLength(0)
  })

  it('moves the device data into a profile that has no state yet', async () => {
    signedIn(clone(guest))
    api.mockResolvedValueOnce({ state: null, rev: 0 })
    api.mockResolvedValueOnce({ ok: true, rev: 1 })
    const ask = vi.fn()
    await useStore.getState().adoptProfile(ask)
    expect(ask).not.toHaveBeenCalled()
    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBeUndefined()   // a deliberate replace of an empty profile
    expect(puts()[0].state.workouts.map(w => w.id)).toEqual(['w9'])
    expect(useStore.getState().S.unit).toBe('kg')
  })
})

describe('offline and unsynced flags', () => {
  it('a push that cannot reach the server marks offline + pending and keeps the change owed', async () => {
    signedIn({ ...clone(DEF), _ts: 500, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(netErr())
    await useStore.getState().pushState()
    expect(useStore.getState().sync).toMatchObject({ offline: true, pending: true })
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    // back online: the `online` event checks with the server first (the pull clears the offline
    // flag), then the owed push lands, the flags clear, and the user hears about it once
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 100, workouts: [workout('w1')], _rev: 1 }, rev: 1 })
    api.mockResolvedValueOnce({ ok: true, rev: 2 })
    window.dispatchEvent(new Event('online'))
    await new Promise(r => setTimeout(r, 20))
    expect(useStore.getState().sync).toMatchObject({ offline: false, pending: false })
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    await new Promise(r => setTimeout(r, 0))   // the toast goes through a lazy import of useUI
    expect(toast).toHaveBeenCalledWith('Back online — synced with the server.')
  })

  it('a push the server refused is pending but not offline', async () => {
    signedIn({ ...clone(DEF), _ts: 500, workouts: [workout('w1')] })
    api.mockRejectedValueOnce(Object.assign(new Error('HTTP 500'), { status: 500, data: {} }))
    await useStore.getState().pushState()
    expect(useStore.getState().sync).toMatchObject({ offline: false, pending: true })
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('revision check on resume', () => {
  it('asks only for the revision and pulls the document when it moved', async () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ rev: 1 })
    window.dispatchEvent(new Event('online'))   // forced: no throttle
    await new Promise(r => setTimeout(r, 0))
    expect(paths()).toEqual(['/api/data/rev'])
    api.mockReset()
    api.mockResolvedValueOnce({ rev: 2 })
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('w2')], _rev: 2 }, rev: 2 })
    window.dispatchEvent(new Event('online'))
    await new Promise(r => setTimeout(r, 10))
    expect(paths()).toEqual(['/api/data/rev', '/api/data'])
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    expect(sync().rev).toBe(2)
  })

  it('a revision check that cannot reach the server only flags offline', async () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(netErr())
    window.dispatchEvent(new Event('online'))
    await new Promise(r => setTimeout(r, 0))
    expect(useStore.getState().sync.offline).toBe(true)
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1'])
  })
})
