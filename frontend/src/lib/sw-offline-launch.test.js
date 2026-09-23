// Regression test for issue #274: on iOS, a cold-launch of the installed PWA with no network
// left the app on a black/white screen forever. The reporter traced it to the service worker's
// network-first fetch handler — a dead radio does not reject fetch() quickly, it just never
// settles, so the .catch() that falls back to the cached shell never runs.
//
// This loads the real production file (public/sw.js) into a sandboxed context and drives its
// actual 'fetch' listener, rather than re-implementing the logic here — the thing under test is
// the shipped worker, not a description of it.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const swSource = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')

/** Run the real sw.js source in a sandbox and hand back what it registered. */
function loadServiceWorker({ fetchImpl, timeoutImpl }) {
  const listeners = {}
  const cacheStore = new Map()
  const cache = {
    match: req => Promise.resolve(cacheStore.get(typeof req === 'string' ? req : req.url)),
    put: (req, res) => { cacheStore.set(typeof req === 'string' ? req : req.url, res); return Promise.resolve() },
    add: () => Promise.resolve()
  }
  const self = {
    addEventListener: (type, cb) => { listeners[type] = cb },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve() },
    registration: {}
  }
  const context = {
    self,
    caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), match: cache.match },
    fetch: fetchImpl,
    location: { origin: 'https://gym.example' },
    URL,
    AbortSignal: { timeout: timeoutImpl },
    console
  }
  vm.createContext(context)
  vm.runInContext(swSource, context)
  return { listeners, cache }
}

function makeFetchEvent(url, mode = 'navigate') {
  let response
  return {
    request: { url, method: 'GET', mode },
    respondWith: p => { response = p },
    get response() { return response }
  }
}

describe('service worker offline cold-launch (issue #274)', () => {
  it('wires an abortable timeout onto the navigation fetch instead of waiting on it forever', async () => {
    let timeoutCalls = 0
    let controller
    // Stands in for the real AbortSignal.timeout: returns a signal the test can fire on demand,
    // instead of waiting out a real multi-second timer.
    const timeoutImpl = () => {
      timeoutCalls++
      controller = new AbortController()
      return controller.signal
    }
    // A dead radio: the request never resolves or rejects on its own, exactly like a real
    // offline navigation attempt — only an abort ends it.
    const hungFetch = vi.fn((req, opts) => new Promise((resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')))
    }))

    const { listeners, cache } = loadServiceWorker({ fetchImpl: hungFetch, timeoutImpl })
    await cache.put('index.html', new Response('cached-shell'))

    const e = makeFetchEvent('https://gym.example/')
    listeners.fetch(e)

    // A real timeout must actually be attached to the request - without one, this whole
    // recovery path is unreachable no matter how long the app is left running.
    expect(timeoutCalls).toBeGreaterThan(0)

    // Flushing a few microtask turns must not resolve it early on its own.
    const early = await Promise.race([
      e.response.then(() => 'settled'),
      Promise.resolve().then(() => {}).then(() => {}).then(() => 'still-pending')
    ])
    expect(early).toBe('still-pending')

    // Once the timeout fires, the app must recover from cache instead of staying blank.
    controller.abort()
    const res = await e.response
    expect(await res.text()).toBe('cached-shell')
  })
})
