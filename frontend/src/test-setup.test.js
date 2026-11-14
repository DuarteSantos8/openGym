// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ensureWebStorage } from './test-setup.js'

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
