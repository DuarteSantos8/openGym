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

  it('regression: resetting an account preserves the guest workouts on sign-out', async () => {
    doc = { ...JSON.parse(JSON.stringify(DEF)), _ts: 50, restSec: 70, routines: [{ id: 'ra', name: 'A', ex: [] }], _rev: 2 }
    rev = 2
    serve()
    seedGuest()
    signIn('acct-a', 'A')
    await useStore.getState().adoptProfile(vi.fn(async () => true))
    await useStore.getState().pushState()
    await useStore.getState().resetEverything()
    await useStore.getState().pushState()
    await useStore.getState().signOut({ force: true })
    useStore.getState().setGuest(true)
    await reload()
    expect(guestIds()).toEqual(G_IDS)
  })

  it('creating a profile preserves the current guest copy, including guest deletions', async () => {
    serve()
    seedGuest()
    signIn('acct-a', 'A')
    await useStore.getState().signOut({ force: true })
    useStore.getState().setGuest(true)
    useStore.getState().update(s => { s.workouts = s.workouts.slice(1) }, false)
    useStore.getState().setUser({ id: 'new-account', name: 'New' })
    await useStore.getState().signOut({ force: true })
    expect(guestIds()).toEqual(G_IDS.slice(1))
  })

  it('a refused backup write stops account adoption and preserves the guest workouts across reload', async () => {
    serve()
    seedGuest()
    const write = localStorage.setItem.bind(localStorage)
    const refuse = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'gym_guest_state') throw new DOMException('quota', 'QuotaExceededError')
      write(key, value)
    })
    try {
      expect(() => signIn('acct-a', 'A')).toThrow('Could not save')
      expect(useStore.getState().user).toBeNull()
      expect(localStorage.getItem('gym_owner')).toBeNull()
      expect(api.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false)
      await reload()
      expect(guestIds()).toEqual(G_IDS)
    } finally { refuse.mockRestore() }
  })

  it('keeps a workout saved by another guest tab just before sign-in', async () => {
    serve()
    seedGuest()
    const latest = JSON.parse(localStorage.getItem('gym_state_v1'))
    latest.workouts.push(w('G-extra', '2026-11-15'))
    latest._ts += 1
    localStorage.setItem('gym_state_v1', JSON.stringify(latest))
    localStorage.setItem('gym_state_wid', 'second-guest-tab')
    signIn('acct-a', 'A')
    await useStore.getState().signOut({ force: true })
    await reload()
    expect(guestIds()).toEqual([...G_IDS, 'G-extra'])
  })

  it('guest reset still clears active training when removal of the old guest snapshot is denied', async () => {
    seedGuest()
    const remove = localStorage.removeItem.bind(localStorage)
    const deny = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
      if (key === 'gym_guest_state') throw new DOMException('denied', 'SecurityError')
      remove(key)
    })
    try {
      await useStore.getState().resetEverything()
      expect(guestIds()).toEqual([])
    } finally { deny.mockRestore() }
  })

  it('ends a refused web sign-in even at full quota, and a later sign-in can retry', async () => {
    seedGuest()
    let active = true
    let logoutAttempts = 0
    const user = { id: 'acct-a', name: 'A' }
    api.mockImplementation(async path => {
      if (path === '/api/logout') {
        if (++logoutAttempts === 1) throw netErr()
        active = false
        return {}
      }
      if (path === '/api/config') return { allow_guest: true, signed_in: active }
      if (path === '/api/me' && active) return { user }
      throw Object.assign(new Error('signed out'), { status: 401 })
    })
    const deny = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try {
      expect(() => signIn(user.id, user.name)).toThrow('Could not save')
    } finally { deny.mockRestore() }
    await reload()
    await useStore.getState().boot()
    expect(logoutAttempts).toBe(2)
    expect(active).toBe(false)
    expect(useStore.getState().user).toBeNull()
    expect(guestIds()).toEqual(G_IDS)
    active = true
    signIn(user.id, user.name)
    expect(useStore.getState().user).toEqual(user)
  })

  it.each([true, false])('waits for old cookie cleanup before OIDC retry and boot (first logout succeeds: %s)', async firstSucceeds => {
    seedGuest()
    const { startWebSignIn } = await import('../lib/oidc.js')
    const user = { id: 'acct-a', name: 'A' }
    let releaseLogout, signedIn = true, attempts = 0
    api.mockImplementation(async path => {
      if (path === '/api/logout') {
        if (++attempts === 1) {
          await new Promise(resolve => { releaseLogout = resolve })
          if (!firstSucceeds) throw netErr()
        }
        signedIn = false
        return {}
      }
      if (path === '/api/config') return { allow_guest: true, signed_in: signedIn, oidc: {}, coach: null }
      if (path === '/api/me' && signedIn) return { user }
      if (path === '/api/data') return { state: clone(DEF), rev: 1 }
      return {}
    })
    const deny = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try { expect(() => signIn(user.id, user.name)).toThrow('Could not save') } finally { deny.mockRestore() }
    const navigate = vi.fn(() => {
      signedIn = true
      window.history.replaceState(null, '', '/?oidc=signed-in')
    })
    try {
      const retry = startWebSignIn('web', navigate)
      expect(navigate).not.toHaveBeenCalled()
      releaseLogout()
      await retry
      expect(navigate).toHaveBeenCalledOnce()
      expect(sessionStorage.getItem('gym_logout_owed')).toBeNull()
      await reload()
      await useStore.getState().boot()
      expect(useStore.getState().user).toEqual(user)
      expect(attempts).toBe(firstSucceeds ? 1 : 2)
    } finally { releaseLogout?.(); window.history.replaceState(null, '', '/') }
  })

  it('a guest whose only training record is a day photo keeps it after sign-in and sign-out', async () => {
    serve()
    const hash = 'e'.repeat(64)
    const photo = { id: 'guest-photo', d: '2026-11-26', m: {
      kind: 'image', hash, mime: 'image/webp', size: 1, width: 8, height: 8, at: 1,
    } }
    useStore.getState().setGuest(true)
    useStore.getState().update(s => { s.dayPhotos = { [photo.id]: photo } }, false)
    signIn('acct-a', 'A')
    expect(await useStore.getState().stashedMediaHashes()).toContain(hash)
    await useStore.getState().signOut({ force: true })
    await reload()
    expect(useStore.getState().S.dayPhotos).toEqual({ [photo.id]: photo })
  })

  it('a second tab signing in cancels the first tab’s old fallback logout on reload', async () => {
    const { logoutOwed } = await import('../lib/cookie-cleanup.js')
    const write = localStorage.setItem.bind(localStorage)
    const deny = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'gym_logout_owed') throw new DOMException('full', 'QuotaExceededError')
      write(key, value)
    })
    try { logoutOwed(true) } finally { deny.mockRestore() }
    expect(logoutOwed()).toBe(true)
    const key = 'gym_logout_owed'
    const firstTabMarker = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    signIn('acct-b', 'B')
    sessionStorage.setItem(key, firstTabMarker)
    api.mockImplementation(async path => {
      if (path === '/api/config') return { signed_in: true, allow_guest: true, coach: null }
      if (path === '/api/me') return { user: { id: 'acct-b', name: 'B' } }
      return { state: null, rev: 0 }
    })
    try {
      await reload()
      await useStore.getState().boot()
      expect(api.mock.calls.filter(([path]) => path === '/api/logout')).toEqual([])
      expect(useStore.getState().user.id).toBe('acct-b')
    } finally { sessionStorage.removeItem(key) }
  })

  it('sign-out keeps actual guest media bytes and removes private account media', async () => {
    const { createMediaStore, memoryBackend, _setMediaStore } = await import('../lib/media-store.js')
    const media = createMediaStore(memoryBackend())
    _setMediaStore(media)
    const guestHash = 'a'.repeat(64), accountHash = 'b'.repeat(64)
    try {
      serve()
      seedGuest()
      useStore.getState().update(s => {
        s.customEx = [{ id: 'guest-ex', n: 'Guest', custom: true, media: {
          kind: 'image', hash: guestHash, mime: 'image/webp', size: 1, width: 8, height: 6, at: 1,
        } }]
      }, false)
      for (const hash of [guestHash, accountHash]) await media.put(hash, new Blob(['x']), { mime: 'image/webp', pending: false })
      doc = { ...clone(DEF), _ts: 50, routines: [{ id: 'a', name: 'A', ex: [] }] }
      rev = 2
      signIn('acct-a', 'A')
      await useStore.getState().adoptProfile(vi.fn(async () => true))
      await useStore.getState().pushState()
      expect(await useStore.getState().signOut()).toEqual({ owed: false })
      await vi.waitFor(async () => expect(await media.has(accountHash)).toBe(false))
      expect(await media.has(guestHash)).toBe(true)
    } finally { _setMediaStore(null) }
  })

})
