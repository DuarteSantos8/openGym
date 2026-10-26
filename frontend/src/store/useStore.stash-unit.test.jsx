// @vitest-environment happy-dom

/* A workout kept aside by a sign-out comes back on the next sign-in in the unit of the profile it
   joins: switched to lb (converting) on another device meanwhile, its 100 kg sets came back as
   100 lb, and finishing it logged the wrong weights. (QA 2026-10-06.) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const active = { id: 'run1', d: '2026-10-06', start: 1, name: 'Push', exposures: [], entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: false }] }] }
beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('a kept running workout and a unit switch elsewhere', () => {
  it('comes back converted into the profile\'s unit', async () => {
    const S = { ...clone(DEF), _ts: 100, unit: 'kg', workouts: [] }
    localStorage.setItem('gym_owner', 'u1'); localStorage.setItem('gym_sync', JSON.stringify({ rev: 3, ts: 100 }))
    useStore.setState({ S, A: clone(active), user: { id: 'u1', name: 'x' }, ready: true })
    api.mockResolvedValue({ ok: true })
    expect(await useStore.getState().signOut()).toEqual({ owed: false })
    const server = { ...clone(DEF), _ts: 500, unit: 'lb', unitSet: { at: 400, convert: true }, workouts: [], _rev: 4 }
    api.mockReset()
    api.mockImplementation(async (p, o) => (o?.method === 'PUT' ? { ok: true, rev: 5 } : { state: clone(server), rev: 4 }))
    useStore.getState().setUser({ id: 'u1', name: 'x' }, { adopt: true })
    await useStore.getState().adoptProfile(async () => true)
    const after = useStore.getState().S
    expect(after.unit).toBe('lb')
    expect(useStore.getState().A.entries[0].sets[0].w).toBeCloseTo(220.5, 0)
  })
})
