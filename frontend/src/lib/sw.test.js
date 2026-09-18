/* frontend/public/sw.js against a stand-in worker environment.
 *
 * The one thing the worker must never do is take the build that is already on the device away
 * without having a working one to put there: its cache is what a home-screen app reopened
 * without a network comes back from. So an install that did not get the shell fails, and the
 * previous build's cache is swept only once this build's shell is in its own. */
import { beforeEach, describe, expect, it } from 'vitest'

class FakeCache {
  constructor(name) { this.name = name; this.m = new Map() }
  async put(req, res) { this.m.set(String(req.url || req), res) }
  async add(u) { const r = await globalThis.fetch(u); if (!r.ok) throw new Error('add failed ' + u); this.m.set(String(u), r) }
  async match(req) { return this.m.get(String(req.url || req)) }
  keys() { return [...this.m.keys()] }
}
class FakeCaches {
  constructor() { this.c = new Map() }
  async open(n) { if (!this.c.has(n)) this.c.set(n, new FakeCache(n)); return this.c.get(n) }
  async keys() { return [...this.c.keys()] }
  async delete(n) { return this.c.delete(n) }
  async match(req) { for (const c of this.c.values()) { const hit = await c.match(req); if (hit) return hit } return undefined }
}

const CACHE = 'opengym-rt-__BUILD__'   // the placeholder the build rewrites (vite.config.js swStamp)
const handlers = {}
let skipWaiting = 0

// A fresh copy of the worker each time: it registers its listeners at import, so the module
// cache has to be stepped around with a query string.
async function loadSW() {
  for (const k of Object.keys(handlers)) delete handlers[k]
  skipWaiting = 0
  globalThis.self = {
    addEventListener: (type, fn) => { handlers[type] = fn },
    skipWaiting: () => { skipWaiting++ },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { getNotifications: async () => [], showNotification: async () => {}, pushManager: {} }
  }
  globalThis.location = { origin: 'https://gym.test' }
  globalThis.caches = new FakeCaches()
  await import('../../public/sw.js?load=' + Math.random())
}
// What waitUntil was handed is what the browser judges the install by, so it is awaited (and its
// rejection is the install failing).
const fire = async (type, ev = {}) => {
  const e = { ...ev, waitUntil: p => { e._done = p }, respondWith: p => { e._res = p } }
  handlers[type](e)
  if (e._done) await e._done
  return e
}
const previousBuild = async () => {
  const old = await globalThis.caches.open('opengym-rt-oldbuild')
  await old.put('index.html', { ok: true, body: 'the shell already on this device' })
  return old
}
const shellHtml = '<html><head><script src="./assets/index-new.js"></script></head></html>'

beforeEach(() => { delete globalThis.self })

describe('sw.js install and activate', () => {
  it('a precache that cannot reach the server fails the install and keeps the build on the device', async () => {
    await loadSW()
    const old = await previousBuild()
    globalThis.fetch = async () => { throw new Error('network down') }

    await expect(fire('install')).rejects.toThrow()
    expect(skipWaiting).toBe(0)

    await fire('activate')   // an activate that happens anyway must still leave the old cache alone
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await old.match('index.html')).toBeTruthy()
  })

  it('a redirect to a login page is never cached as the shell', async () => {
    await loadSW()
    await previousBuild()
    globalThis.fetch = async () => ({ ok: true, status: 200, redirected: true, text: async () => '<html>sign in</html>' })

    await expect(fire('install')).rejects.toThrow()
    expect(skipWaiting).toBe(0)
    expect((await globalThis.caches.open(CACHE)).keys()).not.toContain('index.html')
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('a server that is restarting fails the install rather than cache its error page', async () => {
    await loadSW()
    await previousBuild()
    globalThis.fetch = async () => ({ ok: false, status: 502, redirected: false, text: async () => 'Bad Gateway' })

    await expect(fire('install')).rejects.toThrow()
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('an install that got the shell takes over and drops the previous build', async () => {
    await loadSW()
    await previousBuild()
    globalThis.fetch = async u => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: true, status: 200, clone: () => ({}) })

    await fire('install')
    expect(skipWaiting).toBe(1)
    await fire('activate')

    expect(await globalThis.caches.keys()).toEqual([CACHE])
    expect((await globalThis.caches.open(CACHE)).keys()).toContain('index.html')
  })
})
