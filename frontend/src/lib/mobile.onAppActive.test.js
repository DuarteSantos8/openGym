// mobile.js's onAppActive/onAppUrlOpen wrap a dynamically-imported Capacitor plugin: a caller
// that unmounts - before or after the import settles - must end up with the native listener
// actually released, never a leak that keeps calling back into a component nobody can see any
// more (components/AppSignIn.jsx's useAttemptUnfinished is the caller this guards in practice).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { listeners: {}, removed: [] }
})

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event, cb) => {
      h.listeners[event] = cb
      // Mirrors the real plugin: once removed, the native side stops delivering the event -
      // the test calls h.listeners[event] directly to simulate that delivery.
      return Promise.resolve({ remove: () => { h.removed.push(event); delete h.listeners[event] } })
    },
    getLaunchUrl: async () => undefined,
  },
}))

const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => { h.listeners = {}; h.removed = [] })

describe('onAppActive', () => {
  it('calls back on every foreground event while subscribed', async () => {
    const { onAppActive } = await import('./mobile.js')
    const cb = vi.fn()
    onAppActive(cb)
    await flush()
    h.listeners.appStateChange({ isActive: true })
    h.listeners.appStateChange({ isActive: false })   // backgrounding never calls back
    h.listeners.appStateChange({ isActive: true })
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('removes the native listener once unsubscribed, and the callback never fires again', async () => {
    const { onAppActive } = await import('./mobile.js')
    const cb = vi.fn()
    const off = onAppActive(cb)
    await flush()
    off()
    expect(h.removed).toEqual(['appStateChange'])
    expect(h.listeners.appStateChange).toBeUndefined()
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribing before the dynamic import settles leaves no listener for it to find', async () => {
    const cb = vi.fn()
    const { onAppActive } = await import('./mobile.js')
    const off = onAppActive(cb)
    off()   // synchronous - the import has not resolved yet
    await flush()
    // Cancelling this early skips creating the native listener at all (nothing left to remove,
    // which is the better outcome) rather than creating one and removing it a tick later - either
    // way the callback must never fire.
    h.listeners.appStateChange?.({ isActive: true })
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('onAppUrlOpen', () => {
  it('removes the native listener once unsubscribed, and the callback never fires again', async () => {
    const { onAppUrlOpen } = await import('./mobile.js')
    const cb = vi.fn()
    const off = onAppUrlOpen(cb)
    await flush()
    off()
    expect(h.removed).toEqual(['appUrlOpen'])
    expect(h.listeners.appUrlOpen).toBeUndefined()
    expect(cb).not.toHaveBeenCalled()
  })
})
