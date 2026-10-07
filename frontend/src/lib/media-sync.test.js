// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMediaSync } from './media-sync.js'
import { createMediaStore, memoryBackend } from './media-store.js'
import { sha256Hex } from './sha256.js'
import { _resetMediaOwed, getMediaStatus } from './media-owed.js'
import { jpeg, png } from './media-samples.test-util.js'
import { installedApp, prefetchAllowed } from './media-prefetch.js'
import { _setLangState } from './i18n-core.js'

const MB = 1024 * 1024
const hex = c => c.repeat(64)
const refOf = (hash, poster, over = {}) => ({ kind: 'image', hash, mime: 'image/webp', size: 1000, width: 800, height: 600, ...(poster ? { poster: { hash: poster, mime: 'image/webp', size: 100, width: 480, height: 360 } } : {}), at: 1, ...over })

function appStore(init) {
  let st = { ready: true, user: { id: 'u1' }, config: { media: { imageMB: 2, gifMB: 8, videoMB: 40, videoSec: 60, quotaMB: 200 } }, sync: { lastSynced: 0 }, S: { customEx: [] }, stashedMediaHashes: async () => new Set(), ...init }
  const subs = new Set()
  return {
    getState: () => st,
    setState: patch => { st = { ...st, ...patch }; for (const f of subs) f(st) },
    subscribe: f => { subs.add(f); return () => subs.delete(f) }
  }
}

let clock, media, toast, api, apiUpload, apiBlob, allowed, storage
const make = (store, over = {}) => createMediaSync({ store, media, api, apiUpload, apiBlob, toast, allowed: () => allowed, now: () => clock, locks: null, storage, ...over })
const put = (hash, size = 10, mime = 'image/webp') => media.put(hash, new Blob([new Uint8Array(size)]), { mime, pending: true })

beforeEach(() => {
  _resetMediaOwed()
  clock = 10_000_000
  media = createMediaStore(memoryBackend(), { now: () => clock })
  toast = vi.fn()
  allowed = true
  api = vi.fn(async (path, { body }) => ({ missing: JSON.parse(body).hashes, usage: { bytes: 0, count: 0, quotaBytes: 200 * MB } }))
  apiUpload = vi.fn(async () => ({ ok: true, existed: false }))
  apiBlob = vi.fn()
  const mem = new Map()
  storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) }
})

describe('syncMedia', () => {
  it('asks /missing about every referenced file, posters first, and sends only what this device holds', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a'), hex('b')) }, { id: 'c', media: refOf(hex('c'), hex('d')) }] }
    await put(hex('a')); await put(hex('b')); await put(hex('d'))
    const sync = make(appStore({ S }))
    await sync.syncMedia()
    expect(JSON.parse(api.mock.calls[0][1].body).hashes).toEqual([hex('b'), hex('d'), hex('a'), hex('c')])
    expect(apiUpload.mock.calls.map(c => c[0])).toEqual([hex('b'), hex('d'), hex('a')].map(h => '/api/media/' + h))
    expect(apiUpload.mock.calls[0][2]).toBe('image/webp')
    expect([...media.pendingNow()]).toEqual([])
    expect(getMediaStatus()).toMatchObject({ unavailable: 1, pending: 0 })
  })

  it('marks what the server already has as synced without sending it', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    api.mockResolvedValueOnce({ missing: [], usage: { bytes: 10, count: 1, quotaBytes: 0 } })
    await make(appStore({ S })).syncMedia()
    expect(apiUpload).not.toHaveBeenCalled()
    expect([...media.pendingNow()]).toEqual([])
  })

  it('does nothing for a guest, or signed in to a server without media', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    await make(appStore({ S, user: null })).syncMedia()
    await make(appStore({ S, config: { invite_only: false } })).syncMedia()
    expect(api).not.toHaveBeenCalled()
    expect([...media.pendingNow()]).toEqual([hex('a')])
  })

  it('asks for the config when the start had none (an offline boot)', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    const loadConfig = vi.fn(async () => ({ media: { imageMB: 2 } }))
    await make(appStore({ S, config: null, loadConfig })).syncMedia()
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(apiUpload).toHaveBeenCalledTimes(1)
  })

  it('stops on a full quota and says so once per streak', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }, { id: 'c', media: refOf(hex('c')) }] }
    await put(hex('a')); await put(hex('c'))
    apiUpload.mockRejectedValue(Object.assign(new Error('full'), { status: 413, code: 'media-quota', data: { usedMB: 199.6, quotaMB: 200 } }))
    const sync = make(appStore({ S }))
    await sync.syncMedia()
    await sync.syncMedia({ force: true })
    expect(apiUpload).toHaveBeenCalledTimes(2)          // one per run: the run stops at the first
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toContain('200')
    apiUpload.mockResolvedValue({ ok: true })
    await sync.syncMedia({ force: true })
    apiUpload.mockRejectedValue(Object.assign(new Error('full'), { status: 413, code: 'media-quota', data: {} }))
    await put(hex('e'))
    await sync.syncMedia({ force: true })
    expect([...media.pendingNow()]).toEqual([hex('e')])
  })

  // QA, v1.3.9: a 1 MB quota with 60 KB in it read "full (0 of 1 MB)" while Settings said 0.1.
  it('the full-quota toast gives the space used as the server and Settings do, one decimal in the language\'s own mark', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    apiUpload.mockRejectedValue(Object.assign(new Error('full'), { status: 413, code: 'media-quota', data: { usedMB: 0.1, quotaMB: 1 } }))
    await make(appStore({ S })).syncMedia()
    expect(toast).toHaveBeenCalledWith('Your photo and video space on the server is full (0.1 of 1 MB).')
    _setLangState('de', { 'Your photo and video space on the server is full ({0} of {1} MB).': 'Voll ({0} von {1} MB).' }, null, null)
    try {
      toast.mockClear()
      await make(appStore({ S })).syncMedia()
      expect(toast).toHaveBeenCalledWith('Voll (0,1 von 1 MB).')
    } finally { _setLangState('en', null, null, null) }
  })

  it('a network stop waits out its backoff, but the network coming back (a forced run) tries at once', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    apiUpload.mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'network' }))
    const sync = make(appStore({ S }))
    await sync.syncMedia()
    await sync.syncMedia()                               // within the backoff and the dedupe
    expect(apiUpload).toHaveBeenCalledTimes(1)
    await sync.syncMedia({ force: true })                // what 'online' does
    expect(apiUpload).toHaveBeenCalledTimes(2)
    expect([...media.pendingNow()]).toEqual([])
  })

  it('a finished run is not repeated for ten minutes unless something changes', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    const sync = make(appStore({ S }))
    await sync.syncMedia()
    await sync.syncMedia()
    expect(api).toHaveBeenCalledTimes(1)
    clock += 11 * 60000
    await sync.syncMedia()
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('files that come back after nothing referred to them (reset, then a backup import) go up at once', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    const store = appStore({ S })
    const sync = make(store)
    await sync.syncMedia()
    expect(api).toHaveBeenCalledTimes(1)
    store.setState({ S: { customEx: [] } })
    await sync.syncMedia()
    clock += 60000
    store.setState({ S })
    await put(hex('a'))
    await sync.syncMedia()
    expect(api).toHaveBeenCalledTimes(2)
    expect(apiUpload).toHaveBeenCalledTimes(2)
  })

  it('a 429 is honoured for as long as it says', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    apiUpload.mockRejectedValueOnce(Object.assign(new Error('locked'), { status: 429, code: 'locked', retryAfter: 120 }))
    const sync = make(appStore({ S }))
    await sync.syncMedia()
    clock += 60000
    await sync.syncMedia()
    expect(api).toHaveBeenCalledTimes(1)
    clock += 61000
    await sync.syncMedia()
    expect(apiUpload).toHaveBeenCalledTimes(2)
  })

  it('a file the server refuses for good stays here, is said once, and is not offered again', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    apiUpload.mockRejectedValue(Object.assign(new Error('HTTP 413'), { status: 413, code: 'proxy-too-large' }))
    const sync = make(appStore({ S }))
    await sync.syncMedia({ force: true })
    await sync.syncMedia({ force: true })
    expect(apiUpload).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
    expect((await media.get(hex('a')))).toMatchObject({ pending: true, rejected: true })
    // The Settings row asks for it again.
    apiUpload.mockResolvedValue({ ok: true })
    await sync.syncMedia({ force: true, retryRejected: true })
    expect((await media.get(hex('a')))).toMatchObject({ pending: false, rejected: false })
  })

  it('a file over this server\'s cap for its kind is refused here, never sent, and does not stop the files after it', async () => {
    // Picked on a phone under the default caps, then paired to a server that allows 1 MB photos.
    const S = { customEx: [{ id: 'a', media: refOf(hex('a'), null, { size: 3 * MB }) }, { id: 'b', media: refOf(hex('b')) }] }
    await put(hex('a'), 3 * MB); await put(hex('b'))
    const store = appStore({ S, config: { media: { imageMB: 1, gifMB: 8, videoMB: 40, videoSec: 60, quotaMB: 200 } } })
    const sync = make(store)
    await sync.syncMedia({ force: true })
    expect(apiUpload.mock.calls.map(c => c[0])).toEqual(['/api/media/' + hex('b')])
    expect(await media.get(hex('a'))).toMatchObject({ pending: true, rejected: true })
    expect(toast).toHaveBeenCalledWith('The server refused the file as too large.')
    expect(getMediaStatus().rejected).toBe(1)
    // A video under the video cap is not held to the photo's.
    const V = { customEx: [{ id: 'v', media: refOf(hex('c'), null, { kind: 'video', mime: 'video/mp4', size: 3 * MB }) }] }
    await put(hex('c'), 3 * MB, 'video/mp4')
    store.setState({ S: V })
    await sync.syncMedia({ force: true })
    expect(apiUpload.mock.calls.at(-1)[0]).toBe('/api/media/' + hex('c'))
  })

  it('a big file waits for a connection that is not metered, unless the run is forced', async () => {
    const S = { customEx: [{ id: 'v', media: refOf(hex('a'), null, { kind: 'video', mime: 'video/mp4', size: 6 * MB }) }] }
    await put(hex('a'), 6 * MB, 'video/mp4')
    allowed = false
    const sync = make(appStore({ S }))
    await sync.syncMedia()
    expect(apiUpload).not.toHaveBeenCalled()
    expect(getMediaStatus().deferred).toBe(1)
    await sync.syncMedia({ force: true })
    expect(apiUpload).toHaveBeenCalledTimes(1)
  })

  it('runs one at a time and folds what is asked meanwhile into one more run', async () => {
    const S = { customEx: [{ id: 'a', media: refOf(hex('a')) }] }
    await put(hex('a'))
    let release
    apiUpload.mockImplementationOnce(() => new Promise(r => { release = r }))
    const sync = make(appStore({ S }))
    const first = sync.syncMedia()
    await new Promise(r => setTimeout(r, 5))
    sync.syncMedia({ force: true }); sync.syncMedia({ force: true })
    release({ ok: true })
    await first
    await new Promise(r => setTimeout(r, 10))
    expect(api).toHaveBeenCalledTimes(2)
  })
})

describe('fetchToStore', () => {
  const blobOf = b => new Blob([b])
  it('keeps a download whose hash and type match, as synced', async () => {
    const file = jpeg()
    const h = await sha256Hex(file)
    apiBlob.mockResolvedValue(blobOf(file))
    const sync = make(appStore({}))
    await sync.fetchToStore(h, { mime: 'image/jpeg', size: file.length })
    expect(apiBlob.mock.calls[0]).toEqual(['/api/media/' + h, { expectSize: file.length }])
    expect(await media.get(h)).toMatchObject({ mime: 'image/jpeg', pending: false })
  })

  it('refuses bytes that do not hash to the name, a login page, and the wrong type', async () => {
    const file = jpeg()
    const h = await sha256Hex(file)
    const sync = make(appStore({}))
    apiBlob.mockResolvedValueOnce(blobOf(png()))
    await expect(sync.fetchToStore(h, { mime: 'image/jpeg' })).rejects.toMatchObject({ code: 'integrity' })
    const page = new TextEncoder().encode('<!doctype html><title>Sign in</title>')
    apiBlob.mockResolvedValueOnce(blobOf(page))
    await expect(sync.fetchToStore(await sha256Hex(page), {})).rejects.toMatchObject({ code: 'integrity' })
    apiBlob.mockResolvedValueOnce(blobOf(file))
    await expect(sync.fetchToStore(h, { mime: 'image/png' })).rejects.toMatchObject({ code: 'integrity' })
    expect(await media.list()).toEqual([])
  })

  it('a 404 backs off per file — 30 s, then 2 min — and a /missing answer that has it lifts that', async () => {
    const h = hex('a')
    apiBlob.mockRejectedValue(Object.assign(new Error('no'), { status: 404, code: 'media-missing' }))
    const sync = make(appStore({ S: { customEx: [{ id: 'a', media: refOf(h) }] } }))
    await expect(sync.fetchToStore(h, {})).rejects.toMatchObject({ code: 'missing' })
    expect(sync.mayFetch(h)).toBe(false)
    await expect(sync.fetchToStore(h, {})).rejects.toMatchObject({ code: 'missing' })
    expect(apiBlob).toHaveBeenCalledTimes(1)
    clock += 31000
    await expect(sync.fetchToStore(h, {})).rejects.toMatchObject({ code: 'missing' })
    expect(apiBlob).toHaveBeenCalledTimes(2)
    clock += 31000
    expect(sync.mayFetch(h)).toBe(false)                 // now two minutes
    // A tap asks past it.
    await expect(sync.fetchToStore(h, {}, { force: true })).rejects.toMatchObject({ code: 'missing' })
    expect(apiBlob).toHaveBeenCalledTimes(3)
    // Another device uploaded it: the server's answer to /missing says so.
    api.mockResolvedValueOnce({ missing: [], usage: null })
    await sync.syncMedia({ force: true })
    expect(sync.mayFetch(h)).toBe(true)
  })

  it('no network is offline, not missing', async () => {
    apiBlob.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(make(appStore({})).fetchToStore(hex('a'), {})).rejects.toMatchObject({ code: 'offline' })
  })
})

describe('localMediaGc', () => {
  it('keeps what the state, the saved copy, a stash or the last hour refer to, and nothing else', async () => {
    for (const c of 'abcdef') await put(hex(c))
    clock += 2 * 3600000
    await put(hex('9'))                                              // picked a moment ago
    const S = { customEx: [{ id: 'x', media: refOf(hex('a'), hex('b')) }] }
    storage.setItem('gym_state_v1', JSON.stringify({ customEx: [{ id: 'y', media: refOf(hex('c')) }] }))   // another tab's copy
    const store = appStore({ S, user: null, stashedMediaHashes: async () => new Set([hex('d')]) })
    await make(store).localMediaGc()
    expect((await media.list()).map(r => r.hash).sort()).toEqual([hex('a'), hex('b'), hex('c'), hex('d'), hex('9')].sort())
  })

  it('keeps the draft of an editor left open past the hour, and lets it go once the editor closes', async () => {
    await put(hex('a')); await put(hex('b'))
    const release = media.hold([hex('a'), hex('b')])
    const release2 = media.hold([hex('a')])   // the same draft in a second form
    clock += 2 * 3600000
    const sync = make(appStore({ S: { customEx: [] }, user: null }))
    await sync.localMediaGc()
    expect(await media.has(hex('a'))).toBe(true)
    expect(await media.has(hex('b'))).toBe(true)
    release(); release()   // a second call changes nothing
    await sync.localMediaGc()
    expect(await media.has(hex('a'))).toBe(true)   // still held by the second form
    expect(await media.has(hex('b'))).toBe(false)
    release2()
    await sync.localMediaGc()
    expect(await media.has(hex('a'))).toBe(false)
  })

  it('deletes nothing when the stash cannot be read', async () => {
    await put(hex('a'))
    clock += 2 * 3600000
    await make(appStore({ S: { customEx: [] }, stashedMediaHashes: async () => { throw new Error('io') } })).localMediaGc()
    expect(await media.has(hex('a'))).toBe(true)
  })

  it('signed in, evicts synced main files over the cap — never a pending one or a poster the state shows', async () => {
    const S = { customEx: [
      { id: 'x', media: refOf(hex('a'), hex('b'), { size: 200 * MB }) },
      { id: 'y', media: refOf(hex('c'), hex('d'), { size: 150 * MB }) }
    ] }
    await media.put(hex('a'), new Blob([new Uint8Array(200 * MB)]), { mime: 'image/webp', pending: false })
    await media.put(hex('b'), new Blob([new Uint8Array(1 * MB)]), { mime: 'image/webp', pending: false })
    await media.put(hex('c'), new Blob([new Uint8Array(150 * MB)]), { mime: 'image/webp', pending: true })
    await media.put(hex('d'), new Blob([new Uint8Array(1 * MB)]), { mime: 'image/webp', pending: false })
    clock += 2 * 3600000
    await make(appStore({ S })).localMediaGc()
    expect((await media.list()).map(r => r.hash).sort()).toEqual([hex('b'), hex('c'), hex('d')])
  })

  it('waits for boot: before `ready` nothing is removed, and the clean-up runs once it flips', async () => {
    // A phone whose WebView storage was evicted: memory and localStorage are empty, the only
    // reference to the file is in the state file boot has not restored yet.
    const S = { customEx: [{ id: 'x', media: refOf(hex('a')) }] }
    await put(hex('a')); await put(hex('b'))
    clock += 2 * 3600000
    const store = appStore({ S: { customEx: [] }, user: null, ready: false })
    const sync = make(store)
    expect(await sync.localMediaGc()).toBe(false)
    expect(await media.has(hex('a'))).toBe(true)
    expect(await media.has(hex('b'))).toBe(true)
    store.setState({ S, ready: true })
    expect(await sync.localMediaGc()).toBe(true)
    expect(await media.has(hex('a'))).toBe(true)
    expect(await media.has(hex('b'))).toBe(false)
  })

  it('start() leaves the store alone while boot runs, and cleans up after it has finished', async () => {
    vi.useFakeTimers()
    const idle = globalThis.requestIdleCallback
    globalThis.requestIdleCallback = cb => setTimeout(cb, 1)   // the WebView's idle comes at once
    try {
      const S = { customEx: [{ id: 'x', media: refOf(hex('a')) }] }
      await put(hex('a')); await put(hex('b'))
      clock += 2 * 3600000
      const store = appStore({ S: { customEx: [] }, user: null, ready: false })
      const stop = make(store).start(store)
      await vi.advanceTimersByTimeAsync(60000)
      expect(await media.has(hex('a'))).toBe(true)
      expect(await media.has(hex('b'))).toBe(true)
      store.setState({ S, ready: true })   // boot restored the mirror and finished
      await vi.advanceTimersByTimeAsync(15000)
      expect(await media.has(hex('a'))).toBe(true)
      expect(await media.has(hex('b'))).toBe(false)
      stop()
    } finally {
      globalThis.requestIdleCallback = idle
      vi.useRealTimers()
    }
  })

  it('on a phone, keeps what the state file refers to, and deletes nothing when it cannot be read', async () => {
    await put(hex('a')); await put(hex('b'))
    clock += 2 * 3600000
    const store = appStore({ S: { customEx: [] }, user: null })
    await make(store, { nativeLoad: async () => ({ customEx: [{ id: 'x', media: refOf(hex('a')) }] }) }).localMediaGc()
    expect(await media.has(hex('a'))).toBe(true)
    expect(await media.has(hex('b'))).toBe(false)
    await put(hex('c')); clock += 2 * 3600000
    await make(store, { nativeLoad: async () => { throw new Error('io') } }).localMediaGc()
    expect(await media.has(hex('c'))).toBe(true)
  })

  it('a guest never loses a referenced file to the cap', async () => {
    const S = { customEx: [{ id: 'x', media: refOf(hex('a'), null, { size: 400 * MB }) }] }
    await media.put(hex('a'), new Blob([new Uint8Array(400 * MB)]), { mime: 'image/webp', pending: false })
    clock += 2 * 3600000
    await make(appStore({ S, user: null })).localMediaGc()
    expect(await media.has(hex('a'))).toBe(true)
  })
})

// lib/media-prefetch.js fetches the shipped catalogue's animations ahead only in the app installed
// on the home screen (#281). That gate is the catalogue's alone: a custom exercise's own file has
// no copy anywhere but this device and its server, so a browser tab still sends it, and still
// makes the plan's files local, on any connection that is not metered.
describe('in a browser tab, not the installed app', () => {
  const tab = () => vi.stubGlobal('matchMedia', q => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {} }))
  const plain = store => createMediaSync({ store, media, api, apiUpload, apiBlob, toast, now: () => clock, locks: null, storage })
  afterEach(() => vi.unstubAllGlobals())

  it('a big file goes up without being forced', async () => {
    tab()
    expect(installedApp()).toBe(false)
    expect(prefetchAllowed()).toBe(true)
    const S = { customEx: [{ id: 'v', media: refOf(hex('a'), null, { kind: 'video', mime: 'video/mp4', size: 6 * MB }) }] }
    await put(hex('a'), 6 * MB, 'video/mp4')
    await plain(appStore({ S })).syncMedia()
    expect(apiUpload).toHaveBeenCalledTimes(1)
    expect(getMediaStatus().deferred || 0).toBe(0)
  })

  it('the plan\'s own photos are made local ahead', async () => {
    tab()
    const file = jpeg()
    const h = await sha256Hex(file)
    apiBlob.mockResolvedValue(new Blob([file]))
    const S = {
      routines: [{ id: 'r', ex: [{ id: 'c1' }] }],
      customEx: [{ id: 'c1', custom: true, media: { kind: 'image', hash: h, mime: 'image/jpeg', size: file.length, width: 640, height: 480, at: 1 } }]
    }
    const stop = plain(appStore({ S })).startCustomMediaPrefetch({ delay: 0 })
    try {
      for (let i = 0; i < 50 && !(await media.has(h)); i++) await new Promise(r => setTimeout(r, 10))
      expect(apiBlob).toHaveBeenCalledWith('/api/media/' + h, { expectSize: file.length })
      expect(await media.get(h)).toMatchObject({ mime: 'image/jpeg', pending: false })
    } finally { stop() }
  })
})

// A logged workout's photos and videos (workouts[].media) go through the very same sync: the
// server is asked about them and sent what it lacks, the local clean-up keeps them, and the most
// recent workouts' posters are made local ahead so the history shows them offline.
describe('a workout\'s photos and videos', () => {
  const workoutWith = (...refs) => ({ id: 'w1', d: '2026-09-20', start: 1, end: 2, entries: [], media: refs })

  it('are uploaded when the server lacks them, posters first', async () => {
    await put(hex('a')); await put(hex('b'))
    const S = { customEx: [], workouts: [workoutWith(refOf(hex('a'), hex('b')))] }
    await make(appStore({ S })).syncMedia()
    expect(JSON.parse(api.mock.calls[0][1].body).hashes).toEqual([hex('b'), hex('a')])
    expect(apiUpload.mock.calls.map(c => c[0])).toEqual(['/api/media/' + hex('b'), '/api/media/' + hex('a')])
    expect(media.pendingNow().size).toBe(0)
  })

  it('the local clean-up keeps a file only a workout refers to', async () => {
    await put(hex('a')); await put(hex('c'))
    clock += 2 * 3600000
    await make(appStore({ S: { customEx: [], workouts: [workoutWith(refOf(hex('a')))] }, user: null })).localMediaGc()
    expect((await media.list()).map(r => r.hash)).toEqual([hex('a')])
  })

  it('the posters of recent workouts are made local ahead; their main files wait to be opened', async () => {
    const poster = jpeg()
    const ph = await sha256Hex(poster)
    apiBlob.mockResolvedValue(new Blob([poster]))
    const ref = refOf(hex('a'), null, { kind: 'video', mime: 'video/mp4', size: 5 * MB, width: 1280, height: 720 })
    ref.poster = { hash: ph, mime: 'image/jpeg', size: poster.length, width: 640, height: 480 }
    const S = { customEx: [], routines: [], workouts: [workoutWith(ref)] }
    const stop = make(appStore({ S })).startCustomMediaPrefetch({ delay: 0 })
    try {
      for (let i = 0; i < 50 && !(await media.has(ph)); i++) await new Promise(r => setTimeout(r, 10))
      expect(await media.get(ph)).toMatchObject({ mime: 'image/jpeg', pending: false })
      expect(apiBlob.mock.calls.map(c => c[0])).toEqual(['/api/media/' + ph])
    } finally { stop() }
  })
})
