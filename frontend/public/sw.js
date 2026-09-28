/* openGym service worker — the app shell and its hashed assets are cached at install and kept
   fresh network-first, media (img/gif) cache-first in a cache of its own. A home-screen app
   reopened without a network comes back from here with the same bundle it last ran; the state
   itself lives in localStorage. `CACHE` carries the build hash (vite.config.js rewrites it), so
   every deploy is a new worker with its own cache and the previous build's files are dropped on
   activate; the media cache (`MEDIA`) is kept across builds. */
const CACHE = 'opengym-rt-__BUILD__'

/* Exercise media (img/, gif/) lives in a cache of its own that outlives builds (#281). It used to
   share the build's cache, so every update swept every animation along with the old bundle, and
   an installed app opened offline after an update showed broken tiles for exercises it had shown
   the day before. The media never changes under a given URL, so there is nothing to invalidate.

   It is bounded instead: past MEDIA_MAX_BYTES (or MEDIA_MAX_ITEMS, for a server that sends no
   Content-Length) the least recently used entries go first. The Cache API keeps entries in the
   order they were written, so a hit is written back once per worker lifetime to move it to the
   end: least recently used as far as this worker has seen, which is what "LRU-ish" means here.
   The whole catalogue is about 140 MB, so the cap only bites for someone who has browsed most of
   it. lib/media-prefetch.js fills this cache ahead for the exercises in the plan — in the app
   installed on the home screen only; a browser tab gets what it has shown and nothing more — and
   names it too, so a new name has to change there as well (sw-media.test.js pins the two
   together). */
const MEDIA = 'opengym-media-v1'
const MEDIA_MAX_BYTES = 150 * 1024 * 1024
const MEDIA_MAX_ITEMS = 3000
// What an entry without a Content-Length is counted as: a little above the catalogue's average.
const MEDIA_GUESS_BYTES = 64 * 1024
// Trimming lists the whole cache, so it runs after every MEDIA_TRIM_EVERY new entries rather
// than after each one, and once when a new worker activates.
const MEDIA_TRIM_EVERY = 20
const isMediaPath = p => p.includes('/img/') || p.includes('/gif/')

// What the shell needs to boot without a network: index.html plus every script/style/icon it
// references. Read from the served index.html so the list follows the build, not a hand-kept
// manifest that would go stale the first time a chunk is renamed.
async function precache() {
  const c = await caches.open(CACHE)
  const res = await fetch('index.html', { cache: 'no-cache' })
  // Whatever came back is not the shell: the server was restarting mid-deploy (5xx), or the
  // request was answered by something else after a redirect — an auth proxy in front (Authelia,
  // Cloudflare Access; docs/SELF_HOSTING.md) sends its login page once the session there expires.
  // Throwing fails the install, which is the only thing that keeps the build already
  // on this device, and its cache, in place; a returned-quietly install activates and sweeps.
  if (!res.ok || res.redirected) throw new Error('precache: index.html ' + res.status + (res.redirected ? ' redirected' : ''))
  const html = await res.text()
  const refs = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
    .filter(u => /\.(?:js|css|png|svg|webmanifest|json)(?:\?|$)/.test(u) && !/^(?:https?:)?\/\//.test(u)))]
  // The scripts and the stylesheets ARE the app. Every sub-resource used to be best-effort, so an
  // install that got index.html and lost one chunk to a flaky connection still activated, still
  // swept the build this device came from, and the next offline open was a shell with no code:
  // a blank page. A chunk that will not cache fails the install instead, which keeps the working
  // build and its cache exactly where they are. Images, icons and the manifest stay best-effort —
  // a missing icon is not a broken app.
  const code = refs.filter(u => /\.(?:js|css)(?:\?|$)/.test(u))
  // Fetched by hand rather than with `cache.add`, for the same reason index.html is: `add` takes
  // a REDIRECT for an answer, and an auth proxy in front answers every request with its login
  // page once the session there expires. A 200 of HTML stored under the main bundle's URL is
  // worse than nothing cached at all —
  // the install would report success and then sweep the build that still worked.
  await Promise.all(code.map(async u => {
    const r = await fetch(u, { cache: 'no-cache' }).catch(e => { throw new Error('precache: ' + u + ' — ' + (e?.message || e)) })
    if (!r.ok || r.redirected) throw new Error('precache: ' + u + ' ' + r.status + (r.redirected ? ' redirected' : ''))
    await c.put(u, r)
  }))
  await Promise.all(refs.filter(u => !code.includes(u)).map(u => c.add(u).catch(() => {})))
  // The shell goes in last, so activate's guard — an index.html in THIS build's cache — means the
  // whole shell is there rather than just its first file.
  await c.put('index.html', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // The previous build's files are what a reopen without a network comes back from, so they go
    // only once this build's shell is really in its own cache. An install that never got the
    // shell used to take them anyway, and the app opened on the browser's error page until the
    // next load with a network.
    const c = await caches.open(CACHE)
    if (await c.match('index.html')) {
      const old = (await caches.keys()).filter(k => k !== CACHE && k !== MEDIA)
      // A build from before MEDIA existed kept its media in its own cache: move it across first,
      // so the first update to this worker does not cost what the device already had offline.
      await Promise.all(old.map(k => adoptMedia(k).catch(() => {})))
      await Promise.all(old.map(k => caches.delete(k)))
      await trimMedia().catch(() => {})
    }
    await self.clients.claim()
  })())
})

// Only a real answer is kept. A gated instance answers a lapsed session with 401, and an auth
// proxy in front with its login page, a 200 of HTML after a redirect; stored under an image's
// URL, that would stand in for the animation for good, since nothing sweeps this cache.
const realMedia = res => {
  const type = (res.headers && res.headers.get('content-type')) || ''
  return res.ok && !res.redirected && !/text\/html/i.test(type)
}

async function adoptMedia(name) {
  const from = await caches.open(name)
  const media = (await from.keys()).filter(r => { try { return isMediaPath(new URL(r.url || r, location.href).pathname) } catch { return false } })
  if (!media.length) return
  const to = await caches.open(MEDIA)
  for (const r of media) {
    if (await to.match(r)) continue
    // A build before this one kept any ok answer, a login page included. It went with that
    // build's cache; carried into this one, it would stay.
    const res = await from.match(r)
    if (res && realMedia(res)) await to.put(r, res)
  }
}

let mediaPuts = 0
// Oldest first, which after the write-backs below is least recently used first.
async function trimMedia() {
  if (!(await caches.keys()).includes(MEDIA)) return
  const c = await caches.open(MEDIA)
  const keys = await c.keys()
  const sizes = await Promise.all(keys.map(k => c.match(k).then(r => Number(r && r.headers && r.headers.get('content-length')) || MEDIA_GUESS_BYTES, () => MEDIA_GUESS_BYTES)))
  let bytes = sizes.reduce((a, b) => a + b, 0)
  let items = keys.length
  for (let i = 0; i < keys.length && (bytes > MEDIA_MAX_BYTES || items > MEDIA_MAX_ITEMS); i++) {
    await c.delete(keys[i])
    bytes -= sizes[i]; items--
  }
}

// URLs written back this worker lifetime; see MEDIA above.
const touched = new Set()
function media(e) {
  return caches.open(MEDIA).then(c => c.match(e.request).then(hit => {
    if (hit) {
      if (!touched.has(e.request.url)) {
        touched.add(e.request.url)
        const copy = hit.clone()
        e.waitUntil(c.put(e.request, copy).catch(() => {}))
      }
      return hit
    }
    return fetch(e.request).then(res => {
      if (realMedia(res)) {
        touched.add(e.request.url)
        const copy = res.clone()
        e.waitUntil(c.put(e.request, copy).then(() => { if (++mediaPuts >= MEDIA_TRIM_EVERY) { mediaPuts = 0; return trimMedia() } }).catch(() => {}))
      }
      return res
    })
  }))
}

// The payload is parsed inside waitUntil: a push whose handler throws before showing anything is
// a "silent push", which Chrome counts against the site and eventually revokes. A body that is
// not JSON still shows a notification.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let data = {}
    try { data = e.data ? e.data.json() : {} } catch { data = { body: (() => { try { return e.data.text() } catch { return '' } })() } }
    // One alert per kind: a new rest-timer push replaces the last one instead of stacking
    // up in the tray (issue #172). `tag` alone should do that, but iOS keeps every one, so
    // the previous notification with the same tag is closed by hand first.
    const tag = data.tag || 'opengym'
    try { for (const n of await self.registration.getNotifications({ tag })) n.close() } catch {}
    await self.registration.showNotification(data.title || 'openGym', {
      body: data.body || '',
      icon: 'icon-512.png',
      badge: 'icon-180.png',
      tag,
      renotify: true
    })
  })())
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})
// The push service rotated the subscription (key change, expiry): subscribe again with the same
// server key and tell the server, so the row it holds keeps pointing at this browser.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const old = e.oldSubscription || (await self.registration.pushManager.getSubscription())
    const key = e.newSubscription?.options?.applicationServerKey || old?.options?.applicationServerKey
    if (!key) return
    const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await fetch('api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) }).catch(() => {})
  })())
})

// The API sits next to the app, wherever the app is served: /api/ at the site root, /myGym/api/
// under a subpath (#238). Matching '/api/' alone let a subpath deployment's data answers into
// the network-first branch below, which cached them and handed an old document back as a 200
// once the network was gone — the page then took it for the server's word. The Cache API ignores
// the API's own `Cache-Control: no-store`, so the worker has to know to stay out of the way.
const API = (() => { try { return new URL('api/', location.href).pathname } catch { return '/api/' } })()

// How long a request for the app itself waits on the network before a cached copy answers it.
const NET_WAIT_MS = 3000

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith(API)) return    // never cache auth/data

  if (isMediaPath(url.pathname)) {
    e.respondWith(media(e))
    return
  }
  // Network first; the copy for the cache is cloned before the response is handed to the page —
  // cloning later, once the page has started reading the body, throws and caches nothing, which
  // is why the shell never used to survive an offline reload.
  // A dead radio does not reject fetch() quickly — it just never settles — so a cold-launch of
  // the installed app with no network stayed on a blank screen forever, with the cache fallback
  // never getting a chance to run (issue #274). So a request the network has not answered within
  // NET_WAIT_MS is answered from the cache, when the cache has it. Nothing is aborted: an abort
  // that fires once the headers are in errors the body the page is still reading, and on a slow
  // connection a locale pack or a chunk that was on its way failed outright, every start again,
  // since a body that never finishes is never cached either (and AbortSignal.timeout, which the
  // abort used, does not exist before iOS 16: the handler threw before it answered at all, the
  // cache fallback with it). A request the cache cannot answer keeps waiting for the network, as
  // it always did; and the network's answer, whenever it comes, still refreshes the cache.
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then(hit =>
    hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))
  e.respondWith(new Promise(resolve => {
    const slow = setTimeout(() => fromCache().then(hit => { if (hit) resolve(hit) }, () => {}), NET_WAIT_MS)
    fetch(e.request).then(res => {
      clearTimeout(slow)
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}) }
      resolve(res)
    }, () => {
      clearTimeout(slow)
      resolve(fromCache())
    })
  }))
})
