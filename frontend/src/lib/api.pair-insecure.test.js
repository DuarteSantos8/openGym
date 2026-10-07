// @vitest-environment happy-dom
// #329: the app's WebView is an https:// page with mixed content off, so pairing with a plain
// http:// address is refused before anything is sent. "Could not reach" sent people looking for
// a network problem; the message says it is the http:// instead.
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ native: true }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => (h.native ? 'android' : 'web'), isNativePlatform: () => h.native },
  CapacitorHttp: { request: () => Promise.reject(new Error('mixed content')) },
  registerPlugin: () => ({}),
}))

const { pairRedeem } = await import('./api.js')

afterEach(() => { vi.unstubAllGlobals(); h.native = true })
const failed = () => Promise.reject(new TypeError('Failed to fetch'))
const MSG = 'The app can only pair with an https:// address. Your phone blocks plain http:// before anything is even sent.'

describe('pairRedeem from the phone app with an http:// address', () => {
  it('says the app needs https://, without probing', async () => {
    const fetch = vi.fn(failed)
    vi.stubGlobal('fetch', fetch)
    const e = await pairRedeem('http://192.168.1.20:8080', 'ABCD2345').catch(x => x)
    expect(e.code).toBe('insecure')
    expect(e.message).toBe(MSG)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('an https:// address that fails is still probed as before', async () => {
    vi.stubGlobal('fetch', vi.fn(failed))
    const e = await pairRedeem('https://gym.example.com', 'ABCD2345', { probeMs: 20 }).catch(x => x)
    expect(e.code).toBe('unreachable')
  })

  it('http://localhost counts as secure and is not blamed', async () => {
    vi.stubGlobal('fetch', vi.fn(failed))
    const e = await pairRedeem('http://localhost:8080', 'ABCD2345', { probeMs: 20 }).catch(x => x)
    expect(e.code).toBe('unreachable')
  })

  it('a server that answers over http:// is passed on as it is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid or expired code' }), { status: 400, headers: { 'content-type': 'application/json' } })))
    await expect(pairRedeem('http://192.168.1.20:8080', 'ABCD2345')).rejects.toMatchObject({ status: 400 })
  })

  it('off the native app the http:// case is not claimed', async () => {
    h.native = false
    vi.stubGlobal('fetch', vi.fn(failed))
    const e = await pairRedeem('http://192.168.1.20:8080', 'ABCD2345', { probeMs: 20 }).catch(x => x)
    expect(e.code).toBe('unreachable')
  })
})
