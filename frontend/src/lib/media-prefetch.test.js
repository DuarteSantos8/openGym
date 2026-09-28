// @vitest-environment node

/* The page's half of offline exercise media (#281): which URLs the plan needs, that only the
 * installed app fetches them ahead, when the connection is one to spend them on, and fetching
 * only what the worker's cache is missing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planMediaUrls, prefetchAllowed, prefetchMedia, startMediaPrefetch, installedApp, MEDIA_CACHE, PREFETCH_DELAY_MS } from './media-prefetch.js'
import { EXIDX, imgSrc, gifSrc } from './exercises.js'

const BASE = 'https://gym.test/app/'
const abs = src => new URL(src, BASE).href
const bench = EXIDX['0025'] || Object.values(EXIDX).find(e => e.gif)
const other = Object.values(EXIDX).find(e => e.gif && e.id !== bench.id)

const answer = (status = 200) => ({ ok: status < 400, status, arrayBuffer: async () => new ArrayBuffer(1) })
const cacheWith = urls => ({ match: async u => (urls.includes(u) ? {} : undefined) })

afterEach(() => { vi.useRealTimers() })

describe('planMediaUrls', () => {
  it('names the still and the animation of every exercise in the plan and the session in progress, once each', () => {
    const S = {
      routines: [{ ex: [{ id: bench.id }, { id: bench.id }] }, { ex: [{ id: 'custom-1' }, {}] }, null],
      active: { entries: [{ id: other.id }, { id: bench.id }] },
    }
    const urls = planMediaUrls(S, BASE, { ...EXIDX, 'custom-1': { id: 'custom-1', n: 'Mine' } })
    expect(urls.sort()).toEqual([abs(gifSrc(bench)), abs(imgSrc(bench)), abs(gifSrc(other)), abs(imgSrc(other))].sort())
  })

  it('an empty or missing plan needs nothing', () => {
    expect(planMediaUrls({}, BASE)).toEqual([])
    expect(planMediaUrls(null, BASE)).toEqual([])
    expect(planMediaUrls({ routines: [{ ex: [{ id: bench.id }] }] }, undefined)).toEqual([])
  })

  it('leaves out media a build points at another origin, which never passes through the worker', async () => {
    // The demo build's media comes from a CDN (VITE_IMG_BASE/VITE_GIF_BASE, read at load).
    vi.resetModules()
    vi.stubEnv('VITE_IMG_BASE', 'https://cdn.test/images/')
    vi.stubEnv('VITE_GIF_BASE', 'https://cdn.test/videos/')
    try {
      const fresh = await import('./media-prefetch.js')
      expect(fresh.planMediaUrls({ routines: [{ ex: [{ id: bench.id }] }] }, BASE)).toEqual([])
    } finally { vi.unstubAllEnvs(); vi.resetModules() }
  })
})

describe('prefetchAllowed', () => {
  it('spends data only where the browser does not say it costs something', () => {
    expect(prefetchAllowed({ onLine: true })).toBe(true)                                   // Safari, Firefox: no word
    expect(prefetchAllowed({ onLine: true, connection: { type: 'wifi', effectiveType: '4g' } })).toBe(true)
    expect(prefetchAllowed({ onLine: false })).toBe(false)
    expect(prefetchAllowed({ onLine: true, connection: { saveData: true, type: 'wifi' } })).toBe(false)
    expect(prefetchAllowed({ onLine: true, connection: { type: 'cellular', effectiveType: '4g' } })).toBe(false)
    expect(prefetchAllowed({ onLine: true, connection: { effectiveType: '2g' } })).toBe(false)
    expect(prefetchAllowed({ onLine: true, connection: { effectiveType: 'slow-2g' } })).toBe(false)
    // null, not undefined: undefined takes the default, and Node 22 has a global navigator of its own.
    expect(prefetchAllowed(null)).toBe(false)
  })
})

// A window as far as installedApp looks at one: its display mode, and iOS's navigator.standalone.
function fakeWindow({ standalone = false, iosStandalone, throws = false } = {}) {
  const listeners = new Set()
  const mql = { media: '(display-mode: standalone)', matches: standalone, addEventListener: (ev, fn) => listeners.add(fn), removeEventListener: (ev, fn) => listeners.delete(fn) }
  const win = {
    navigator: iosStandalone === undefined ? {} : { standalone: iosStandalone },
    // Called as a method, the way a browser insists on (a detached matchMedia throws there).
    matchMedia(q) {
      if (this !== win) throw new TypeError('Illegal invocation')
      if (throws) throw new Error('no display modes here')
      return q === mql.media ? mql : { media: q, matches: false }
    },
  }
  win.become = v => { mql.matches = v; listeners.forEach(fn => fn({ matches: v })) }
  win.listeners = listeners
  return win
}

describe('installedApp', () => {
  it('is the home-screen app: standalone display mode, or iOS Safari’s own flag', () => {
    expect(installedApp(fakeWindow({ standalone: true }))).toBe(true)
    expect(installedApp(fakeWindow({ iosStandalone: true }))).toBe(true)
  })

  it('a browser tab is not, nor is a browser that knows no display modes', () => {
    expect(installedApp(fakeWindow())).toBe(false)
    expect(installedApp(fakeWindow({ iosStandalone: false }))).toBe(false)
    expect(installedApp(fakeWindow({ throws: true }))).toBe(false)
    expect(installedApp({ navigator: {} })).toBe(false)
    expect(installedApp(undefined)).toBe(false)
  })
})

describe('prefetchMedia', () => {
  it('fetches only what the cache is missing, and reads each answer to the end', async () => {
    const read = vi.fn(async () => new ArrayBuffer(1))
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: read }))
    const r = await prefetchMedia(['a', 'b', 'c'], { cache: cacheWith(['b']), fetchImpl, allowed: () => true })
    expect(fetchImpl.mock.calls.map(c => c[0]).sort()).toEqual(['a', 'c'])
    expect(read).toHaveBeenCalledTimes(2)
    expect(r).toEqual({ wanted: 3, missing: 2, fetched: 2 })
  })

  it('gives up after three refusals in a row, and stops when the connection stops qualifying', async () => {
    const refused = vi.fn(async () => answer(401))
    const urls = [...Array(20)].map((_, i) => 'u' + i)
    const r = await prefetchMedia(urls, { fetchImpl: refused, allowed: () => true })
    expect(refused.mock.calls.length).toBeLessThanOrEqual(4)   // two lanes, one may be mid-flight
    expect(r.fetched).toBe(0)

    let budget = 3
    const ok = vi.fn(async () => answer())
    await prefetchMedia(urls, { fetchImpl: ok, allowed: () => budget-- > 0 })
    expect(ok).toHaveBeenCalledTimes(3)

    const down = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await prefetchMedia(urls, { fetchImpl: down, allowed: () => true })
    expect(down.mock.calls.length).toBeLessThanOrEqual(4)
  })
})

describe('startMediaPrefetch', () => {
  function setup({ controller = {}, S = { routines: [{ ex: [{ id: bench.id }] }] }, win = fakeWindow({ standalone: true }) } = {}) {
    const listeners = new Set()
    const store = { state: { S }, getState: () => store.state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
    store.set = S => { store.state = { S }; listeners.forEach(fn => fn(store.state)) }
    const cached = []
    const cachesApi = { open: vi.fn(async () => cacheWith(cached)) }
    // The window's own navigator, as in a browser: iOS's `standalone` lives there.
    const nav = Object.assign(win.navigator, { onLine: true, serviceWorker: { controller, addEventListener() {}, removeEventListener() {} } })
    const fetchImpl = vi.fn(async u => { cached.push(u); return answer() })
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubGlobal('location', { href: BASE })
    return { store, cachesApi, nav, fetchImpl, listeners, win }
  }
  afterEach(() => { vi.unstubAllGlobals() })
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

  it('waits for the app to settle, fetches the plan\'s media through the worker, then only what a plan change adds', async () => {
    vi.useFakeTimers()
    const { store, cachesApi, nav, fetchImpl, win } = setup()
    const stop = startMediaPrefetch(store, { win, nav, cachesApi })
    expect(fetchImpl).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(cachesApi.open).toHaveBeenCalledWith(MEDIA_CACHE)
    expect(fetchImpl.mock.calls.map(c => c[0]).sort()).toEqual([abs(gifSrc(bench)), abs(imgSrc(bench))].sort())

    // Something unrelated changes: nothing new to fetch.
    store.set({ ...store.state.S, unit: 'lb' })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // A routine gains an exercise: its two files, and only those.
    store.set({ routines: [{ ex: [{ id: bench.id }, { id: other.id }] }] })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(fetchImpl.mock.calls.slice(2).map(c => c[0]).sort()).toEqual([abs(gifSrc(other)), abs(imgSrc(other))].sort())
    stop()
  })

  it('does nothing without a worker in charge of the page, or on a connection that costs', async () => {
    vi.useFakeTimers()
    const a = setup({ controller: null })
    const stopA = startMediaPrefetch(a.store, { win: a.win, nav: a.nav, cachesApi: a.cachesApi })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(a.fetchImpl).not.toHaveBeenCalled()
    stopA()

    const b = setup()
    b.nav.connection = { saveData: true }
    const stop = startMediaPrefetch(b.store, { win: b.win, nav: b.nav, cachesApi: b.cachesApi })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(b.fetchImpl).not.toHaveBeenCalled()
    stop()

    expect(startMediaPrefetch(b.store, { win: b.win, nav: {}, cachesApi: b.cachesApi })).toBeTypeOf('function')
  })

  it('never on a cellular connection or with Data Saver, even in the installed app on iOS', async () => {
    vi.useFakeTimers()
    for (const connection of [{ type: 'cellular' }, { type: 'cellular', effectiveType: '4g', saveData: false }, { type: 'wifi', saveData: true }]) {
      const c = setup({ win: fakeWindow({ iosStandalone: true }) })
      c.nav.connection = connection
      const stop = startMediaPrefetch(c.store, { win: c.win, nav: c.nav, cachesApi: c.cachesApi })
      await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
      await flush()
      expect(c.fetchImpl, JSON.stringify(connection)).not.toHaveBeenCalled()
      stop()
    }
  })

  it('a browser tab fetches nothing ahead — not at start, not after a plan change', async () => {
    vi.useFakeTimers()
    const { store, cachesApi, nav, fetchImpl, win } = setup({ win: fakeWindow() })
    const stop = startMediaPrefetch(store, { win, nav, cachesApi })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    store.set({ routines: [{ ex: [{ id: bench.id }, { id: other.id }] }] })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(cachesApi.open).not.toHaveBeenCalled()
    stop()
  })

  it('the installed app on iOS fetches ahead, and so does a tab once it is moved into the app window', async () => {
    vi.useFakeTimers()
    const ios = setup({ win: fakeWindow({ iosStandalone: true }) })
    const stopIos = startMediaPrefetch(ios.store, { win: ios.win, nav: ios.nav, cachesApi: ios.cachesApi })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(ios.fetchImpl).toHaveBeenCalledTimes(2)
    stopIos()

    const tab = setup({ win: fakeWindow() })
    const stop = startMediaPrefetch(tab.store, { win: tab.win, nav: tab.nav, cachesApi: tab.cachesApi })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(tab.fetchImpl).not.toHaveBeenCalled()
    tab.win.become(true)
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    expect(tab.fetchImpl.mock.calls.map(c => c[0]).sort()).toEqual([abs(gifSrc(bench)), abs(imgSrc(bench))].sort())
    stop()
    expect(tab.win.listeners.size).toBe(0)
  })

  it('stops between files when the page stops being the installed app', async () => {
    vi.useFakeTimers()
    const { store, cachesApi, nav, win } = setup({ S: { routines: [{ ex: [{ id: bench.id }, { id: other.id }] }] } })
    const fetchImpl = vi.fn(async () => { win.become(false); return answer() })
    vi.stubGlobal('fetch', fetchImpl)
    const stop = startMediaPrefetch(store, { win, nav, cachesApi })
    await vi.advanceTimersByTimeAsync(PREFETCH_DELAY_MS)
    await flush()
    // Two lanes had each started one before the first answer came back; none after it.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2)
    stop()
  })
})
