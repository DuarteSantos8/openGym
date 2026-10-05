import { describe, expect, it, onTestFinished } from 'vitest'
import { markGuestDeparture, takeGuestDeparture } from './guest-departure.js'

const memory = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

// A browser that blocks site data throws on reaching sessionStorage at all, not only on its methods.
function blockSessionStorage() {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError') } })
  onTestFinished(() => { if (before) Object.defineProperty(globalThis, 'sessionStorage', before); else delete globalThis.sessionStorage })
}

describe('guest departure mark', () => {
  it('is read once', () => {
    const storage = memory()
    expect(markGuestDeparture({ storage })).toBe(true)
    expect(takeGuestDeparture({ storage })).toBe(true)
    expect(takeGuestDeparture({ storage })).toBe(false)
  })

  it('is absent unless a guest left', () => {
    expect(takeGuestDeparture({ storage: memory() })).toBe(false)
  })

  it('a storage that refuses leaves nothing marked, and says so', () => {
    const storage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => {} }
    expect(markGuestDeparture({ storage })).toBe(false)
    expect(takeGuestDeparture({ storage })).toBe(false)
  })

  it('a browser that blocks sessionStorage itself answers false instead of throwing', () => {
    blockSessionStorage()
    expect(markGuestDeparture()).toBe(false)
    expect(takeGuestDeparture()).toBe(false)
  })
})
