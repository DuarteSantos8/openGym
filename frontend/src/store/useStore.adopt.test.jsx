// @vitest-environment happy-dom

/* Signed in, the server's profile is the truth: sign-in adopts it whatever the timestamps say,
   asking only about entries the device logged while signed out; the store polls the revision
   while open and flags offline / unsynced for the banner. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn() }))
const { toast, sheetAsk } = vi.hoisted(() => ({ toast: vi.fn(), sheetAsk: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))
// The question an adoption resumed by the store itself asks (resumeAdoption, checkRev, Sync now).
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: (...a) => sheetAsk(...a) }))

import { api } from '../lib/api.js'
import { DEF, hasData, useStore } from './useStore.js'

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
const guest = { ...clone(DEF), _ts: 900, unit: 'kg', restSec: 120, workouts: [workout('w9', '2026-09-11')], routines: [routine('rg')], week: { 2: ['rg'] } }

beforeEach(() => { localStorage.clear(); api.mockReset(); toast.mockReset(); useStore.setState({ S: clone(DEF), A: null, user: null, ready: false }) })
afterEach(() => { vi.useRealTimers(); localStorage.clear(); useStore.setState({ S: clone(DEF), A: null, user: null, ready: false }) })

describe('adoptProfile — sign-in takes the server profile', () => {
  it('adopts the server copy over newer local data when the user keeps the profile as is', async () => {
    signedIn(clone(guest))
    useStore.getState().setActive({ id: 'running' })   // the in-progress session lives outside S entirely
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    const ask = vi.fn(async () => false)
    const r = await useStore.getState().adoptProfile(ask)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1, bodyweight: 0, customEx: 0 }))
    const S = useStore.getState().S
    expect(S.unit).toBe('lb'); expect(S.restSec).toBe(60)
    expect(S.workouts.map(w => w.id)).toEqual(['w1'])
    expect(S.routines.map(x => x.id)).toEqual(['r1'])
    expect(useStore.getState().A).toMatchObject({ id: 'running' })   // adoptProfile keeps the running session (in the profile's unit)
    expect(puts()).toHaveLength(0)
    expect(sync()).toEqual({ rev: 4, ts: 100 })
    expect(r).toEqual({ adopted: true, added: false })
  })

  it('adds the device\'s entries to the profile when asked to, keeping the profile\'s settings and plan', async () => {
    signedIn(clone(guest))
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })   // read again once answered
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().adoptProfile(async () => true)
    const S = useStore.getState().S
    // the profile's plan, with the device's day added where the profile had nothing planned
    expect(S.unit).toBe('lb'); expect(S.week).toEqual({ 1: ['r1'], 2: ['rg'] })
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

  // A profile joined with a code from somewhere else (#95): whoever sent the code chose it, so a
  // guest's workouts are not moved into it unasked, even when it has nothing yet.
  it('alwaysAsk: asks before moving the device data into an empty profile, and moves nothing when declined', async () => {
    signedIn(clone(guest))
    useStore.getState().setActive({ id: 'running' })
    api.mockResolvedValueOnce({ state: null, rev: 0 })
    const ask = vi.fn(async () => false)
    const r = await useStore.getState().adoptProfile(ask, { alwaysAsk: true })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1, bodyweight: 0, customEx: 0 }))
    expect(puts()).toHaveLength(0)
    const S = useStore.getState().S
    expect(S.workouts).toEqual([])
    expect(S.routines).toEqual([])
    expect(useStore.getState().A).toEqual({ id: 'running' })   // the in-progress session stays with the device
    expect(sync().rev).toBe(0)
    expect(r).toEqual({ adopted: true, added: false })
  })

  // QA, v1.3.9: a guest whose only data was a custom exercise (with its photo) created a profile;
  // the files went up, but the state stayed empty on the server for the next poll to find while
  // Settings said "All synced" — and the server counted the uploaded files as unreferenced.
  it('moves a copy holding only custom exercises into a profile that has no state yet', async () => {
    const onlyCustom = { ...clone(DEF), _ts: 900, customEx: [{ id: 'c1', n: 'sandbag carry', bp: 'back', custom: true, media: { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 3, width: 8, height: 6, at: 1 } }] }
    expect(hasData(onlyCustom)).toBe(true)   // what the register sheets check before pushing
    signedIn(clone(onlyCustom))
    api.mockResolvedValueOnce({ state: null, rev: 0 })
    api.mockResolvedValueOnce({ ok: true, rev: 1 })
    await useStore.getState().adoptProfile(vi.fn())
    expect(puts()).toHaveLength(1)
    expect(puts()[0].state.customEx.map(c => c.id)).toEqual(['c1'])
    expect(puts()[0].state.customEx[0].media.hash).toBe('a'.repeat(64))
    expect(sync().rev).toBe(1)
  })

  it('the first pull after a profile was created pushes a copy holding only custom exercises', async () => {
    signedIn({ ...clone(DEF), _ts: 900, customEx: [{ id: 'c1', n: 'sandbag carry', bp: 'back', custom: true }] })
    api.mockResolvedValueOnce({ state: null, rev: 0 })
    api.mockResolvedValueOnce({ ok: true, rev: 1 })
    await useStore.getState().pullState()
    expect(puts()).toHaveLength(1)
    expect(puts()[0].state.customEx.map(c => c.id)).toEqual(['c1'])
  })

  it('alwaysAsk: moves the device data into an empty profile once the user says so', async () => {
    signedIn(clone(guest))
    api.mockResolvedValueOnce({ state: null, rev: 0 })
    api.mockResolvedValueOnce({ ok: true, rev: 1 })
    const ask = vi.fn(async () => true)
    await useStore.getState().adoptProfile(ask, { alwaysAsk: true })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(puts()).toHaveLength(1)
    expect(puts()[0].state.workouts.map(w => w.id)).toEqual(['w9'])
  })

  it('alwaysAsk: the account this copy already belongs to is not asked about its own data', async () => {
    useStore.setState({ S: clone(guest), ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
    localStorage.setItem('gym_owner', 'user-1')
    useStore.getState().setUser({ id: 'user-1', name: 'Ana' })
    api.mockResolvedValueOnce({ state: null, rev: 0 })
    api.mockResolvedValueOnce({ ok: true, rev: 1 })
    const ask = vi.fn(async () => false)
    await useStore.getState().adoptProfile(ask, { alwaysAsk: true })
    expect(ask).not.toHaveBeenCalled()
    expect(puts()).toHaveLength(1)
    expect(puts()[0].state.workouts.map(w => w.id)).toEqual(['w9'])
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
    expect(toast).toHaveBeenCalledWith('Back online and synced with the server.')
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

// QA, v1.3.9: the sign-in's question was open while a pull ran, and the device's copy — newer by
// its stamp — was pushed over the profile. The web sign-ins hold sync just the same.
describe('web sign-in: nothing syncs while the question is open', () => {
  it('no pull, push or revision check before the answer; Keep takes the server copy as it is then', async () => {
    signedIn(clone(guest), { user: null })
    useStore.getState().setUser({ id: 'user-1' }, { adopt: true })
    expect(JSON.parse(localStorage.getItem('gym_adopt'))).toMatchObject({ uid: 'user-1', rejoined: false })
    let answer
    const ask = vi.fn(() => new Promise(r => { answer = r }))
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    const done = useStore.getState().adoptProfile(ask)
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())

    await useStore.getState().pullState()
    await useStore.getState().pushState()
    window.dispatchEvent(new Event('online'))
    await new Promise(r => setTimeout(r, 10))
    expect(paths()).toEqual(['/api/data'])

    // another device wrote while the question was open
    api.mockResolvedValueOnce({ state: { ...clone(server), _ts: 200, workouts: [workout('w1'), workout('w-other', '2026-09-20')], _rev: 5 }, rev: 5 })
    answer(false)
    await done
    expect(puts()).toHaveLength(0)
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1', 'w-other'])
    expect(sync().rev).toBe(5)
    expect(localStorage.getItem('gym_adopt')).toBeNull()
  })

  it('a sign-in whose adoption could not reach the server keeps sync held and asks again on the next check', async () => {
    signedIn(clone(guest), { user: null })
    useStore.getState().setUser({ id: 'user-1' }, { adopt: true })
    api.mockRejectedValueOnce(netErr())
    await expect(useStore.getState().adoptProfile(vi.fn())).rejects.toThrow()
    await useStore.getState().pullState()
    expect(puts()).toHaveLength(0)
    expect(paths()).toEqual(['/api/data'])
    // back online: the check runs the adoption again, question and all
    const ask = vi.fn(async () => false)
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    await useStore.getState().resumeAdoption(ask)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1, bodyweight: 0, customEx: 0 }))
    expect(puts()).toHaveLength(0)
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1'])
    expect(localStorage.getItem('gym_adopt')).toBeNull()
  })
})

// Review of 771184c9: the hold could outlive the session, and it held back more than the question.
describe('the sign-in hold: never stuck, and only about what the device had', () => {
  const settle = () => new Promise(r => setTimeout(r, 20))

  it('a sign-in whose adoption never started (the pairing failed on the way) runs it on the next check', async () => {
    signedIn(clone(guest), { user: null })
    useStore.getState().setUser({ id: 'user-1' }, { adopt: true })
    expect(useStore.getState().sync.status).toBe('held')
    sheetAsk.mockResolvedValueOnce(false)
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(localStorage.getItem('gym_adopt')).toBeNull())
    await settle()
    expect(sheetAsk).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1, bodyweight: 0, customEx: 0 }))
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1'])
    expect(useStore.getState().sync.status).not.toBe('held')
  })

  it('a bare adoption whose question throws lets go of the hold', async () => {
    signedIn(clone(guest))
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    await expect(useStore.getState().adoptProfile(() => { throw new Error('sheet gone') })).rejects.toThrow('sheet gone')
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    api.mockResolvedValue({ ok: true, rev: 5 })
    await useStore.getState().pullState()
    expect(paths().filter(p => p === '/api/data').length).toBeGreaterThan(1)   // it pulled: not held
    api.mockReset()
  })

  it('what was logged while held is not asked about, and "Keep profile as is" keeps it; Sync now asks the question', async () => {
    signedIn(clone(guest), { user: null })
    useStore.getState().setUser({ id: 'user-1' }, { adopt: true })
    api.mockRejectedValueOnce(netErr())
    await expect(useStore.getState().adoptProfile(vi.fn())).rejects.toThrow()
    // held, the gym goes on: a workout logged on this device, now the account's
    useStore.getState().update(s => { s.workouts.push(workout('w-later', '2026-09-25')) })
    expect(useStore.getState().sync.status).not.toBe('ok')
    sheetAsk.mockResolvedValueOnce(false)
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    api.mockResolvedValueOnce({ state: clone(server), rev: 4 })
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().syncNow()
    expect(sheetAsk).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1, bodyweight: 0, customEx: 0 }))   // w9 only
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1', 'w-later'])
    const put = puts().at(-1)
    expect(put.baseRev).toBe(4)
    expect(put.state.workouts.map(w => w.id)).toEqual(['w1', 'w-later'])
    expect(put.state.unit).toBe('lb')   // the profile's settings
  })
})

// QA, v1.3.9: "Back online — synced with the server" after switching accounts — the push the
// previous account could not make offline was announced by the next account's first push.
describe('the back-online toast belongs to the account that was offline', () => {
  it('is not said after another account signs in', async () => {
    localStorage.setItem('gym_owner', 'user-1')
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    useStore.getState().update(s => { s.restSec = 75 })
    api.mockRejectedValueOnce(netErr())
    await useStore.getState().pushState()
    expect(useStore.getState().sync.offline).toBe(true)

    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    useStore.getState().update(s => { s.workouts.push(workout('w-two')) })
    api.mockResolvedValueOnce({ ok: true, rev: 1 })
    await useStore.getState().pushState()
    await new Promise(r => setTimeout(r, 10))
    expect(toast).not.toHaveBeenCalledWith('Back online and synced with the server.')
  })
})
