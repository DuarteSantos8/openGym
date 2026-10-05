// @vitest-environment happy-dom

/* A guest who left for the provider from Settings (Account) comes back through a full reload. A
   guest's boot never shows the sign-in screen, so the mark that departure left (lib/guest-departure.js)
   ends guest mode: an identity no profile has yet reaches the screen that names it, and a profile
   that signed in holds sync for the question every sign-in asks about this browser's entries. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
const ask = vi.hoisted(() => ({ fn: null }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: (...a) => ask.fn(...a) }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { markGuestDeparture, takeGuestDeparture } from '../lib/guest-departure.js'

const USER = { id: 'u1', name: 'andi' }
const clone = value => JSON.parse(JSON.stringify(value))
const workout = id => ({ id, d: '2026-09-01', start: 1, entries: [] })
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const boot = async me => {
  api.mockImplementation(async (path, opts) => {
    if (path === '/api/config') return { allow_guest: true }
    if (path === '/api/me') {
      if (me instanceof Error) throw me
      if (me) return { user: me }
      throw Object.assign(new Error('not signed in'), { status: 401 })
    }
    if (path === '/api/data' && opts?.method === 'PUT') return { ok: true, rev: 2 }
    if (path === '/api/data') return { state: { ...clone(DEF), _ts: 100, workouts: [workout('w1')] }, rev: 1 }
    throw new Error('unexpected ' + path)
  })
  await useStore.getState().boot()
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); api.mockReset()
  ask.fn = vi.fn(() => new Promise(() => {}))   // the question stays open
  useStore.setState({ user: null, ready: false, config: null })
  useStore.getState().setGuest(true)
})
afterEach(() => { useStore.setState({ user: null, ready: false, config: null }) })

describe('a guest back from the provider', () => {
  it('with an identity no profile has yet: no longer a guest, so the sign-in screen names it', async () => {
    markGuestDeparture()
    await boot(null)
    expect(useStore.getState().isGuest()).toBe(false)
    expect(useStore.getState().user).toBeNull()
  })

  it('signed in to a profile: this browser\'s entries wait for the question, then go where it says', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 900, workouts: [workout('w9')] } })
    let answer
    ask.fn = vi.fn(() => new Promise(r => { answer = r }))
    markGuestDeparture()
    await boot(USER)
    expect(useStore.getState().user).toEqual(USER)
    await vi.waitFor(() => expect(ask.fn).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1 })))
    expect(useStore.getState().sync.held).toBe(true)
    expect(puts()).toHaveLength(0)
    answer(true)
    await vi.waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0].state.workouts.map(w => w.id).sort()).toEqual(['w1', 'w9'])
  })

  it('a return the server never answered keeps the mark for the reload that reaches it', async () => {
    markGuestDeparture()
    await boot(new TypeError('Failed to fetch'))
    expect(takeGuestDeparture()).toBe(true)
  })

  it('the mark is read once: the next reload is an ordinary one', async () => {
    markGuestDeparture()
    await boot(null)
    useStore.getState().setGuest(true)
    await boot(null)
    expect(useStore.getState().isGuest()).toBe(true)
  })

  it('without the mark a guest stays a guest', async () => {
    await boot(null)
    expect(useStore.getState().isGuest()).toBe(true)
  })
})
