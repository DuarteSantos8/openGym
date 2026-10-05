// @vitest-environment happy-dom

/* The phone build with no server to talk to. Its WebView's own origin is Capacitor's local asset
   server, which answers every path — PUT /api/data included — with index.html and a 200. A phone
   whose pairing was gone sent its pushes there and marked every change as synced. Without a
   paired base, api() now refuses before any request goes out. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./mobile.js', () => ({ MOBILE: true }))

import { api, beacon, setRemoteAuth, webauthnOK } from './api.js'

afterEach(() => { vi.unstubAllGlobals(); setRemoteAuth('', null) })

// No passkey ceremony against the server can succeed from the app's own WebView origin, which
// never matches the server's RP ID - every Settings sheet that offers one hides it by reading this
// one answer, rather than each needing its own MOBILE check beside webauthnOK().
describe('webauthnOK() on the phone build', () => {
  it('is false whatever the WebView itself exposes', () => {
    const originalPKC = window.PublicKeyCredential
    try {
      Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} })
      expect(webauthnOK()).toBe(false)
    } finally {
      Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: originalPKC })
    }
  })
})

describe('api() on the phone build', () => {
  it('without a paired server it refuses with not-paired (status 0) and never calls fetch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(api('/api/data', { method: 'PUT', body: '{}' })).rejects.toMatchObject({ code: 'not-paired', status: 0 })
    await expect(api('/api/me')).rejects.toMatchObject({ code: 'not-paired', status: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('paired, it talks to the server with the pairing token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ rev: 3 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    await expect(api('/api/data/rev')).resolves.toEqual({ rev: 3 })
    expect(fetch.mock.calls[0][0]).toBe('https://gym.example.com/api/data/rev')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer TOKEN')
  })
})

// The workout screen's "left" beacon went to https://localhost/api/activity on every phone, paired
// or not: Capacitor's asset server answered it with index.html (Android QA, v1.3.9).
describe('the "left" beacon on the phone build', () => {
  it('is never sent, paired or not: the api() call beside it is the one that reaches the server', () => {
    const sendBeacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon })
    expect(beacon('/api/activity', { active: false })).toBe(false)
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    expect(beacon('/api/activity', { active: false })).toBe(false)
    expect(sendBeacon).not.toHaveBeenCalled()
  })
})
