// Offline exercise media for the installed web app (#281).
//
// The service worker keeps every animation and still it has served in a cache that outlives
// updates (public/sw.js, MEDIA). What it cannot do on its own is hold the media for a workout
// nobody has opened yet: a GIF was offline only if it had once been shown online. So once the app
// has settled, and again when the plan changes or the network comes back, the media for every
// exercise in the plan and in the session in progress is fetched through the worker, which keeps
// it. URLs already in the cache are skipped, so after the first run this is a cache lookup per
// exercise and no traffic.
//
// Only in the app installed on the home screen (installedApp). That is where a workout gets
// opened in a gym basement with no signal; a browser tab is someone looking at the app, and
// fetching a few megabytes of animations behind their back is not what they opened it for. A tab
// keeps the worker's ordinary on-demand cache: whatever it has shown stays available offline.
//
// And never when the browser says data costs something: Data Saver, a cellular connection, or a
// 2G-class one. Safari and Firefox say nothing about the connection, and there it runs; the set is
// bounded by the plan (a few MB for a typical one) and each file goes once.
//
// Not in the phone app: it has no service worker, and its media comes from the CDN.
import { EXIDX, imgSrc, gifSrc, isCustomEx } from './exercises.js'

// The worker's media cache, public/sw.js MEDIA. Duplicated because the worker is not bundled;
// sw-media.test.js pins the two together.
export const MEDIA_CACHE = 'opengym-media-v1'
// Long enough after boot or an edit that the app's own requests go first.
export const PREFETCH_DELAY_MS = 8000
const CONCURRENCY = 2
// A server that refuses three in a row (a gated instance answering a guest with 401, a proxy
// that is down) is not asked for the rest until the next run.
const MAX_FAILURES = 3

/** Every same-origin img/gif URL for the exercises in the plan and the active session. */
export function planMediaUrls(S, base = globalThis.location?.href, index = EXIDX) {
  if (!base) return []
  const ids = new Set()
  ;(S?.routines || []).forEach(r => (r?.ex || []).forEach(e => { if (e?.id) ids.add(e.id) }))
  ;(S?.active?.entries || []).forEach(en => { if (en?.id) ids.add(en.id) })
  const origin = new URL(base).origin
  const urls = new Set()
  for (const id of ids) {
    const ex = index[id]
    // A custom exercise's photo or video is not a file of the shipped dataset: it lives in the
    // local media store and has its own prefetch (lib/media-sync.js). An unknown id has nothing.
    if (!ex || isCustomEx(ex)) continue
    for (const src of [ex.gif && gifSrc(ex), ex.img && imgSrc(ex)]) {
      if (!src) continue
      const u = new URL(src, base)
      // Media on another origin (a build that points at a CDN) never passes through this
      // worker, so fetching it here would only warm the browser's HTTP cache.
      if (u.origin === origin) urls.add(u.href)
    }
  }
  return [...urls]
}

const STANDALONE = '(display-mode: standalone)'

/**
 * Whether this page runs as the app installed on the home screen, not in a browser tab: the
 * display mode the manifest asks for (`standalone`), or iOS Safari's own flag, which a home-screen
 * app there has had since before it knew display modes. `win.matchMedia` is called on `win` —
 * a detached matchMedia throws in a browser.
 */
export function installedApp(win = globalThis, nav = win?.navigator) {
  if (nav?.standalone === true) return true
  try { return !!win?.matchMedia?.(STANDALONE)?.matches } catch { return false }
}

/** Whether the connection is one to spend a few megabytes on without asking. */
export function prefetchAllowed(nav = globalThis.navigator) {
  if (!nav || nav.onLine === false) return false
  const c = nav.connection
  if (!c) return true
  if (c.saveData) return false
  if (c.type === 'cellular') return false
  if (/(^|-)2g$/.test(c.effectiveType || '')) return false
  return true
}

/**
 * Fetch whatever of `urls` the cache does not hold yet, through the worker. Two at a time,
 * and it stops as soon as the connection stops qualifying or the server keeps refusing.
 */
export async function prefetchMedia(urls, { cache, fetchImpl = globalThis.fetch, allowed = prefetchAllowed } = {}) {
  const missing = cache
    ? (await Promise.all(urls.map(async u => ((await cache.match(u).catch(() => null)) ? null : u)))).filter(Boolean)
    : urls.slice()
  let next = 0
  let fetched = 0
  let failures = 0
  const lane = async () => {
    while (next < missing.length && failures < MAX_FAILURES && allowed()) {
      const u = missing[next++]
      try {
        const res = await fetchImpl(u, { priority: 'low' })
        // Read to the end, so the worker's copy of the same stream is complete as well.
        await res.arrayBuffer()
        if (res.ok) { fetched++; failures = 0 } else failures++
      } catch (e) { failures++ }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane))
  return { wanted: urls.length, missing: missing.length, fetched }
}

/**
 * Keep the plan's media offline for as long as the page is open, while it runs as the installed
 * app. `store` is the zustand store (getState/subscribe). Returns a function that stops it.
 */
export function startMediaPrefetch(store, { delay = PREFETCH_DELAY_MS, win = globalThis, nav = win?.navigator, cachesApi = globalThis.caches } = {}) {
  const sw = nav?.serviceWorker
  if (!sw || !cachesApi) return () => {}
  let timer = null
  let running = false
  // The URL set the last complete run covered; the same set again has nothing left to fetch.
  let done = ''
  // Asked on every run, and between files, not once at start: a desktop browser can move an open
  // tab into the installed app's window (and back), and a phone can leave Wi-Fi mid-run.
  const allowed = () => installedApp(win, nav) && prefetchAllowed(nav)
  const run = async () => {
    timer = null
    // Only through a worker that is in charge of this page: without one nothing would be kept.
    if (running || !sw.controller || !allowed()) return
    const urls = planMediaUrls(store.getState().S)
    const key = urls.join('\n')
    if (!urls.length || key === done) return
    running = true
    try {
      const r = await prefetchMedia(urls, { cache: await cachesApi.open(MEDIA_CACHE), allowed })
      if (r.fetched === r.missing) done = key
    } catch (e) { /* best effort: the next change or reconnect tries again */ }
    finally { running = false }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(() => run(), { timeout: 30000 })
      else run()
    }, delay)
  }
  let seen = store.getState().S
  const unsubscribe = store.subscribe(st => {
    const S = st.S
    if (S?.routines === seen?.routines && S?.active === seen?.active) return
    seen = S
    schedule()
  })
  // A tab moved into the app's window becomes the installed app without a reload.
  let mode = null
  try { mode = win?.matchMedia?.(STANDALONE) || null } catch { /* no display modes to follow */ }
  globalThis.addEventListener?.('online', schedule)
  sw.addEventListener?.('controllerchange', schedule)
  mode?.addEventListener?.('change', schedule)
  schedule()
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
    globalThis.removeEventListener?.('online', schedule)
    sw.removeEventListener?.('controllerchange', schedule)
    mode?.removeEventListener?.('change', schedule)
  }
}
