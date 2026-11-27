// @vitest-environment happy-dom

/* Owner decision 2026-11-27 (task 01.01/01.02): importing a guest's workouts into an account
   copies them — it never consumes the guest profile. After sign-out the original guest workouts
   are back in guest History after reload, on their original dates; workouts logged while signed in
   to an account stay private to that account, absent from guest History and from any other
   account. Each test runs in its own browser storage (localStorage.clear per test).
   Fixture: guest G01–G10 (2026-11-01…10), A-only A11 (2026-11-15), B baseline B01 (2026-11-20). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { api, toast } = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api, setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast, stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

let { DEF, useStore } = await import('./useStore.js')

const clone = v => JSON.parse(JSON.stringify(v))
const ids = xs => (xs || []).map(x => x.id)
const w = (id, d) => ({ id, d, start: 1, end: 2, entries: [] })
const GUEST = Array.from({ length: 10 }, (_, i) => w('G' + String(i + 1).padStart(2, '0'), '2026-11-' + String(i + 1).padStart(2, '0')))
const G_IDS = GUEST.map(x => x.id)
const netErr = () => new TypeError('Failed to fetch')

// A tiny server behind the api mock: GET /api/data answers {state, rev}, PUT takes the document.
let doc, rev
const serve = () => api.mockImplementation(async (path, o = {}) => {
  if (path === '/api/logout') return {}
  if ((o?.method || 'GET') === 'PUT') { doc = JSON.parse(o.body).state; rev += 1; return { ok: true, rev } }
  return { state: doc ? JSON.parse(JSON.stringify(doc)) : null, rev }
})

// A reload: a fresh store module over the same storage, the way a page reload reads gym_state_v1.
const reload = async () => {
  vi.resetModules()
  ;({ DEF, useStore } = await import('./useStore.js'))
  return useStore
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  ;({ DEF, useStore } = await import('./useStore.js'))
  api.mockReset(); toast.mockReset()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null, ready: true })
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

const seedGuest = () => {
  useStore.getState().setGuest(true)
  useStore.getState().update(s => { s.workouts = JSON.parse(JSON.stringify(GUEST)) }, false)
}
const signIn = (id, name) => useStore.getState().setUser({ id, name }, { adopt: true })
const logA11 = () => useStore.getState().update(s => { s.workouts.push(w('A11', '2026-11-15')) })
const guestIds = () => ids(useStore.getState().S.workouts)

describe('guest training after import — owner contract 2026-11-27', () => {
  it('regression: Add them copies G01–G10 to the account and returns them to guest History after sign-out and reload', async () => {
    // A's server profile already exists (a state of its own), so the import question is asked.
    doc = { ...JSON.parse(JSON.stringify(DEF)), _ts: 50, restSec: 70, routines: [{ id: 'ra', name: 'A', ex: [] }], _rev: 2 }
    rev = 2
    serve()
    seedGuest()
    expect(guestIds()).toEqual(G_IDS)

    // Sign in to A and choose "Add them"
    signIn('acct-a', 'A')
    const ask = vi.fn(async () => true)
    const r = await useStore.getState().adoptProfile(ask)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 10 }))
    expect(r).toEqual({ adopted: true, added: true })
    expect(guestIds()).toEqual(G_IDS)   // copies on the profile, originals still here
    expect(doc.workouts.map(x => x.id)).toEqual(G_IDS)   // and on the server

    // A-only training: A11 goes to A's profile only
    logA11()
    await useStore.getState().pushState()
    expect(ids(doc.workouts).sort()).toEqual([...G_IDS, 'A11'].sort())

    // Reload offline: the device copy stands on its own
    api.mockImplementationOnce(async () => { throw netErr() })
    await reload()
    expect(guestIds().sort()).toEqual([...G_IDS, 'A11'].sort())

    // Reconnect
    serve()
    await useStore.getState().pushState()

    // Sign out, "Continue without account", reload: the original guest profile is back
    await useStore.getState().signOut({ force: true })
    useStore.getState().setGuest(true)
    await reload()
    expect(guestIds()).toEqual(G_IDS)   // exactly the ten originals, on their dates
    expect(useStore.getState().S.workouts.map(x => x.d)).toEqual(GUEST.map(x => x.d))
    expect(new Set(guestIds()).size).toBe(10)   // no duplicates, no A11

    // Account switch in the same browser, no storage clearing: B keeps its own baseline
    doc = { ...JSON.parse(JSON.stringify(DEF)), _ts: 60, workouts: [w('B01', '2026-11-20')], _rev: 4 }
    rev = 4
    serve()
    api.mockClear()   // count only what B's adoption does
    signIn('acct-b', 'B')
    const askB = vi.fn(async () => false)   // "Keep profile as is"
    await useStore.getState().adoptProfile(askB)
    expect(askB).toHaveBeenCalledWith(expect.objectContaining({ workouts: 10 }))
    expect(guestIds()).toEqual(['B01'])   // B sees B01 only — no G, no A11
    expect(api.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0)   // nothing imported

    // ...and the guest profile is still intact for the next sign-out
    await useStore.getState().signOut({ force: true })
    useStore.getState().setGuest(true)
    await reload()
    expect(guestIds()).toEqual(G_IDS)
  })

  it('regression: Keep profile as is leaves both profiles alone, and A11 stays private to A', async () => {
    doc = { ...JSON.parse(JSON.stringify(DEF)), _ts: 50, restSec: 70, routines: [{ id: 'ra', name: 'A', ex: [] }], _rev: 2 }
    rev = 2
    serve()
    seedGuest()

    // Sign in to A and choose "Keep profile as is"
    signIn('acct-a', 'A')
    const ask = vi.fn(async () => false)
    const r = await useStore.getState().adoptProfile(ask)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 10 }))
    expect(r).toEqual({ adopted: true, added: false })
    expect(guestIds()).toEqual([])   // A's profile is untouched — nothing imported
    expect(doc.workouts).toEqual([])   // and the server was not given the guest workouts
    expect(api.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0)

    // A-only training
    logA11()
    await useStore.getState().pushState()

    // Sign out, "Continue without account", reload: the guest profile kept its workouts
    await useStore.getState().signOut({ force: true })
    useStore.getState().setGuest(true)
    await reload()
    expect(guestIds()).toEqual(G_IDS)
    expect(guestIds()).not.toContain('A11')
    expect(new Set(guestIds()).size).toBe(10)
  })

  // "Reset everything" leaves nothing on this device — the guest profile kept across a sign-in is
  // device data too, and must not come back at the next sign-out.
  it('regression: Reset everything keeps nothing of the guest profile for the next sign-out', async () => {
    doc = { ...JSON.parse(JSON.stringify(DEF)), _ts: 50, restSec: 70, routines: [{ id: 'ra', name: 'A', ex: [] }], _rev: 2 }
    rev = 2
    serve()
    seedGuest()
    signIn('acct-a', 'A')
    await useStore.getState().adoptProfile(vi.fn(async () => true))
    await useStore.getState().pushState()
    useStore.getState().resetEverything()
    await useStore.getState().pushState()
    await useStore.getState().signOut({ force: true })
    useStore.getState().setGuest(true)
    await reload()
    expect(guestIds()).toEqual([])
  })
})
