// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { phoneSignIn, appPair, startAddress, openForReturn, APP_RETURN } from './oidc-app.js'

/* The phone's provider sign-in (#130): the verifier never leaves the phone, the app state has to
   come back unchanged, and the system browser's way back is waited for on each platform. */
const fixedPair = { verifier: 'v'.repeat(43), challenge: 'c'.repeat(43), astate: 'a'.repeat(24) }

describe('lib/oidc-app', () => {
  it('makes a fresh S256 pair each time', async () => {
    const p = await appPair()
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(p.astate.length).toBeGreaterThanOrEqual(16)
    const want = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p.verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(p.challenge).toBe(want)
    expect((await appPair()).verifier).not.toBe(p.verifier)
  })

  it('asks for the exact return address and sends only the challenge', () => {
    const u = new URL(startAddress('https://gym.example', fixedPair))
    expect(u.pathname).toBe('/api/oidc/start')
    expect(u.searchParams.get('return')).toBe(APP_RETURN)
    expect(u.searchParams.get('challenge')).toBe(fixedPair.challenge)
    expect(u.toString()).not.toContain(fixedPair.verifier)
  })

  it('redeems the code with the verifier when the state comes back', async () => {
    const redeem = vi.fn(async () => ({ token: 't', user: { id: 'u' } }))
    const open = vi.fn(async () => `${APP_RETURN}?code=xyz&astate=${fixedPair.astate}`)
    const r = await phoneSignIn('https://gym.example', 'VoidAuth', { open, redeem, pair: async () => fixedPair })
    expect(r.token).toBe('t')
    expect(redeem).toHaveBeenCalledWith('https://gym.example', 'xyz', fixedPair.verifier)
  })

  it('refuses an answer to another sign-in, and words a refusal', async () => {
    const redeem = vi.fn()
    const other = phoneSignIn('https://g', 'VoidAuth', { open: async () => `${APP_RETURN}?code=x&astate=someone-else`, redeem, pair: async () => fixedPair })
    await expect(other).rejects.toMatchObject({ code: 'state' })
    const refused = phoneSignIn('https://g', 'VoidAuth', { open: async () => `${APP_RETURN}?error=group&astate=${fixedPair.astate}`, redeem, pair: async () => fixedPair })
    await expect(refused).rejects.toMatchObject({ code: 'group', message: expect.stringContaining('VoidAuth') })
    expect(redeem).not.toHaveBeenCalled()
  })

  it('iPhone: the session hands the address back; a cancel is a cancel', async () => {
    const OidcBrowser = { open: vi.fn(async () => ({ url: APP_RETURN + '?code=1' })) }
    expect(await openForReturn('https://x', { OidcBrowser, platform: 'ios' })).toBe(APP_RETURN + '?code=1')
    OidcBrowser.open = vi.fn(async () => { throw Object.assign(new Error('c'), { code: 'cancelled' }) })
    await expect(openForReturn('https://x', { OidcBrowser, platform: 'ios' })).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('Android: waits for opengym://oidc, ignores other links, and a return without one is a cancel', async () => {
    vi.useFakeTimers()
    try {
      const listeners = {}
      const App = { addListener: vi.fn(async (ev, fn) => { listeners[ev] = fn; return { remove: vi.fn(() => { delete listeners[ev] }) } }) }
      const OidcBrowser = { open: vi.fn(async () => ({ opened: true })) }
      const p = openForReturn('https://x', { OidcBrowser, App, platform: 'android' })
      await vi.advanceTimersByTimeAsync(0)
      expect(OidcBrowser.open).toHaveBeenCalledWith({ url: 'https://x' })
      listeners.appUrlOpen({ url: 'opengym://home' })
      listeners.resume()
      listeners.appUrlOpen({ url: APP_RETURN + '?code=9' })
      await expect(p).resolves.toBe(APP_RETURN + '?code=9')
      expect(listeners.appUrlOpen).toBeUndefined()

      const q = openForReturn('https://x', { OidcBrowser, App, platform: 'android' })
      const settled = expect(q).rejects.toMatchObject({ code: 'cancelled' })
      await vi.advanceTimersByTimeAsync(0)
      listeners.resume()
      await vi.advanceTimersByTimeAsync(2000)
      await settled
    } finally { vi.useRealTimers() }
  })
})
