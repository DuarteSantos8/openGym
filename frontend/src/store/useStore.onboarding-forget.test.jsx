// @vitest-environment happy-dom

/* A half-finished onboarding is kept in the tab (lib/onboarding/state.js): a body, a goal, a plan.
   It is its person's alone, so it goes when who is signed in changes and on every sign-out, or the
   next person on a shared device would start from it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => true }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const KEY = 'gains_onboarding'
const clone = v => JSON.parse(JSON.stringify(v))
const keep = () => sessionStorage.setItem(KEY, JSON.stringify({ uid: 'u1', answers: { goal: 'lose', body: {} } }))
const MARIA = { id: 'u1', name: 'Maria' }
const BEA = { id: 'u2', name: 'Bea' }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  api.mockReset()
  api.mockResolvedValue({ ok: true })
  useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true })
})
afterEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('the onboarding kept in the tab', () => {
  it('stays for the same person signing in again, and goes when someone else does', () => {
    useStore.getState().setUser(MARIA)
    keep()
    useStore.getState().setUser({ ...MARIA, name: 'Maria R.' })
    expect(sessionStorage.getItem(KEY)).not.toBeNull()
    useStore.getState().setUser(BEA)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('goes when the session ends without a sign-out (the user is dropped)', () => {
    useStore.getState().setUser(MARIA)
    keep()
    useStore.getState().setUser(null)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('goes on a sign-out', async () => {
    useStore.getState().setUser(MARIA)
    keep()
    expect(await useStore.getState().signOut()).toEqual({ owed: false })
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('goes on a sign-out everywhere', async () => {
    useStore.getState().setUser(MARIA)
    keep()
    expect(await useStore.getState().signOutAll()).toEqual({ owed: false })
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})
