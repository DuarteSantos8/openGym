// @vitest-environment node

/* What the worker may touch, and where a notification takes you. public/sw.js is evaluated as-is
 * against a small worker environment, like sw-media.test.js and sw-subpath.test.js do.
 *
 * The site is one origin with one worker: openGym's API at /api/, NutriTrace at /nt/api/, the
 * hub at /hub/api/. So the worker deletes only caches that carry its own prefix (and the
 * `opengym-` ones it replaced), caches only what an allow-list names, sends a notification tap to
 * a hash route of this app and nowhere else, and tells open pages when a newer build took over. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { legacyPath } from './tab-route.js'

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SW = read('../../public/sw.js')
const STAMP = '__BUILD__'   // what the build rewrites; the page reads the same value from <meta name="gains-build">
const BUILD = 'gains-rt-' + STAMP
const ORIGIN = 'https://gym.test'

class Cache {
  constructor() { this.m = new Map() }
  keyOf(req) { return typeof req === 'string' ? new URL(req, ORIGIN + '/').href : req.url }
  async put(req, res) { this.m.set(this.keyOf(req), res) }
  async match(req) { const r = this.m.get(this.keyOf(req)); return r ? r.clone() : undefined }
  async keys() { return [...this.m.keys()].map(url => ({ url })) }
  async delete(req) { return this.m.delete(this.keyOf(req)) }
  async add() {}
}
// `scope` is where the worker is served: the site root, or a subpath.
function worker({ scope = ORIGIN + '/', all = new Map() } = {}) {
  const handlers = {}
  const posted = []
  const shown = []
  const opened = []
  const env = { handlers, posted, shown, opened, all, windows: [], net: { up: true } }
  const caches = {
    open: async n => { if (!all.has(n)) all.set(n, new Cache()); return all.get(n) },
    keys: async () => [...all.keys()],
    delete: async n => all.delete(n),
    match: async req => { for (const c of all.values()) { const hit = await c.match(req); if (hit) return hit } return undefined },
  }
  const self = {
    addEventListener: (t, f) => { handlers[t] = f },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => env.windows,
      openWindow: async u => { opened.push(u) },
    },
    registration: { getNotifications: async () => [], showNotification: async (title, opts) => { shown.push({ title, opts }) } },
  }
  const fetch = async () => {
    if (!env.net.up) throw new TypeError('Failed to fetch')
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  new Function('self', 'caches', 'fetch', 'location', SW)(self, caches, fetch, new URL(scope + 'sw.js'))
  env.caches = caches
  // A window of the app that records what was done to it.
  env.window = (over = {}) => {
    const w = { focused: 0, navigated: [], messages: [], focus: async () => { w.focused++ }, navigate: async u => { w.navigated.push(u) }, postMessage: m => { w.messages.push(m) }, ...over }
    env.windows.push(w)
    return w
  }
  env.get = async (path, mode = 'cors') => {
    let responded = null
    handlers.fetch({ request: { url: new URL(path, scope).href.replace(new URL(scope).origin, ORIGIN), method: 'GET', mode, headers: new Headers() }, respondWith: p => { responded = p }, waitUntil: () => {} })
    if (!responded) return { intercepted: false }
    await responded
    await new Promise(r => setTimeout(r, 5))   // the cache.put runs after the response is handed over
    return { intercepted: true }
  }
  env.activate = async () => { let done; handlers.activate({ waitUntil: p => { done = p } }); await done }
  env.push = async payload => { let done; handlers.push({ data: { json: () => payload, text: () => '' }, waitUntil: p => { done = p } }); await done }
  env.tap = async data => {
    let done
    handlers.notificationclick({ notification: { close() {}, data }, waitUntil: p => { done = p } })
    await done
  }
  return env
}
const img = () => new Response('img', { status: 200, headers: { 'content-type': 'image/jpeg' } })

describe('the caches the worker deletes', () => {
  it('are its own, and the ones the prefix replaced, and nothing else on the origin', async () => {
    const all = new Map()
    const w = worker({ all })
    await (await w.caches.open(BUILD)).put('index.html', new Response('shell'))
    await w.caches.open('gains-rt-oldbuild')
    await w.caches.open('opengym-rt-oldbuild')
    // Somebody else's caches on the same origin: another app's, a library's, one that merely
    // starts like ours.
    for (const n of ['workbox-precache-v2-https://gym.test/', 'nt-gateway-v1', 'gainsboro', 'opengym', 'my-opengym-rt-x']) await w.caches.open(n)

    await w.activate()

    const left = await w.caches.keys()
    expect(left).not.toContain('gains-rt-oldbuild')
    expect(left).not.toContain('opengym-rt-oldbuild')
    expect(left.sort()).toEqual([BUILD, 'workbox-precache-v2-https://gym.test/', 'nt-gateway-v1', 'gainsboro', 'opengym', 'my-opengym-rt-x'].sort())
  })

  it('keep the media and the device id across the rename, then drop the old caches once', async () => {
    const all = new Map()
    const w = worker({ all })
    await (await w.caches.open(BUILD)).put('index.html', new Response('shell'))
    await (await w.caches.open('opengym-media-v1')).put('/img/0001.jpg', img())
    await (await w.caches.open('opengym-rt-oldbuild')).put('/img/0002.jpg', img())
    await (await w.caches.open('opengym-device')).put('/opengym-device-id', new Response('dev-123'))

    await w.activate()

    expect(await w.caches.keys()).toEqual(expect.arrayContaining([BUILD, 'gains-media-v1', 'gains-device']))
    for (const gone of ['opengym-media-v1', 'opengym-rt-oldbuild', 'opengym-device']) expect(await w.caches.keys()).not.toContain(gone)
    const media = all.get('gains-media-v1')
    expect(await media.match('/img/0001.jpg')).toBeTruthy()
    expect(await media.match('/img/0002.jpg')).toBeTruthy()
    expect(await (await all.get('gains-device').match('/opengym-device-id')).text()).toBe('dev-123')

    // A second activation has nothing left of the old names to touch.
    await w.activate()
    expect(await w.caches.keys()).toEqual(expect.arrayContaining([BUILD, 'gains-media-v1', 'gains-device']))
  })

  it('never delete an old build when this one has no shell', async () => {
    const w = worker()
    await w.caches.open('opengym-rt-oldbuild')
    await w.activate()
    expect(await w.caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('drop what a tab still running the old JavaScript rebuilt, on every activation, without storing media twice', async () => {
    const all = new Map()
    const w = worker({ all })
    await (await w.caches.open(BUILD)).put('index.html', new Response('shell'))
    await (await w.caches.open('opengym-media-v1')).put('/img/0001.jpg', img())
    await w.activate()
    expect(all.get('gains-media-v1').m.size).toBe(1)

    // The old tab, still open after the switch: it writes the old device cache and rebuilds the old
    // media cache with what it has shown, a file we already hold among them.
    const old = await w.caches.open('opengym-media-v1')
    await old.put('/img/0001.jpg', img())
    await old.put('/exercise-media/still/0009.webp', img())
    await (await w.caches.open('opengym-device')).put('/opengym-device-id', new Response('dev-456'))
    await w.activate()

    expect(await w.caches.keys()).not.toContain('opengym-media-v1')
    expect(await w.caches.keys()).not.toContain('opengym-device')
    expect([...all.get('gains-media-v1').m.keys()].sort()).toEqual([ORIGIN + '/exercise-media/still/0009.webp', ORIGIN + '/img/0001.jpg'])
    expect(await (await all.get('gains-device').match('/opengym-device-id')).text()).toBe('dev-456')
  })

  it('drop those caches when there is no shell yet too, keeping the old builds that are still live', async () => {
    const w = worker()
    await (await w.caches.open('opengym-media-v1')).put('/img/0001.jpg', img())
    await w.caches.open('opengym-device')
    await w.caches.open('opengym-rt-oldbuild')
    await w.activate()
    const left = await w.caches.keys()
    expect(left).toContain('opengym-rt-oldbuild')
    expect(left).not.toContain('opengym-media-v1')
    expect(left).not.toContain('opengym-device')
    expect(await (await w.all.get('gains-media-v1').match('/img/0001.jpg'))).toBeTruthy()
  })

  it('say in the worker what a rollback to a build from before the rename costs', () => {
    expect(SW).toMatch(/rollback to a build from before the rename[\s\S]*media is downloaded again/)
  })
})

describe('what the worker caches', () => {
  for (const scope of [ORIGIN + '/', ORIGIN + '/myGym/']) {
    const at = scope.endsWith('/myGym/') ? '/myGym/' : '/'
    describe(`served from ${at}`, () => {
      it('is the app: shell, built files, brand files and the files at its root', async () => {
        const w = worker({ scope })
        for (const p of ['', 'index.html', 'assets/index-a1.js', 'assets/de-9f.js', 'assets/index-a1.css', 'brand/icon-512.png', 'manifest.json', 'favicon.svg']) {
          expect((await w.get(at + p)).intercepted, p).toBe(true)
        }
        expect((await w.get(at, 'navigate')).intercepted).toBe(true)
        const cached = [...(w.all.get(BUILD)?.m.keys() || [])]
        expect(cached).toContain(ORIGIN + at + 'assets/index-a1.js')
        expect(cached).toContain(ORIGIN + at + 'manifest.json')
      })

      it('is nothing else: the gateway, the hub, an endpoint nobody has written yet, the worker itself', async () => {
        const w = worker({ scope })
        for (const p of ['nt/api/diary/2026-10-15', 'nt/api/proxy?url=x', 'hub/api/sync/status', 'api/data', 'future/endpoint', 'future.json/x', 'assets', 'sw.js', 'nt/', 'some-page']) {
          expect((await w.get(at + p)).intercepted, p).toBe(false)
        }
        // Same-origin paths outside the app's own directory, whatever they look like.
        if (at !== '/') for (const p of ['/assets/index-a1.js', '/manifest.json', '/nt/api/diary']) expect((await w.get(p)).intercepted, p).toBe(false)
        expect(w.all.get(BUILD)?.m.size || 0).toBe(0)
      })

      it('treats as media only the catalogue’s own folders, not any path with img/ or gif/ in it', async () => {
        const w = worker({ scope })
        for (const p of ['exercise-media/still/0001.webp', 'exercise-media/clip/0001.mp4', 'img/0001.jpg', 'gif/0001.gif']) {
          expect((await w.get(at + p)).intercepted, p).toBe(true)
        }
        expect([...w.all.get('gains-media-v1').m.keys()]).toHaveLength(4)
        const other = worker({ scope })
        const hash = 'a'.repeat(64)
        for (const p of ['uploads/img/a.jpg', 'nt/img/a.png', 'hub/gif/a.gif', 'some/exercise-media/still/a.webp', 'exercise-media/other/a.webp', 'exercise-media/still', 'myimg/a.jpg', 'imgs/a.jpg', 'api/media/' + hash, 'img', 'gif']) {
          expect((await other.get(at + p)).intercepted, p).toBe(false)
        }
        // …and the same paths from the other end of the origin.
        if (at !== '/') for (const p of ['/img/0001.jpg', '/gif/0001.gif', '/exercise-media/still/0001.webp']) expect((await other.get(p)).intercepted, p).toBe(false)
        expect(other.all.size).toBe(0)
      })

      it('keeps the exercise media in its own cache, never in the build’s', async () => {
        const w = worker({ scope })
        expect((await w.get(at + 'exercise-media/still/0001.webp')).intercepted).toBe(true)
        expect(w.all.get(BUILD)?.m.size || 0).toBe(0)
        expect(w.all.get('gains-media-v1')?.m.size).toBe(1)
      })
    })
  }
})

describe('a push and the tap on it', () => {
  it('carries its URL to the notification as the server sent it', async () => {
    const w = worker()
    await w.push({ title: 'Coach', body: 'A proposal', tag: 'coach-proposal', url: '#/coach' })
    expect(w.shown[0].opts.data).toEqual({ url: '#/coach' })
    await w.push({ title: 'Rest over', tag: 'rest-timer' })
    expect(w.shown[1].opts.data).toEqual({ url: '' })
    await w.push({ title: 'x', url: { not: 'a string' } })
    expect(w.shown[2].opts.data).toEqual({ url: '' })
  })

  it('focuses a window of the app and tells it to go to the target, without a navigation', async () => {
    // WindowClient.navigate() is a real navigation; a hash change inside the page is only a route
    // change, so the page is messaged and sets location.hash itself.
    const w = worker()
    const win = w.window()
    await w.tap({ url: '#/train/workout' })
    expect(win.focused).toBe(1)
    expect(win.messages).toEqual([{ type: 'gains-sw-navigate', url: ORIGIN + '/#/train/workout' }])
    expect(win.navigated).toEqual([])
    expect(w.opened).toEqual([])
  })

  it('opens the target when no window is open', async () => {
    const w = worker()
    await w.tap({ url: '#/food' })
    expect(w.opened).toEqual([ORIGIN + '/#/food'])
  })

  it('accepts the app’s own addresses: #/…, ./#/… and its absolute URL, under a subpath too', async () => {
    for (const [scope, base] of [[ORIGIN + '/', ORIGIN + '/'], [ORIGIN + '/myGym/', ORIGIN + '/myGym/']]) {
      for (const url of ['#/train/history', './#/train/history', base + '#/train/history', base + 'index.html#/train/history']) {
        const w = worker({ scope })
        await w.tap({ url })
        expect(w.opened, url).toEqual([base + '#/train/history'])
      }
    }
  })

  it('maps an old route to its tab route, keeping the rest of the address', async () => {
    const cases = {
      '#/coach': '#/train/coach',
      '#/plan': '#/train/schedule',
      '#/plan/r/r1': '#/train/routines/r1',
      '#/workout': '#/train/workout',
      '#/settings/backup?x=1': '#/me/backup?x=1',
      '#/stats?focus=weekly-volume': '#/progress/load?focus=weekly-volume',
      '#/stats': '#/progress',
      '#/home': '#/home',
      '#/train/coach': '#/train/coach',
      '#/coaching': '#/coaching',    // a prefix of a word is not a path prefix
    }
    for (const [from, to] of Object.entries(cases)) {
      const w = worker()
      await w.tap({ url: from })
      expect(w.opened, from).toEqual([ORIGIN + '/' + to])
    }
  })

  it('refuses anything that is not a hash route of this app, and does what a tap always did', async () => {
    for (const url of ['https://evil.example/#/home', '//evil.example/#/home', 'javascript:alert(1)', 'data:text/html,hi', '/some/path', '/#home',
      ORIGIN + '/other#/home', ORIGIN + '/nt/api/diary#/x', 'http://gym.test/#/home', '', '   ', '#', 'x'.repeat(600), null, undefined, 42, {}]) {
      const none = worker()
      await none.tap({ url })
      expect(none.opened, String(url)).toEqual(['./'])

      const some = worker()
      const win = some.window()
      await some.tap({ url })
      expect(win.focused, String(url)).toBe(1)
      expect(win.navigated, String(url)).toEqual([])
      expect(win.messages, String(url)).toEqual([])
      expect(some.opened, String(url)).toEqual([])
    }
    const w = worker()
    await w.tap(undefined)
    expect(w.opened).toEqual(['./'])
  })

  it('navigates the window only when it cannot be messaged, and opens a new one when it cannot be navigated either', async () => {
    const cannotMessage = () => { throw new TypeError('detached') }
    const navigable = worker()
    const win = navigable.window({ postMessage: cannotMessage })
    await navigable.tap({ url: '#/food' })
    expect(win.navigated).toEqual([ORIGIN + '/#/food'])
    expect(navigable.opened).toEqual([])

    const neither = worker()
    neither.window({ postMessage: cannotMessage, navigate: async () => { throw new TypeError('not allowed') } })
    await neither.tap({ url: '#/food' })
    expect(neither.opened).toEqual([ORIGIN + '/#/food'])

    const noNavigate = worker()
    const plain = noNavigate.window({ navigate: undefined })
    await noNavigate.tap({ url: '#/food' })
    expect(plain.focused).toBe(1)
    expect(plain.messages).toHaveLength(1)
    expect(noNavigate.opened).toEqual([])
  })

  it('maps legacy routes exactly as the app does (lib/tab-route.js)', () => {
    const pairs = src => [...src.matchAll(/\[\s*'(\/[^']+)',\s*'(\/[^']+)'\s*\]/g)].map(m => [m[1], m[2]])
    const block = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)))
    const app = pairs(block(read('./tab-route.js'), 'const LEGACY = [', '\n]'))
    const sw = pairs(block(SW, 'const LEGACY_ROUTES = [', '\n]'))
    expect(app.length).toBeGreaterThan(10)
    expect(sw).toEqual(app)
    // …and the answers agree: the worker's address is the app's for every old prefix.
    return Promise.all(app.map(async ([from]) => {
      const w = worker()
      await w.tap({ url: '#' + from + '/x?y=1' })
      expect(w.opened[0], from).toBe(ORIGIN + '/#' + legacyPath(from + '/x', '?y=1', ''))
    }))
  })
})

describe('an update reaching an open app', () => {
  it('is announced to every open page once the new build is active', async () => {
    const w = worker()
    await (await w.caches.open(BUILD)).put('index.html', new Response('shell'))
    await w.caches.open('gains-rt-previous')
    const a = w.window(), b = w.window()
    await w.activate()
    for (const win of [a, b]) expect(win.messages).toEqual([{ type: 'gains-sw-updated', build: STAMP }])
  })

  it('is announced after a build from before the rename too', async () => {
    const w = worker()
    await (await w.caches.open(BUILD)).put('index.html', new Response('shell'))
    await w.caches.open('opengym-rt-previous')
    const a = w.window()
    await w.activate()
    expect(a.messages).toEqual([{ type: 'gains-sw-updated', build: STAMP }])
  })

  it('is not announced on a first install, or when nothing changed', async () => {
    const first = worker()
    await (await first.caches.open(BUILD)).put('index.html', new Response('shell'))
    const a = first.window()
    await first.activate()
    expect(a.messages).toEqual([])
  })

  it('is not announced when the shell did not cache (the install failed and the old build stays)', async () => {
    const w = worker()
    await w.caches.open('gains-rt-previous')
    const a = w.window()
    await w.activate()
    expect(a.messages).toEqual([])
  })

  it('does not fail the activation when a page cannot be reached', async () => {
    const w = worker()
    await (await w.caches.open(BUILD)).put('index.html', new Response('shell'))
    await w.caches.open('gains-rt-previous')
    w.window({ postMessage: () => { throw new Error('gone') } })
    await expect(w.activate()).resolves.toBeUndefined()
  })
})
