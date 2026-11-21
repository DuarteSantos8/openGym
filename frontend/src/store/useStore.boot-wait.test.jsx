// @vitest-environment happy-dom

/* How long the web boot waits for the server. The boot screen gives up after 10 s (index.html);
   a server that never answers (down behind a proxy that holds the connection open) used to cost
   the full request timeout for /api/config and again for /api/me, so the app came up after
   40 s, behind that error. Now, for someone signed out (the only one who waits on that screen:
   App hides it at once for a signed-in copy or a guest), the boot's requests share one short
   budget, and the config is asked again afterwards with the usual timeout. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
// A provider sign-in arriving asks about this device's entries (sheets.jsx): answered at once here.
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(async () => 'keep') }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast, stopRest: vi.fn(), abandonWork: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { guestAllowed } from '../lib/guest.js'

const clone = value => JSON.parse(JSON.stringify(value))
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
// What lib/api.js throws when a request runs out of time: no status, code 'timeout'.
const timedOut = () => Object.assign(new Error('The server did not answer in time.'), { code: 'timeout' })
// A server that never answers: every request runs out of time, after the timeout it was given
// or lib/api.js's own (20 s for a GET, 60 s otherwise).
const silent = () => api.mockImplementation((path, o) => new Promise((_, reject) => {
  const ms = o?.timeout ?? ((o?.method || 'GET') === 'GET' ? 20000 : 60000)
  setTimeout(() => reject(timedOut()), ms)
}))
const waits = () => api.mock.calls.map(([p, o]) => [p, o?.timeout])

beforeEach(() => {
  localStorage.clear()
  api.mockReset(); toast.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})

// A server that answers each path after `after[path]` ms, unless the request gave up first.
const slow = (after, answers) => api.mockImplementation((path, o) => new Promise((resolve, reject) => {
  const ms = o?.timeout ?? ((o?.method || 'GET') === 'GET' ? 20000 : 60000)
  if (after[path] < ms) setTimeout(() => (answers[path] instanceof Error ? reject(answers[path]) : resolve(answers[path])), after[path])
  else setTimeout(() => reject(timedOut()), ms)
}))
const unauth = () => Object.assign(new Error('HTTP 401'), { status: 401 })

// Runs boot() against the server (silent unless `server` set one up) and returns how long, in
// fake time, it took to be ready.
async function bootSilently(server = silent) {
  vi.useFakeTimers()
  server()
  const started = Date.now()
  let done = false
  useStore.getState().boot().then(() => { done = true })
  for (let i = 0; i < 1200 && !done; i++) await vi.advanceTimersByTimeAsync(100)
  const took = Date.now() - started
  // Let what boot left running (the config asked again) settle, so the next test starts clean.
  await vi.advanceTimersByTimeAsync(61000)
  return { done, took }
}

describe('boot with a server that does not answer', () => {
  it('someone signed out gets the sign-in screen in well under the boot screen’s 10 s', async () => {
    const { done, took } = await bootSilently()
    expect(done).toBe(true)
    expect(useStore.getState().ready).toBe(true)
    expect(took).toBeLessThanOrEqual(7000)
    // The config is asked again at once, with the usual timeout, for the sign-in screen.
    expect(waits()).toEqual([['/api/config', 5000], ['/api/config', undefined], ['/api/me', 1500]])
  })

  it('a signed-in copy, already on screen, keeps the usual timeouts and its data', async () => {
    const S = { ...clone(DEF), _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01', start: 1, entries: [] }] }
    localStorage.setItem('gym_owner', USER.id)
    useStore.setState({ S, user: USER })
    const { done } = await bootSilently()
    expect(done).toBe(true)
    expect(waits()).toEqual([['/api/config', undefined], ['/api/me', undefined]])
    const st = useStore.getState()
    expect(st.user).toEqual(USER)                       // kept, not signed out
    expect(st.S.workouts.map(w => w.id)).toEqual(['w1'])
    expect(st.sync.lastError).toMatchObject({ code: 'timeout' })
  })

  it('a guest, already on screen, keeps the usual timeouts', async () => {
    localStorage.setItem('gym_guest', '1')
    useStore.getState().setGuest(true)
    const { done } = await bootSilently()
    expect(done).toBe(true)
    expect(waits()[0]).toEqual(['/api/config', undefined])
  })

  it('a provider sign-in arriving is not cut short', async () => {
    window.history.replaceState(null, '', '/?oidc=signed-in')
    try {
      const { done } = await bootSilently(() => slow({ '/api/config': 4500, '/api/me': 2500 }, { '/api/config': { allow_guest: true, oidc: true }, '/api/me': { user: USER } }))
      expect(done).toBe(true)
      expect(waits().slice(0, 2)).toEqual([['/api/config', undefined], ['/api/me', undefined]])
      expect(useStore.getState().user).toEqual(USER)
    } finally { window.history.replaceState(null, '', '/') }
  })

  it('a sign-out still owed waits no longer than the rest', async () => {
    localStorage.setItem('gym_logout_owed', '1')
    const { done, took } = await bootSilently()
    expect(done).toBe(true)
    expect(took).toBeLessThanOrEqual(7000)
    expect(waits().map(([p]) => p)).toEqual(['/api/config', '/api/config', '/api/logout'])
    expect(localStorage.getItem('gym_logout_owed')).toBe('1')   // still owed
  })
})

describe('boot with a server that answers', () => {
  it('a config that comes in after the budget still reaches the sign-in screen', async () => {
    const cfg = { allow_guest: false, password: true }
    const { done, took } = await bootSilently(() => slow({ '/api/config': 6000, '/api/me': 300 }, { '/api/config': cfg, '/api/me': unauth() }))
    expect(done).toBe(true)
    expect(took).toBeLessThanOrEqual(7000)
    expect(useStore.getState().config).toEqual(cfg)
    expect(waits().filter(([p]) => p === '/api/config')).toEqual([['/api/config', 5000], ['/api/config', undefined]])
  })

  it('a guest who went in before a late “no guests” answer is shown the sign-in screen', async () => {
    vi.useFakeTimers()
    slow({ '/api/config': 6000, '/api/me': 300 }, { '/api/config': { allow_guest: false }, '/api/me': unauth() })
    let done = false
    useStore.getState().boot().then(() => { done = true })
    for (let i = 0; i < 100 && !done; i++) await vi.advanceTimersByTimeAsync(100)
    expect(done).toBe(true)
    expect(guestAllowed(useStore.getState().config)).toBe(true)   // nothing known yet: the door stays open
    useStore.getState().setGuest(true)                            // "Continue without account"
    await vi.advanceTimersByTimeAsync(7000)
    expect(useStore.getState().config).toEqual({ allow_guest: false })
    expect(useStore.getState().isGuest()).toBe(false)
  })

  it('signing in while that config is still on its way still gets the signed-in one (the Coach)', async () => {
    let n = 0
    vi.useFakeTimers()
    api.mockImplementation((path, o) => new Promise((resolve, reject) => {
      if (path !== '/api/config') return setTimeout(() => reject(unauth()), 100)
      n++
      if (n === 1) return setTimeout(() => reject(timedOut()), o?.timeout ?? 20000)   // boot's, past the budget
      setTimeout(() => resolve(n === 2 ? { allow_guest: true } : { allow_guest: true, coach: null }), 3000)
    }))
    let done = false
    useStore.getState().boot().then(() => { done = true })
    for (let i = 0; i < 100 && !done; i++) await vi.advanceTimersByTimeAsync(100)
    expect(done).toBe(true)
    useStore.getState().setUser(USER)   // a passkey sign-in while the config asked again is out
    await vi.advanceTimersByTimeAsync(10000)
    expect(useStore.getState().config).toEqual({ allow_guest: true, coach: null })
    expect(n).toBe(3)
  })

  it('asks the same questions as before, each with time to answer on a slow network', async () => {
    api.mockImplementation(async path => {
      if (path === '/api/config') return { allow_guest: true }
      if (path === '/api/me') throw unauth()
      throw new Error('unexpected ' + path)
    })
    await useStore.getState().boot()
    expect(waits().map(([p]) => p)).toEqual(['/api/config', '/api/me'])
    for (const [path, ms] of waits()) expect(ms, path).toBeGreaterThanOrEqual(4000)
    expect(useStore.getState().ready).toBe(true)
  })
})
