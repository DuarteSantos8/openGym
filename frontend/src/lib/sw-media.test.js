// @vitest-environment node

/* Exercise media offline (#281). The worker keeps img/ and gif/ in a cache of its own that an
 * update does not sweep, adopts what an older build had cached, never keeps a login page or a
 * refusal under an image's URL, and stays under its size cap by dropping the least recently
 * used first. public/sw.js is evaluated as-is against a small worker environment whose caches
 * keep entries in write order, the way the Cache API does. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MEDIA_CACHE } from './media-prefetch.js'

const SW = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const BUILD = 'opengym-rt-__BUILD__'
const MEDIA = 'opengym-media-v1'
const ORIGIN = 'https://gym.test'
const keyOf = r => (typeof r === 'string' ? new URL(r, ORIGIN + '/').href : r.url)

class OrderedCache {
  constructor() { this.m = new Map() }
  async put(req, res) { const k = keyOf(req); this.m.delete(k); this.m.set(k, res) }   // a write moves to the end
  async match(req) { const r = this.m.get(keyOf(req)); return r ? r.clone() : undefined }
  async keys() { return [...this.m.keys()].map(url => ({ url })) }
  async delete(req) { return this.m.delete(keyOf(req)) }
  urls() { return [...this.m.keys()] }
}
// `all` carries the caches over from an earlier worker: the browser stops an idle worker and
// starts a fresh one, and the caches are what survives.
function worker(all = new Map()) {
  const handlers = {}
  const caches = {
    open: async n => { if (!all.has(n)) all.set(n, new OrderedCache()); return all.get(n) },
    keys: async () => [...all.keys()],
    delete: async n => all.delete(n),
    match: async req => { for (const c of all.values()) { const hit = await c.match(req); if (hit) return hit } return undefined },
  }
  const env = { net: { up: true, answer: null }, fetched: [], all, caches }
  const fetch = async req => {
    const url = keyOf(req)
    env.fetched.push(url)
    if (!env.net.up) throw new TypeError('Failed to fetch')
    if (env.net.answer) return env.net.answer(url)
    return new Response('GIF89a' + url, { status: 200, headers: { 'content-type': 'image/gif', 'content-length': String(40 * 1024 * 1024) } })
  }
  const self = { addEventListener: (t, f) => { handlers[t] = f }, skipWaiting: () => {}, clients: { claim: async () => {} }, registration: {} }
  new Function('self', 'caches', 'fetch', 'location', SW)(self, caches, fetch, new URL(ORIGIN + '/sw.js'))
  env.get = async path => {
    const pending = []
    let responded = null
    const e = { request: { url: ORIGIN + path, method: 'GET', mode: 'no-cors' }, respondWith: p => { responded = p }, waitUntil: p => { pending.push(p) } }
    handlers.fetch(e)
    const res = await responded
    await Promise.all(pending)
    // A write-back may have been queued after the answer was handed over.
    for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); await Promise.all(pending) }
    return res
  }
  env.activate = async () => {
    let done
    handlers.activate({ waitUntil: p => { done = p } })
    await done
  }
  env.media = () => all.get(MEDIA)
  return env
}

describe('sw.js exercise media', () => {
  it('is kept in a cache of its own and answers offline from it', async () => {
    const w = worker()
    const res = await w.get('/gif/0001.gif')
    expect(res.status).toBe(200)
    expect(w.media().urls()).toEqual([ORIGIN + '/gif/0001.gif'])
    expect(w.all.get(BUILD)?.urls() || []).toEqual([])

    w.net.up = false
    const again = await w.get('/gif/0001.gif')
    expect(await again.text()).toBe('GIF89a' + ORIGIN + '/gif/0001.gif')
  })

  it('survives an update: activate sweeps old builds, never the media, and adopts what an old build had cached', async () => {
    const w = worker()
    await w.get('/img/0002.jpg')
    const old = await w.caches.open('opengym-rt-oldbuild')
    await old.put(ORIGIN + '/gif/0003.gif', new Response('old gif', { headers: { 'content-type': 'image/gif' } }))
    await old.put(ORIGIN + '/assets/index-old.js', new Response('old code'))
    const shell = await w.caches.open(BUILD)
    await shell.put('index.html', new Response('<html></html>'))

    await w.activate()
    expect(await w.caches.keys()).toEqual(expect.arrayContaining([BUILD, MEDIA]))
    expect(await w.caches.keys()).not.toContain('opengym-rt-oldbuild')
    expect(w.media().urls()).toEqual([ORIGIN + '/img/0002.jpg', ORIGIN + '/gif/0003.gif'])

    w.net.up = false
    expect(await (await w.get('/gif/0003.gif')).text()).toBe('old gif')
  })

  it('does not adopt a login page an older build had cached under an image\'s URL', async () => {
    const w = worker()
    const old = await w.caches.open('opengym-rt-oldbuild')
    // v1.3.8 kept any ok answer, so a proxy's sign-in page could sit under a gif's URL. This
    // small cache's clone() drops a `redirected` flag, so the page's own type is what is
    // checked here.
    await old.put(ORIGIN + '/gif/0004.gif', new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } }))
    await old.put(ORIGIN + '/gif/0005.gif', new Response('<html>sign in</html>', { headers: { 'content-type': 'Text/HTML; charset=utf-8' } }))
    await old.put(ORIGIN + '/gif/0006.gif', new Response('real gif', { headers: { 'content-type': 'image/gif' } }))
    const shell = await w.caches.open(BUILD)
    await shell.put('index.html', new Response('<html></html>'))

    await w.activate()
    expect(w.media().urls()).toEqual([ORIGIN + '/gif/0006.gif'])
    // With the old build gone, the next view with a network fetches the real animation.
    await w.get('/gif/0005.gif')
    expect(w.fetched).toEqual([ORIGIN + '/gif/0005.gif'])
    expect(await (await w.caches.open(MEDIA)).match(ORIGIN + '/gif/0005.gif')).toBeTruthy()
  })

  it('an activate with no media anywhere creates no media cache', async () => {
    const w = worker()
    const shell = await w.caches.open(BUILD)
    await shell.put('index.html', new Response('<html></html>'))
    await w.activate()
    expect(await w.caches.keys()).toEqual([BUILD])
  })

  it('keeps no login page, redirect or refusal under an image\'s URL', async () => {
    const w = worker()
    w.net.answer = url => url.endsWith('a.gif')
      ? Object.defineProperty(new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } }), 'redirected', { value: true })
      : url.endsWith('b.gif') ? new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
        : new Response('no', { status: 401 })
    await w.get('/gif/a.gif'); await w.get('/gif/b.gif'); await w.get('/gif/c.gif')
    expect(w.media().urls()).toEqual([])
  })

  it('stays under its cap, dropping the least recently used first', async () => {
    const first = worker()
    // 40 MB each by Content-Length: the cap (150 MB) holds three of them.
    for (const n of [1, 2, 3]) await first.get(`/gif/${n}.gif`)
    // A later worker that shows the oldest again moves it to the back of the line, once.
    const w = worker(first.all)
    await w.get('/gif/1.gif')
    await w.get('/gif/1.gif')
    expect(w.media().urls().map(u => u.slice(-5))).toEqual(['2.gif', '3.gif', '1.gif'])
    expect(w.fetched).toEqual([])   // both from the cache
    // Trimming runs every twentieth new entry this worker writes; small ones fill the gap.
    w.net.answer = url => new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': url.includes('/img/') ? '1024' : String(40 * 1024 * 1024) } })
    await w.get('/gif/4.gif')
    for (let i = 0; i < 19; i++) await w.get(`/img/${i}.jpg`)
    const left = w.media().urls().map(u => u.slice(u.lastIndexOf('/') + 1))
    expect(left).not.toContain('2.gif')
    expect(left).toEqual(expect.arrayContaining(['3.gif', '1.gif', '4.gif', '0.jpg', '18.jpg']))
    expect(left).toHaveLength(22)
  })

  it('names the same cache as the page-side prefetch', () => {
    expect(SW).toContain(`const MEDIA = '${MEDIA_CACHE}'`)
    expect(MEDIA_CACHE).toBe(MEDIA)
  })
})
