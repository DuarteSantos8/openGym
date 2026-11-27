// @vitest-environment happy-dom
import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureWebStorage, refuseNetwork } from './test-setup.js'

// What Node 24+ leaves on the global without --localstorage-file (#733): a localStorage that is
// undefined, or one whose getter throws.
describe('ensureWebStorage', () => {
  it('replaces a localStorage that is undefined or throws, and leaves a working one alone', () => {
    const g = { document: {} }
    Object.defineProperty(g, 'localStorage', { get() { return undefined }, configurable: true })
    Object.defineProperty(g, 'sessionStorage', { get() { throw new TypeError('invalid localStorage location') }, configurable: true })
    ensureWebStorage(g)
    g.localStorage.setItem('k', 'v')
    expect(g.localStorage.getItem('k')).toBe('v')
    g.sessionStorage.setItem('s', '1')
    expect(g.sessionStorage.getItem('s')).toBe('1')
    // Storage.prototype patches (the multi-tab tests) reach the stand-in.
    expect(g.localStorage).toBeInstanceOf(g.Storage)
    const kept = g.localStorage
    ensureWebStorage(g)
    expect(g.localStorage).toBe(kept)
  })
  it('does nothing outside a DOM environment', () => {
    const g = {}
    ensureWebStorage(g)
    expect('localStorage' in g).toBe(false)
  })
  it('the test environment itself has a working localStorage', () => {
    localStorage.setItem('x', '1')
    expect(localStorage.getItem('x')).toBe('1')
    localStorage.removeItem('x')
  })
})

// A unit test must not open a connection. Before this, a test that opened an exercise sheet asked
// for the picture indexes with happy-dom's real fetch: a real connection to localhost:3000,
// refused, and logged some time later. When that was while the worker was closing, the run failed
// with every test passing ("Closing rpc while onUserConsoleLog was pending").
describe('refuseNetwork', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('the test environment itself refuses a fetch at once, without opening a socket', async () => {
    const connect = vi.spyOn(net.Socket.prototype, 'connect')
    await expect(fetch('exercise-demos/index.json')).rejects.toThrow(TypeError)
    await expect(fetch('http://localhost:3000/api/status')).rejects.toThrow(/unit test/)
    await expect(window.fetch('/api/status')).rejects.toThrow(TypeError)
    expect(connect).not.toHaveBeenCalled()
  })

  it('says which address was asked for, so a test that needs one knows what to stub', async () => {
    await expect(fetch(new URL('https://example.com/a?b=1'))).rejects.toThrow('https://example.com/a?b=1')
    await expect(fetch({ url: '/from-a-request' })).rejects.toThrow('/from-a-request')
  })

  it('a test that stubs fetch gets its stub', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ fine: true }) })))
    expect(await (await fetch('/anything')).json()).toEqual({ fine: true })
    vi.unstubAllGlobals()
    await expect(fetch('/anything')).rejects.toThrow(TypeError)
  })

  it('does nothing outside a DOM environment, and replaces window.fetch with the global one', () => {
    const real = () => {}
    const g = { fetch: real }
    refuseNetwork(g)
    expect(g.fetch).toBe(real)
    const w = { fetch: real }
    const d = { document: {}, window: w, fetch: real }
    refuseNetwork(d)
    expect(d.fetch).not.toBe(real)
    expect(w.fetch).toBe(d.fetch)
  })
})
