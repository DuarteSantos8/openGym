// @vitest-environment happy-dom

/* Signing in with "Add them" merges a guest's (or a local-mode phone's) copy into the account.
   What that copy recorded about itself must not be applied to the account: its removals are
   keyed by day (weigh-ins) and exercise (favourites), and named the account's own entries; its
   "Reset everything" stamp made every other device of the account drop its unsent settings and
   plan as if the account had been reset. (QA 2026-10-06.) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { mergeStates, stampEdits } from '../lib/sync-merge.js'

const clone = v => JSON.parse(JSON.stringify(v))
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const up = f => useStore.getState().update(f)

beforeEach(() => { localStorage.clear(); api.mockReset(); useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true }) })
afterEach(() => { localStorage.clear() })

describe('sign-in "Add them" keeps the account\'s own entries and history', () => {
  it('a guest\'s removed weigh-in and unstarred favourite do not delete the account\'s', async () => {
    const t0 = Date.now() - 30 * 86400e3
    up(s => { s.bodyweight = [{ d: '2026-09-01', w: 8.2, t: Date.now() }] })
    up(s => { s.bodyweight = [] })
    up(s => { s.favEx = ['0025'] })
    up(s => { s.favEx = [] })
    up(s => { s.workouts = [{ id: 'gw1', d: '2026-10-05', start: Date.now() - 3600e3, end: Date.now(), entries: [] }] })
    const server = { ...clone(DEF), _ts: t0, workouts: [], favEx: ['0025', '0047'],
      bodyweight: [{ d: '2026-08-31', w: 82, t: t0 }, { d: '2026-09-01', w: 81.8, t: t0 }, { d: '2026-09-02', w: 81.5, t: t0 }], _rev: 7 }
    api.mockImplementation(async (p, o) => (o?.method === 'PUT' ? { ok: true, rev: 8 } : { state: clone(server), rev: 7 }))
    useStore.getState().setUser({ id: 'u1', name: 'x' }, { adopt: true })
    await useStore.getState().adoptProfile(async () => true)
    const S = useStore.getState().S
    expect(S.bodyweight.map(b => b.d)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02'])
    expect(S.favEx).toContain('0025')
    const put = puts().at(-1)
    expect(put.state.bodyweight.map(b => b.d)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02'])
    expect(put.state.favEx).toContain('0025')
    expect(S.workouts.map(w => w.id)).toContain('gw1')
  })

  it('a guest\'s "Reset everything" does not become the account\'s reset', async () => {
    const t0 = Date.now() - 10 * 86400e3
    up(s => { s.favEx = ['0025']; s.exNotes = { '0025': 'test' }; s.workouts = [{ id: 'gw0', d: '2026-09-30', start: 1, entries: [] }] })
    await useStore.getState().resetEverything()
    up(s => { s.workouts = [{ id: 'gw1', d: '2026-10-05', start: Date.now() - 3600e3, end: Date.now(), entries: [] }] })
    const server = { ...clone(DEF), _ts: t0, workouts: [{ id: 'sw1', d: '2026-09-20', start: t0, end: t0 + 1, entries: [] }],
      favEx: ['0025'], exNotes: { '0025': 'seat 4, pin 7' }, week: { 1: 'r1' }, routines: [{ id: 'r1', name: 'A', ex: [], _ts: t0 }], _rev: 7 }
    api.mockImplementation(async (p, o) => (o?.method === 'PUT' ? { ok: true, rev: 8 } : { state: clone(server), rev: 7 }))
    useStore.getState().setUser({ id: 'u1', name: 'x' }, { adopt: true })
    await useStore.getState().adoptProfile(async () => true)
    const put = puts().at(-1)
    expect(put.state.resetAt).toBeUndefined()
    expect(put.state.resetIds).toBeUndefined()
    // device B of the account with offline plan, note and setting changes merges the pushed copy
    const prevB = clone(server)
    const B = clone(prevB)
    B.week = { 1: 'r1', 3: 'r1' }; B.exNotes = { '0025': 'seat 5 now', '0047': 'grip wide' }; B.restSec = 150
    stampEdits(prevB, B, Date.now()); B._ts = Date.now()
    const merged = mergeStates(B, { ...put.state, _rev: 8 })
    expect(merged.week).toEqual({ 1: 'r1', 3: 'r1' })
    expect(merged.restSec).toBe(150)
    expect(merged.exNotes['0025']).toBe('seat 5 now')
    expect(merged.favEx).toContain('0025')
  })
})

describe('sign-in asks about a plan built while signed out, and keeps what it drops', () => {
  const server = () => ({ ...clone(DEF), _ts: Date.now() - 1e6, routines: [{ id: 'sr1', name: 'Push Day', ex: [] }], week: { 1: 'sr1' }, workouts: [{ id: 'sw1', d: '2026-09-01', start: 1, entries: [] }], _rev: 7 })
  const guestPlan = () => {
    up(s => {
      s.routines = [{ id: 'g1', name: 'LOCAL A', ex: [] }, { id: 'g2', name: 'LOCAL B', ex: [] }]
      s.week = { 1: 'g1', 4: 'g2' }
      s.exNotes = { '0025': 'elbows in' }
      s.gymCards = [{ id: 'card1', label: 'FitX', value: '123', fmt: 'qrcode' }]
      s.restSec = 75
    })
  }
  it('a guest with only a plan is asked; "Add them" keeps the routines, the free plan days, notes and cards', async () => {
    guestPlan()
    api.mockImplementation(async (p, o) => (o?.method === 'PUT' ? { ok: true, rev: 8 } : { state: server(), rev: 7 }))
    useStore.getState().setUser({ id: 'u1', name: 'x' }, { adopt: true })
    const ask = vi.fn(async () => true)
    await useStore.getState().adoptProfile(ask)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ routines: 2, setup: 3 }))
    const S = useStore.getState().S
    expect(S.routines.map(r => r.id).sort()).toEqual(['g1', 'g2', 'sr1'])
    expect(S.week).toEqual({ 1: 'sr1', 4: 'g2' })   // the account's Monday, the device's Thursday
    expect(S.exNotes['0025']).toBe('elbows in')
    expect(S.gymCards.map(c => c.id)).toEqual(['card1'])
  })
  it('"Keep profile as is" keeps the device\'s copy aside, to save as a backup file', async () => {
    guestPlan()
    api.mockImplementation(async (p, o) => (o?.method === 'PUT' ? { ok: true, rev: 8 } : { state: server(), rev: 7 }))
    useStore.getState().setUser({ id: 'u1', name: 'x' }, { adopt: true })
    await useStore.getState().adoptProfile(async () => false)
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['sr1'])
    const kept = await useStore.getState().keptChanges()
    expect(kept).toHaveLength(1)
    const state = await useStore.getState().keptState(kept[0].server, kept[0].uid)
    expect(state.routines.map(r => r.id)).toEqual(['g1', 'g2'])
    expect(state.restSec).toBe(75)
  })
})
