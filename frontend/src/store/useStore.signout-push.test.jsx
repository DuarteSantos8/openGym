// @vitest-environment happy-dom

/* Signing out left this browser's push subscription filed under the account, so a shared or lost
   device kept getting its reminders and rest alerts. A sign-out now turns push off here first,
   while the session can still tell the server which row to drop. "Sign out everywhere" turns it
   off here once the server has ended the sessions (and dropped every row itself), so a request
   that fails leaves push as it was. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = []
vi.mock('../lib/api.js', () => ({ api: vi.fn(async path => { calls.push(path); return { ok: true } }), setRemoteAuth: vi.fn() }))
vi.mock('../lib/push.js', async orig => ({ ...(await orig()), pushSupported: () => true, disablePush: vi.fn(async () => { calls.push('disablePush') }) }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => true }))

import { DEF, useStore } from './useStore.js'
import { api } from '../lib/api.js'
import { disablePush } from '../lib/push.js'

const clone = v => JSON.parse(JSON.stringify(v))
beforeEach(() => {
  calls.length = 0
  api.mockImplementation(async path => { calls.push(path); return { ok: true } })
  vi.stubGlobal('Notification', { permission: 'granted' })
  localStorage.clear()
  useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true })
  useStore.getState().setUser({ id: 'u1', name: 'Olga' })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('signing out turns push off in this browser', () => {
  it('sign out: push goes off before the logout request', async () => {
    await useStore.getState().signOut({ force: true })
    expect(calls.filter(c => c === 'disablePush' || c === '/api/logout')).toEqual(['disablePush', '/api/logout'])
  })

  it('sign out everywhere: push goes off after the server ended the sessions', async () => {
    await useStore.getState().signOutAll({ force: true })
    expect(calls.filter(c => c === 'disablePush' || c === '/api/logout/all')).toEqual(['/api/logout/all', 'disablePush'])
  })

  it('sign out everywhere that fails leaves push on', async () => {
    api.mockImplementation(async path => { calls.push(path); if (path === '/api/logout/all') throw new Error('offline'); return { ok: true } })
    await expect(useStore.getState().signOutAll({ force: true })).rejects.toThrow('offline')
    expect(disablePush).not.toHaveBeenCalled()
  })

  it('a browser that never allowed notifications is not asked', async () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    await useStore.getState().signOut({ force: true })
    expect(disablePush).not.toHaveBeenCalled()
  })

  it('a push that cannot be turned off does not stop the sign-out', async () => {
    disablePush.mockRejectedValueOnce(new Error('Service worker not ready'))
    expect(await useStore.getState().signOut({ force: true })).toEqual({ owed: false })
    expect(calls).toContain('/api/logout')
  })
})
