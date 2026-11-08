import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The whole point of the module is surviving what the browser does on its own: it drops the
// lock every time the document goes hidden. So the fake browser here has to do that too,
// otherwise the tests pass against a one-shot implementation that dies on the first tab switch.
let requests, released, live, listeners, reject

// Node 21+ defines globalThis.navigator itself, as a getter with no setter — a plain
// assignment throws under ESM's strict mode. defineProperty works on both that and the older
// runtimes where the global simply doesn't exist. Production images are node:26-alpine, so
// the tests have to run there too.
const setNavigator = value =>
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })

function fakeBrowser() {
  requests = 0; released = 0; live = null; reject = false
  listeners = new Set()
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.delete(fn) },
  }
  setNavigator({
    wakeLock: {
      request: async () => {
        requests++
        if (reject) throw new Error('NotAllowedError')   // iOS Low Power Mode
        const subs = new Set()
        const s = { addEventListener: (_, fn) => subs.add(fn), release: async () => { if (live === s) live = null; released++; subs.forEach(fn => fn()) } }
        live = s
        return s
      },
    },
  })
}
const fire = () => listeners.forEach(fn => fn())
const settle = () => new Promise(r => setTimeout(r, 0))
const background = async () => { globalThis.document.visibilityState = 'hidden'; if (live) await live.release(); fire(); await settle() }
const foreground = async () => { globalThis.document.visibilityState = 'visible'; fire(); await settle() }

let requestWakeLock, releaseWakeLock, wakeLockSupported

beforeEach(async () => {
  fakeBrowser()
  vi.resetModules()   // the module holds process-wide state; each test gets a fresh one
  ;({ requestWakeLock, releaseWakeLock, wakeLockSupported } = await import('./wakelock.js'))
})
afterEach(() => { delete globalThis.document; delete globalThis.navigator })

describe('wakeLockSupported', () => {
  it('is false when the browser has no wakeLock at all', () => {
    setNavigator({})
    expect(wakeLockSupported()).toBe(false)
  })
  it('is true when it does', () => {
    expect(wakeLockSupported()).toBe(true)
  })
})

describe('requestWakeLock', () => {
  it('takes a lock', async () => {
    requestWakeLock(); await settle()
    expect(requests).toBe(1)
    expect(live).not.toBeNull()
  })

  it('does not stack a second lock while one is held', async () => {
    requestWakeLock(); await settle()
    requestWakeLock(); await settle()
    expect(requests).toBe(1)
  })

  it('does not request one on a hidden document', async () => {
    globalThis.document.visibilityState = 'hidden'
    requestWakeLock(); await settle()
    expect(requests).toBe(0)
  })

  it('re-acquires after the browser drops it on backgrounding', async () => {
    requestWakeLock(); await settle()
    await background()
    expect(live).toBeNull()
    await foreground()
    expect(requests).toBe(2)
    expect(live).not.toBeNull()
  })

  it('survives a rejection and retries when the document comes back', async () => {
    reject = true
    requestWakeLock(); await settle()
    expect(live).toBeNull()
    reject = false
    await foreground()
    expect(live).not.toBeNull()
  })
})

describe('releaseWakeLock', () => {
  it('releases the held lock and stops re-acquiring', async () => {
    requestWakeLock(); await settle()
    releaseWakeLock(); await settle()
    expect(released).toBe(1)
    expect(live).toBeNull()
    await background(); await foreground()
    expect(requests).toBe(1)
  })

  it('does not leak a lock when it lands while a request is in flight', async () => {
    requestWakeLock()      // no await — the request is still pending
    releaseWakeLock()
    await settle()
    expect(live).toBeNull()          // the arriving sentinel was released immediately
    await foreground()
    expect(requests).toBe(1)         // and we did not start wanting it again
  })
})
