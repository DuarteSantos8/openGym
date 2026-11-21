// @vitest-environment happy-dom

/* Ironvane: Today's body picker keeps a full-body photo (IndexedDB 'ironvane-body') and the picked
   areas (localStorage) on this device, outside the synced state. A sign-out says the account's data
   is removed from this browser, and on a shared device the next person must not find the previous
   person's photo on Today, so a sign-out forgets both. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => ({ ok: true })), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => true }))

import { DEF, useStore } from './useStore.js'
import { FOCUS_KEY } from '../lib/body-focus.js'

const clone = v => JSON.parse(JSON.stringify(v))
let idb
beforeEach(() => {
  localStorage.clear()
  idb = { deleteDatabase: vi.fn(() => { const r = {}; setTimeout(() => r.onsuccess?.(), 0); return r }) }
  globalThis.indexedDB = idb
  useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true })
})
afterEach(() => { localStorage.clear(); delete globalThis.indexedDB; useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('signing out forgets the body picker', () => {
  it('no photo and no picks are left for the next account', async () => {
    useStore.getState().setUser({ id: 'u1', name: 'Olga' })
    localStorage.setItem(FOCUS_KEY, JSON.stringify({ areas: ['glutes'], view: 'back' }))
    await useStore.getState().signOut({ force: true })
    await new Promise(r => setTimeout(r, 0))
    expect(localStorage.getItem(FOCUS_KEY)).toBeNull()
    expect(idb.deleteDatabase).toHaveBeenCalledWith('ironvane-body')
  })

  it('a different account signing in after an expired session does not see the previous photo', async () => {
    localStorage.setItem('gym_owner', 'u1')
    localStorage.setItem(FOCUS_KEY, JSON.stringify({ areas: ['glutes'], view: 'front' }))
    useStore.getState().setUser({ id: 'u2', name: 'Bea' })
    await new Promise(r => setTimeout(r, 0))
    expect(localStorage.getItem(FOCUS_KEY)).toBeNull()
    expect(idb.deleteDatabase).toHaveBeenCalledWith('ironvane-body')
  })

  it('the same account coming back keeps its photo and picks', async () => {
    localStorage.setItem('gym_owner', 'u1')
    localStorage.setItem(FOCUS_KEY, JSON.stringify({ areas: ['glutes'], view: 'front' }))
    useStore.getState().setUser({ id: 'u1', name: 'Olga' })
    await new Promise(r => setTimeout(r, 0))
    expect(localStorage.getItem(FOCUS_KEY)).not.toBeNull()
    expect(idb.deleteDatabase).not.toHaveBeenCalled()
  })
})
