// @vitest-environment happy-dom
// #329: pairing failed with nothing but "Failed to fetch" — the same words for a wrong address
// and for a reverse proxy that answered the CORS preflight itself and kept the app out. A
// no-cors probe of /api/health tells the two apart, and the message says which.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairRedeem } from './api.js'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const failed = () => Promise.reject(new TypeError('Failed to fetch'))
const opaque = () => Promise.resolve(new Response(null, { status: 200 }))
// The no-cors probe settles; the readable one is refused by the browser, as for any server
// that does not let this origin in.
const corsOnly = (url, init) => (init && init.mode === 'no-cors' ? opaque() : failed())

describe('pairRedeem when the request never gets an answer', () => {
  it('server reachable without CORS: says the proxy refused the app, naming the app\'s origin', async () => {
    const fetch = vi.fn((url, init) => (url.endsWith('/api/pair/redeem') ? failed() : corsOnly(url, init)))
    vi.stubGlobal('fetch', fetch)
    const e = await pairRedeem('https://gym.example.com', 'ABCD2345').catch(x => x)
    expect(e.code).toBe('cors')
    expect(e.message).toContain('CORS')
    expect(e.message).toContain(location.origin)
    expect(e.message).toContain('SELF_HOSTING.md')
    const probe = fetch.mock.calls[1]
    expect(probe[0]).toBe('https://gym.example.com/api/health')
    expect(probe[1]).toMatchObject({ mode: 'no-cors', cache: 'no-store' })
  })

  it('openGym behind a proxy that refuses the app: its health answer read, still the CORS message', async () => {
    const health = () => Promise.resolve(new Response(JSON.stringify({ ok: true, users: 2 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', vi.fn((url, init) => (url.endsWith('/api/pair/redeem') ? failed() : init && init.mode === 'no-cors' ? opaque() : health())))
    const e = await pairRedeem('https://gym.example.com', 'ABCD2345').catch(x => x)
    expect(e.code).toBe('cors')
  })

  // Something in front of openGym answered in its place: an SSO login (forward-auth), a proxy
  // rule, a redirect to a sign-in page. The address is right, the proxy needs to let /api/ through.
  const PROXY_MSG = 'That address answers, but a login page or proxy rule replied instead of openGym. Let /api/ through to openGym unchanged. See “Phone app and CORS” in docs/SELF_HOSTING.md.'
  it.each([
    ['a redirect to a login page', () => new Response(null, { status: 302, headers: { location: 'https://auth.example.com/login' } })],
    ['a 401', () => new Response('', { status: 401, headers: { 'www-authenticate': 'Basic realm="x"' } })],
    ['a 403 from a proxy rule', () => new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })],
    ['a login page (HTML, 200)', () => new Response('<!doctype html><title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['an HTML page with no content type', () => new Response('  <html><body>Authelia</body></html>', { status: 200 })],
    ['an HTML 404 page', () => new Response('<h1>not found</h1>', { status: 404, headers: { 'content-type': 'text/html' } })],
  ])('a server that answers with %s: says something in front of openGym answered', async (_, page) => {
    vi.stubGlobal('fetch', vi.fn((url, init) => (url.endsWith('/api/pair/redeem') ? failed() : init && init.mode === 'no-cors' ? opaque() : Promise.resolve(page()))))
    const e = await pairRedeem('https://gym.example.com', 'ABCD2345').catch(x => x)
    expect(e.code).toBe('proxy-answered')
    expect(e.message).toBe(PROXY_MSG)
  })

  // Another app, a proxy's own "404 page not found": it answers, but it is not openGym at all.
  it.each([
    ['another app\'s JSON', () => new Response(JSON.stringify({ status: 'UP' }), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['a plain-text 404 from a proxy with no route', () => new Response('404 page not found\n', { status: 404, headers: { 'content-type': 'text/plain' } })],
    ['JSON that is not openGym\'s health', () => new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('a server that answers with %s: says it is not an openGym server', async (_, page) => {
    vi.stubGlobal('fetch', vi.fn((url, init) => (url.endsWith('/api/pair/redeem') ? failed() : init && init.mode === 'no-cors' ? opaque() : Promise.resolve(page()))))
    const e = await pairRedeem('https://gym.example.com', 'ABCD2345').catch(x => x)
    expect(e.code).toBe('not-opengym')
    expect(e.message).toBe('That address answers, but it isn’t an openGym server. Check the URL.')
  })

  it('in a browser an http:// address is not the phone\'s mixed-content case: still probed', async () => {
    vi.stubGlobal('fetch', vi.fn(failed))
    const e = await pairRedeem('http://gym.example.com', 'ABCD2345').catch(x => x)
    expect(e.code).toBe('unreachable')
  })

  it('server not reachable at all: says so, with the address', async () => {
    vi.stubGlobal('fetch', vi.fn(failed))
    const e = await pairRedeem('https://gym.example.com/sub/', 'ABCD2345').catch(x => x)
    expect(e.code).toBe('unreachable')
    expect(e.message).toBe('Could not reach gym.example.com/sub. Check the address and that this phone can reach it.')
  })

  it('a probe that hangs counts as not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => (url.endsWith('/api/pair/redeem') ? failed() : new Promise(() => {}))))
    const e = await pairRedeem('https://gym.example.com', 'ABCD2345', { probeMs: 20 }).catch(x => x)
    expect(e.code).toBe('unreachable')
  })

  it('a refused code is said in words a person can act on, with no probe', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid or expired code', code: 'pair-invalid' }), { status: 400, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(pairRedeem('https://gym.example.com', 'ABCD2345')).rejects.toMatchObject({ status: 400, code: 'pair-invalid', message: 'That code didn’t work. Codes last 5 minutes and work once, so grab a fresh one.' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('any other answer from the server is passed on as it is, with no probe', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'the server is busy, try again in a moment', code: 'busy' }), { status: 503, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(pairRedeem('https://gym.example.com', 'ABCD2345')).rejects.toMatchObject({ status: 503, message: 'the server is busy, try again in a moment' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a timeout stays a timeout', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetch)
    const p = pairRedeem('https://gym.example.com', 'ABCD2345').catch(x => x)
    await vi.advanceTimersByTimeAsync(21000)
    const e = await p
    expect(e.code).toBe('timeout')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
