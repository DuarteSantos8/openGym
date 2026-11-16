// @vitest-environment happy-dom

/* A page opened from a device-link QR code (#95) carries the one-time code as ?link=. The web
   boot takes it off the address before anything else can see or keep it — a reload, a bookmark,
   a screenshot of the address bar — and holds it for the sheet that redeems it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { useStore } from './useStore.js'

const bootSignedOut = async () => {
  api.mockImplementation(async path => {
    if (path === '/api/config') return { allow_guest: true }
    if (path === '/api/me') throw Object.assign(new Error('not signed in'), { status: 401 })
    throw new Error('unexpected ' + path)
  })
  await useStore.getState().boot()
}

beforeEach(() => { localStorage.clear(); api.mockReset(); useStore.setState({ user: null, ready: false, config: null, linkCode: null }) })
afterEach(() => { history.replaceState({}, '', '/'); useStore.setState({ user: null, ready: false, config: null, linkCode: null }) })

describe('boot with a device-link code', () => {
  it('takes ?link= off the address, keeps the rest of it, and holds the code for the redeem sheet', async () => {
    history.replaceState({}, '', '/gym/?link=K7WQ-2MZP-4HXA&utm=x#/home')
    await bootSignedOut()
    expect(useStore.getState().linkCode).toBe('K7WQ-2MZP-4HXA')
    expect(window.location.search).toBe('?utm=x')
    expect(window.location.pathname).toBe('/gym/')
    expect(window.location.hash).toBe('#/home')
    expect(useStore.getState().ready).toBe(true)
  })

  it('leaves the address and the store alone without one', async () => {
    history.replaceState({}, '', '/?utm=x')
    await bootSignedOut()
    expect(useStore.getState().linkCode).toBeNull()
    expect(window.location.search).toBe('?utm=x')
  })
})
