// @vitest-environment happy-dom

/* How long the web boot waits for the server. The boot screen gives up after 10 s (index.html);
   a server that never answers (down behind a proxy that holds the connection open) used to cost
   the full request timeout for /api/config and again for /api/me, so the app came up after
   40 s, behind that error. Now the boot's requests share one short budget, and past it the app
   starts on this browser's copy. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast, stopRest: vi.fn(), abandonWork: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

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

// Runs boot() against the silent server and returns how long (fake time) it took to be ready.
async function bootSilently() {
  vi.useFakeTimers()
  silent()
  const started = Date.now()
  let done = false
  useStore.getState().boot().then(() => { done = true })
  for (let i = 0; i < 1200 && !done; i++) await vi.advanceTimersByTimeAsync(100)
  return { done, took: Date.now() - started }
}

describe('boot with a server that does not answer', () => {
  it('a guest gets the app in well under the boot screen’s 10 s', async () => {
    const { done, took } = await bootSilently()
    expect(done).toBe(true)
    expect(useStore.getState().ready).toBe(true)
    expect(took).toBeLessThanOrEqual(7000)
    for (const [path, ms] of waits()) expect(ms, path).toBeGreaterThan(0)
  })

  it('a signed-in copy starts on this browser and says the server did not answer', async () => {
    const S = { ...clone(DEF), _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01', start: 1, entries: [] }] }
    localStorage.setItem('gym_owner', USER.id)
    useStore.setState({ S, user: USER })
    const { done, took } = await bootSilently()
    expect(done).toBe(true)
    expect(took).toBeLessThanOrEqual(7000)
    const st = useStore.getState()
    expect(st.ready).toBe(true)
    expect(st.user).toEqual(USER)                       // kept, not signed out
    expect(st.S.workouts.map(w => w.id)).toEqual(['w1'])
    expect(st.sync.lastError).toMatchObject({ code: 'timeout' })
  })

  it('a sign-out still owed waits no longer than the rest', async () => {
    localStorage.setItem('gym_logout_owed', '1')
    const { done, took } = await bootSilently()
    expect(done).toBe(true)
    expect(took).toBeLessThanOrEqual(7000)
    expect(waits().map(([p]) => p)).toEqual(['/api/config', '/api/logout'])
    expect(localStorage.getItem('gym_logout_owed')).toBe('1')   // still owed
  })
})

describe('boot with a server that answers', () => {
  it('asks the same questions as before, each with time to answer on a slow network', async () => {
    api.mockImplementation(async path => {
      if (path === '/api/config') return { allow_guest: true }
      if (path === '/api/me') throw Object.assign(new Error('HTTP 401'), { status: 401 })
      throw new Error('unexpected ' + path)
    })
    await useStore.getState().boot()
    expect(waits().map(([p]) => p)).toEqual(['/api/config', '/api/me'])
    for (const [path, ms] of waits()) expect(ms, path).toBeGreaterThanOrEqual(4000)
    expect(useStore.getState().ready).toBe(true)
  })
})
