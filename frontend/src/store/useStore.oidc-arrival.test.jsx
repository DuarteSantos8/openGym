// @vitest-environment happy-dom

/* Back from the identity provider (#130): the server set the cookie and sent the browser to
   /?oidc=signed-in. Boot takes the flag off the address and treats it as a fresh sign-in, so the
   question about this device's own entries (adoptProfile) comes before anything syncs. A plain
   reload of a signed-in browser is not one. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(async () => 'skip') }))

import { api } from '../lib/api.js'
import { useStore } from './useStore.js'

const bootSignedIn = async () => {
  api.mockImplementation(async path => {
    if (path === '/api/config') return { oidc: { label: 'Authentik' } }
    if (path === '/api/me') return { user: { id: 'u1', name: 'Ana' } }
    if (path === '/api/data') return { state: null }
    return {}
  })
  await useStore.getState().boot()
}

beforeEach(() => { localStorage.clear(); api.mockReset(); useStore.setState({ user: null, ready: false, config: null }) })
afterEach(() => { vi.restoreAllMocks(); history.replaceState({}, '', '/'); useStore.setState({ user: null, ready: false, config: null }) })

describe('boot after a provider sign-in', () => {
  // First: the store keeps module state between tests, and a finished adoption leaves some behind.
  it('a reload without the flag boots as before', async () => {
    history.replaceState({}, '', '/#/')
    const adopt = vi.spyOn(useStore.getState(), 'adoptProfile')
    await bootSignedIn()
    expect(useStore.getState().user?.id).toBe('u1')
    expect(adopt).not.toHaveBeenCalled()
  })
  it('takes ?oidc= off the address and adopts like a sign-in', async () => {
    history.replaceState({}, '', '/?oidc=signed-in#/')
    const adopt = vi.spyOn(useStore.getState(), 'adoptProfile')
    await bootSignedIn()
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#/')
    expect(useStore.getState().user?.id).toBe('u1')
    expect(useStore.getState().ready).toBe(true)
    expect(adopt).toHaveBeenCalled()
  })

})
