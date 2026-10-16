/* Gains service worker — the app shell and its hashed assets are cached at install and kept
   fresh network-first, media (img/gif) cache-first in a cache of its own. A home-screen app
   reopened without a network comes back from here with the same bundle it last ran; the state
   itself lives in localStorage. `CACHE` carries the build hash (vite.config.js rewrites it), so
   every deploy is a new worker with its own cache and the previous build's files are dropped on
   activate; the media cache (`MEDIA`) is kept across builds.

   One origin, one worker, several apps: the same origin also serves NutriTrace (nt/api/) and the
   hub (hub/api/), and anything else the site grows. So the worker (1) only ever creates and
   deletes caches whose names start with PREFIX, and (2) only ever caches what an allow-list names
   (cacheable below): the app shell, its built files, its icons. Anything else, an endpoint added
   next year included, goes to the network untouched.

   How a deploy reaches an open app: a new worker installs (the whole shell must cache, or the
   install fails and the build on the device stays), skips waiting and claims every open page, so
   the new build serves from then on. A page that was already open keeps the JavaScript it loaded,
   though, and is not reloaded: it can run old code against the new build's files and API until
   it is. The worker therefore tells every open page (a message of type UPDATED_MSG, sent once the
   new build is active) and leaves the reload to the page, which knows whether a set is half
   typed: lib/sw-update.js offers a "new version is ready" toast with a Reload action, unless the
   message's `build` is the build the page itself runs (the page whose fresh index.html started
   the install), and only once per page. The previous build's chunks are gone with its cache, so an old page that loads a lazy
   chunk by its old name only gets it while the server still has that file. */
const PREFIX = 'gains-'
// The build stamp (vite.config.js). The same value is written into index.html as
// <meta name="gains-build">, which is how a page knows which build it is running
// (lib/sw-update.js): a page compares it with the `build` of UPDATED_MSG.
const BUILD = '__BUILD__'
const CACHE = PREFIX + 'rt-' + BUILD
// Caches from before the prefix was renamed from `opengym-`: the old builds' shells, the media
// cache and the device id. Their data is moved across and they are deleted by activate, every
// time it runs, not only once: a tab still running the old JavaScript keeps writing
// `opengym-device` and rebuilds `opengym-media-v1` after the switch, which would store the
// media twice. Only a cache holding live data survives a sweep, and none of these does (the
// shell of a previous build is still live until this build's own shell is cached; see activate).
// A rollback to a build from before the rename does the same to us: its activate deletes every
// cache but its own, `gains-*` included, so the media is downloaded again.
const LEGACY = /^opengym-/
const LEGACY_BUILD = /^opengym-rt-/
// Posted to every open page when a newer build has taken over; see above.
const UPDATED_MSG = 'gains-sw-updated'
// Posted to the window a notification tap focuses; the page sets its own location.hash, because
// WindowClient.navigate() is a real navigation (and not available everywhere) for what is only a
// route change inside the page.
const NAVIGATE_MSG = 'gains-sw-navigate'
// Where the page leaves this browser's push device id (lib/push.js shareDeviceId) for the
// pushsubscriptionchange handler below, which has no localStorage to read it from. Not a build
// cache, so activate's sweep leaves it alone.
const DEVICE_CACHE = PREFIX + 'device'
const DEVICE_URL = '/opengym-device-id'

/* Exercise media (img/, gif/) lives in a cache of its own that outlives builds (#281). It used to
   share the build's cache, so every update swept every animation along with the old bundle, and
   an installed app opened offline after an update showed broken tiles for exercises it had shown
   the day before. The media never changes under a given URL, so there is nothing to invalidate.

   It is bounded instead: past MEDIA_MAX_BYTES (or MEDIA_MAX_ITEMS, for a server that sends no
   Content-Length) the least recently used entries go first. The Cache API keeps entries in the
   order they were written, so a hit is written back once per worker lifetime to move it to the
   end: least recently used as far as this worker has seen, which is what "LRU-ish" means here.
   The whole catalogue is about 100 MB of stills and clips, so the cap only bites for someone who has browsed most of
   it. lib/media-prefetch.js fills this cache ahead for the exercises in the plan — in the app
   installed on the home screen only; a browser tab gets what it has shown and nothing more — and
   names it too, so a new name has to change there as well (sw-media.test.js pins the two
   together). */
const MEDIA = PREFIX + 'media-v1'
const MEDIA_MAX_BYTES = 150 * 1024 * 1024
const MEDIA_MAX_ITEMS = 3000
// What an entry without a Content-Length is counted as: a little above the catalogue's average.
const MEDIA_GUESS_BYTES = 64 * 1024
// Trimming lists the whole cache, so it runs after every MEDIA_TRIM_EVERY new entries rather
// than after each one, and once when a new worker activates.
const MEDIA_TRIM_EVERY = 20
// Where the app is served (the site root, or /myGym/), for every path decision below.
const SCOPE = (() => { try { return new URL('./', location.href).pathname } catch { return '/' } })()
// The catalogue's stills and clips (exercise-media/), and img/ and gif/ where an older
// docker-compose still mounts them, all directly under the app's own path. Not a substring match:
// any other path that happens to contain /img/ (a user's upload, a future endpoint) is not media.
// The custom exercises' photos and videos (/api/media/{hash}, api/media.js) are not here either:
// they are per-account, sit behind the API and are kept in IndexedDB by the page (media-store.js).
const MEDIA_DIRS = ['exercise-media/still/', 'exercise-media/clip/', 'img/', 'gif/']
const isMediaPath = p => p.startsWith(SCOPE) && MEDIA_DIRS.some(d => p.startsWith(SCOPE + d))

// The code the app loads only when it needs it (the photo and video ingest, the QR reader...),
// listed by the build (vite.config.js, scripts/sw-stamp.mjs). Without it the first photo added
// offline after an update had no ingest to run. Unstamped (a dev server, a test) it is empty.
const LAZY = '__LAZY__'
const lazyAssets = () => { try { const a = JSON.parse(LAZY); return Array.isArray(a) ? a : [] } catch { return [] } }

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
  // Best effort, like the icons: a chunk missing here is fetched when it is needed, as before, and
  // must not keep a working build from installing. Fetched by hand for the same redirect reason.
  await Promise.all(lazyAssets().filter(u => !code.includes(u)).map(async u => {
    try {
      const r = await fetch(u, { cache: 'no-cache' })
      if (r.ok && !r.redirected) await c.put(u, r)
    } catch { /* fetched on demand instead */ }
  }))
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
    const shell = !!(await c.match('index.html'))
    // Only what this worker made is its to delete: a cache of ours that is not this build, the
    // media or the device id (not a build, so an update never sweeps it), or one of the
    // pre-rename `opengym-` caches. A cache that belongs to anything else on the origin is
    // never listed, let alone deleted.
    const keys = await caches.keys()
    const builds = shell ? keys.filter(k => k !== CACHE && k.startsWith(PREFIX) && k !== MEDIA && k !== DEVICE_CACHE) : []
    // The pre-rename media and device caches hold nothing that is not carried across below, so
    // they go on every activation; the old builds' shells only with the guard above.
    const legacy = keys.filter(k => LEGACY.test(k) && (shell || !LEGACY_BUILD.test(k)))
    // A build from before MEDIA existed kept its media in its own cache, and the pre-rename
    // media cache is one too: move it across first, so the first update to this worker does not
    // cost what the device already had offline.
    await Promise.all([...builds, ...legacy].map(k => adoptMedia(k).catch(() => {})))
    await Promise.all(legacy.filter(k => k === 'opengym-device').map(k => adoptDevice(k).catch(() => {})))
    await Promise.all([...builds, ...legacy].map(k => caches.delete(k)))
    await trimMedia().catch(() => {})
    // A build was on this device before this one: an update, not a first install.
    const updated = builds.length > 0 || legacy.some(k => LEGACY_BUILD.test(k))
    await self.clients.claim()
    if (updated) {
      try { for (const w of await self.clients.matchAll({ type: 'window' })) w.postMessage({ type: UPDATED_MSG, build: BUILD }) } catch { /* the page finds out on its next load */ }
    }
  })())
})

// The device id the page left in the pre-rename cache, carried into this one: a push
// subscription that rotates before the page has run again has nowhere else to read it from.
async function adoptDevice(name) {
  const hit = await (await caches.open(name)).match(DEVICE_URL)
  if (!hit) return
  const to = await caches.open(DEVICE_CACHE)
  if (!(await to.match(DEVICE_URL))) await to.put(DEVICE_URL, hit)
}

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

// A <video> asks for its clip in byte ranges. The network's 206 cannot be cached (cache.put
// refuses a partial answer), so a clip was never kept; and a whole 200 handed to a range request
// is a clip iOS Safari will not play. So the cache holds the whole file, fetched without a Range,
// and a range request is answered with a 206 cut from it. One range, the only kind a player asks
// for; anything else gets the whole file.
const rangeOf = req => (req.headers && typeof req.headers.get === 'function' && req.headers.get('range')) || ''
async function slice(res, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  const type = res.headers.get('content-type') || 'application/octet-stream'
  const body = await res.arrayBuffer()
  const size = body.byteLength
  let start = m && m[1] !== '' ? Number(m[1]) : NaN
  let end = m && m[2] !== '' ? Number(m[2]) : size - 1
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1 }
  if (!m || !Number.isFinite(start)) return new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } })
  if (start >= size || end < start) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } })
  end = Math.min(end, size - 1)
  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' }
  })
}

// URLs written back this worker lifetime; see MEDIA above.
const touched = new Set()
function media(e) {
  const range = rangeOf(e.request)
  return caches.open(MEDIA).then(c => c.match(e.request).then(hit => {
    if (hit) {
      if (!touched.has(e.request.url)) {
        touched.add(e.request.url)
        const copy = hit.clone()
        e.waitUntil(c.put(e.request, copy).catch(() => {}))
      }
      return range ? slice(hit, range) : hit
    }
    // The whole file for a range request: the one answer that can be kept.
    return fetch(range ? e.request.url : e.request).then(res => {
      const whole = range ? res.status === 200 : true
      if (whole && realMedia(res)) {
        touched.add(e.request.url)
        const copy = res.clone()
        e.waitUntil(c.put(e.request.url, copy).then(() => { if (++mediaPuts >= MEDIA_TRIM_EVERY) { mediaPuts = 0; return trimMedia() } }).catch(() => {}))
        if (range) return slice(res, range)
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
    await self.registration.showNotification(data.title || 'Gains', {
      body: data.body || '',
      icon: 'brand/icon-512.png',
      badge: 'brand/badge-96.png',
      tag,
      renotify: true,
      // Where a tap goes (notificationTarget decides whether it is let through). Kept as given:
      // the check belongs to the tap, which is when it matters.
      data: { url: typeof data.url === 'string' ? data.url : '' }
    })
  })())
})

// Paths from before the tabs, in the notifications already delivered (the Coach push says
// #/coach). The app redirects them too (lib/tab-route.js, where this table comes from; a test
// pins the two together), but landing on the right page directly saves a hop. Longest first.
const LEGACY_ROUTES = [
  ['/plan/r', '/train/routines'], ['/plan', '/train/schedule'], ['/checkin', '/train/checkin'],
  ['/workout', '/train/workout'], ['/history', '/train/history'], ['/library', '/train/exercises'],
  ['/muscles', '/train/exercises/muscles'], ['/coach', '/train/coach'], ['/stats', '/progress'],
  ['/structural-balance', '/progress/strength/balance'], ['/progress-photos', '/progress/body/photos'],
  ['/measurements', '/progress/body/measurements'], ['/body', '/progress/body'],
  ['/settings', '/me'], ['/admin', '/me/admin']
]
// Where a notification tap goes, as an absolute URL inside this app, or null. Only a hash route of
// this very app is accepted: a payload is data from a server, and a tap must never open another
// site, a path on this origin that is not the app, or a script URL. `#/…`, `./#/…` and the app's
// own absolute URL with a hash all qualify; the route is mapped from a legacy path to its tab.
function notificationTarget(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 500) return null
  let base, u
  try {
    base = new URL('./', location.href)
    u = new URL(raw, base)
  } catch { return null }
  if (u.origin !== location.origin) return null
  if (u.pathname !== base.pathname && u.pathname !== base.pathname + 'index.html') return null
  if (!u.hash.startsWith('#/')) return null
  const [path, ...q] = u.hash.slice(1).split('?')
  const query = q.length ? '?' + q.join('?') : ''
  // The one old address that moved to a different place than its prefix says (tab-route.js).
  if (path === '/stats' && /[?&]focus=weekly-volume\b/.test(query)) return base.href + '#/progress/load' + query
  const hit = LEGACY_ROUTES.find(([from]) => path === from || path.startsWith(from + '/'))
  return base.href + '#' + (hit ? hit[1] + path.slice(hit[0].length) : path) + query
}

// A tap focuses a window of the app and takes it to the target; with none open, opens the target.
// A payload with no (or a refused) target keeps what a tap always did: focus, or open the app.
// The focused window is told to go there (NAVIGATE_MSG) and sets its own location.hash: the route
// changes inside the page, with no reload and no lost state (a set half typed, a running timer).
// WindowClient.navigate() is only the fallback for a window that cannot be messaged, and a window
// that cannot be navigated either gets a new one at the target.
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = notificationTarget(e.notification.data && e.notification.data.url)
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(async clients => {
    const c = clients.find(c => 'focus' in c)
    if (!c) return self.clients.openWindow(target || './')
    await c.focus()
    if (!target) return
    try { c.postMessage({ type: NAVIGATE_MSG, url: target }); return } catch { /* try navigating it */ }
    try { await c.navigate(target) } catch { await self.clients.openWindow(target) }
  }))
})
// The push service rotated the subscription (key change, expiry): subscribe again with the same
// server key and tell the server, so the row it holds keeps pointing at this browser. With the
// device id the page registers with: without one, this browser's rest-timer alert goes to every
// device of the account until the page's next boot sync sees the missing id and sends it again.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const old = e.oldSubscription || (await self.registration.pushManager.getSubscription())
    const key = e.newSubscription?.options?.applicationServerKey || old?.options?.applicationServerKey
    if (!key) return
    const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const deviceId = await caches.open(DEVICE_CACHE).then(c => c.match(DEVICE_URL)).then(r => r ? r.text() : undefined).catch(() => undefined)
    await fetch('api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), deviceId }) }).catch(() => {})
  })())
})

// The API sits next to the app, wherever the app is served: /api/ at the site root, /myGym/api/
// under a subpath (#238). Matching '/api/' alone let a subpath deployment's data answers into
// the network-first branch below, which cached them and handed an old document back as a 200
// once the network was gone — the page then took it for the server's word. The Cache API ignores
// the API's own `Cache-Control: no-store`, so the worker has to know to stay out of the way.
const API = (() => { try { return new URL('api/', location.href).pathname } catch { return '/api/' } })()
// Gains' gateway sits beside it on the same origin: NutriTrace at nt/api/, the hub's sync routes
// at hub/api/. Their answers are per-account data, so caching them would replay one account's
// diary to whoever opens the app offline next.
const GATEWAY = ['nt/api/', 'hub/api/'].flatMap(p => {
  try { return ['/' + p, new URL(p, location.href).pathname] } catch { return ['/' + p] }
})

// How long a request for the app itself waits on the network before a cached copy answers it.
const NET_WAIT_MS = 3000

// What the network-first branch below may keep: the app itself and nothing else, named by an
// allow-list rather than a list of what to leave out. A deny-list only protects the endpoints
// someone remembered to write down; the gateway's nt/api/ and hub/api/ were each missed once, and
// the Cache API ignores a response's own `Cache-Control: no-store`. Paths are taken relative to
// where the worker is served (the site root, or /myGym/), so the same rule holds under a subpath:
//   the shell        '' and index.html
//   built files      assets/…  (scripts, styles and the language packs, hashed per build)
//   brand and icons  brand/…, and the files at the app's root (manifest, favicon, touch icons)
// The worker's own script is not one of them. Exercise media has its own branch, ahead of this.
const ROOT_FILE = /^[^/]+\.(?:png|svg|ico|webmanifest|json|css|js)$/
function cacheable(pathname) {
  if (!pathname.startsWith(SCOPE)) return false
  const rel = pathname.slice(SCOPE.length)
  if (rel === '' || rel === 'index.html') return true
  if (rel.startsWith('assets/') || rel.startsWith('brand/')) return true
  return rel !== 'sw.js' && ROOT_FILE.test(rel)
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith(API)) return    // never cache auth/data
  if (GATEWAY.some(p => url.pathname.startsWith(p))) return

  if (isMediaPath(url.pathname)) {
    e.respondWith(media(e))
    return
  }
  // Not the app: the browser handles it as if there were no worker.
  if (!cacheable(url.pathname)) return
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
