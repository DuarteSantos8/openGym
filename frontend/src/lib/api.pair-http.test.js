// @vitest-environment happy-dom
// #428, #329: the phone app pairs with a plain http:// server too (the Android WebView allows the
// mixed content and the cleartext now), so an http:// address that fails is probed like any
// other instead of being blamed on http. And a home server typed without a scheme is tried as
// https://, which a plain-http server never answers: that failure says to type http:// instead.
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ native: true }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => (h.native ? 'android' : 'web'), isNativePlatform: () => h.native },
  CapacitorHttp: { request: () => Promise.reject(new Error('unreachable')) },
  registerPlugin: () => ({}),
}))

const { pairRedeem, looksLocal } = await import('./api.js')

afterEach(() => { vi.unstubAllGlobals(); h.native = true })
const failed = () => Promise.reject(new TypeError('Failed to fetch'))
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('pairRedeem from the phone app with an http:// address', () => {
  it('pairs: the request goes out to the http:// address as typed', async () => {
    const fetch = vi.fn(async () => json({ token: 'T', user: { id: 'u1', name: 'andi' } }, 200))
    vi.stubGlobal('fetch', fetch)
    const r = await pairRedeem('http://192.168.1.20:8080', 'ABCD2345')
    expect(r.token).toBe('T')
    expect(fetch.mock.calls[0][0]).toBe('http://192.168.1.20:8080/api/pair/redeem')
  })

  it('a failure is probed like any other address, never blamed on http', async () => {
    const fetch = vi.fn(failed)
    vi.stubGlobal('fetch', fetch)
    const e = await pairRedeem('http://192.168.1.20:8080', 'ABCD2345', { probeMs: 20 }).catch(x => x)
    expect(e.code).toBe('unreachable')
    expect(e.message).toBe('Could not reach 192.168.1.20:8080. Check the address and that this phone can reach it.')
    expect(fetch.mock.calls[1][0]).toBe('http://192.168.1.20:8080/api/health')
  })

  it('a server that answers over http:// is passed on as it is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'invalid or expired code' }, 400)))
    await expect(pairRedeem('http://192.168.1.20:8080', 'ABCD2345')).rejects.toMatchObject({ status: 400 })
  })
})

describe('an https:// try at a home address that gets nowhere', () => {
  it.each(['https://192.168.1.20:8080', 'https://nas:8080', 'https://gym.local', 'https://10.0.0.5'])('%s: suggests http://', async base => {
    vi.stubGlobal('fetch', vi.fn(failed))
    const e = await pairRedeem(base, 'ABCD2345', { probeMs: 20 }).catch(x => x)
    const host = base.slice('https://'.length)
    expect(e.code).toBe('unreachable')
    expect(e.message).toBe(`Could not reach ${host} over https://. If your server runs on plain http (common at home), type http://${host} instead.`)
  })

  it('a public name keeps the plain message', async () => {
    vi.stubGlobal('fetch', vi.fn(failed))
    const e = await pairRedeem('https://gym.example.com', 'ABCD2345', { probeMs: 20 }).catch(x => x)
    expect(e.message).toBe('Could not reach gym.example.com. Check the address and that this phone can reach it.')
  })
})

describe('looksLocal', () => {
  it('private, link-local, loopback and CGNAT (Tailscale) addresses', () => {
    for (const a of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.10', '169.254.1.1', '127.0.0.1', '100.64.0.1', '100.101.102.103', '[fd00::1]', 'fe80::1', '::1']) expect(looksLocal(a), a).toBe(true)
  })
  it('home-network names', () => {
    for (const a of ['nas', 'gym.local', 'server.lan', 'box.home.arpa', 'gym.internal', 'GYM.LOCAL.']) expect(looksLocal(a), a).toBe(true)
  })
  it('public addresses and names', () => {
    for (const a of ['8.8.8.8', '172.32.0.1', '100.128.0.1', 'gym.example.com', 'localhost.example.org', '2001:db8::1', '']) expect(looksLocal(a), a).toBe(false)
  })
})
