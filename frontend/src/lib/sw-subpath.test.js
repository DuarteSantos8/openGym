// @vitest-environment node

/* The worker leaves the API alone under a subpath too (#238). Its "never cache auth/data" guard
 * used to match '/api/' at the site root only, so under /myGym/ every GET of the data and of its
 * revision went through the network-first branch: each good answer was cached, and with no
 * network the page was handed the cached, older document as a 200. The store took that for the
 * server's answer — a rev check cleared the offline banner and a pull adopted the old copy.
 * public/sw.js is evaluated as-is against a minimal worker environment. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SW = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')

function worker(scriptUrl) {
  const handlers = {}
  const store = new Map()
  const cache = {
    put: async (req, res) => { store.set(typeof req === 'string' ? req : req.url, res) },
    match: async req => store.get(typeof req === 'string' ? req : req.url),
    add: async () => {},
  }
  const env = {
    self: { addEventListener: (t, f) => { handlers[t] = f }, skipWaiting: () => {}, clients: { claim: () => {} }, registration: {} },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async req => store.get(typeof req === 'string' ? req : req.url) },
    location: new URL(scriptUrl),
    net: { up: true, body: null },
    store,
  }
  env.fetch = async () => {
    if (!env.net.up) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(env.net.body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  new Function('self', 'caches', 'fetch', 'location', SW)(env.self, env.caches, env.fetch, env.location)
  env.get = async url => {
    let responded = null
    handlers.fetch({ request: { url, method: 'GET', mode: 'cors' }, respondWith: p => { responded = p } })
    if (!responded) return { intercepted: false }
    const res = await responded
    await new Promise(r => setTimeout(r, 5))   // the cache.put runs after the response is handed over
    return { intercepted: true, res }
  }
  return env
}

describe('the service worker and the API', () => {
  it('leaves the API alone at the site root', async () => {
    const env = worker('https://gym.example.com/sw.js')
    expect((await env.get('https://gym.example.com/api/data')).intercepted).toBe(false)
    expect((await env.get('https://gym.example.com/api/data/rev')).intercepted).toBe(false)
  })

  it('leaves the API alone under a subpath, so an old document is never replayed offline', async () => {
    const env = worker('https://example.com/myGym/sw.js')
    env.net.body = { state: { workouts: [{ id: 'w1' }] }, rev: 5 }
    expect((await env.get('https://example.com/myGym/api/data')).intercepted).toBe(false)
    expect((await env.get('https://example.com/myGym/api/data/rev')).intercepted).toBe(false)
    expect(env.store.size).toBe(0)
  })

  it('still serves the app itself from the cache under that subpath', async () => {
    const env = worker('https://example.com/myGym/sw.js')
    env.net.body = { app: true }
    expect((await env.get('https://example.com/myGym/manifest.json')).intercepted).toBe(true)
    env.net.up = false
    const offline = await env.get('https://example.com/myGym/manifest.json')
    expect(offline.res.status).toBe(200)
  })
})
