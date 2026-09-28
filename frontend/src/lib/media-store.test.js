import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMediaStore, memoryBackend, playType } from './media-store.js'

const H1 = '1'.repeat(64)
const H2 = '2'.repeat(64)
const H3 = '3'.repeat(64)

function objectURLs() {
  let n = 0
  const live = new Set()
  const made = []
  return {
    live, made,
    createObjectURL: blob => { const u = 'blob:test/' + (++n); live.add(u); made.push({ u, type: blob.type }); return u },
    revokeObjectURL: u => { live.delete(u) }
  }
}

describe('media store (memory backend)', () => {
  let clock, urls, store
  beforeEach(() => {
    vi.useFakeTimers()
    clock = 1_000_000
    urls = objectURLs()
    store = createMediaStore(memoryBackend(), { now: () => clock, objectURL: urls, canPlayType: () => '' })
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a file as pending, and a second put of the same hash only updates the record', async () => {
    await store.put(H1, new Blob(['abc']), { mime: 'image/webp' })
    expect(await store.list()).toEqual([{ hash: H1, mime: 'image/webp', size: 3, putAt: clock, shownAt: 0, pending: true, rejected: false }])
    clock += 5
    await store.put(H1, new Blob(['abc']), { mime: 'image/webp', pending: false })
    expect((await store.get(H1)).pending).toBe(false)
    expect((await store.list())[0].putAt).toBe(clock)
    expect(await store.usage()).toEqual({ bytes: 3, count: 1 })
  })

  it('refuses a type outside the allowlist', async () => {
    await expect(store.put(H1, new Blob(['<html>']), { mime: 'text/html' })).rejects.toThrow()
    await expect(store.put(H1, new Blob(['<svg/>']), { mime: 'image/svg+xml' })).rejects.toThrow()
  })

  it('hands out one object URL per file, typed as stored, and revokes it 30 s after the last release', async () => {
    await store.put(H1, new Blob(['abc'], { type: 'text/html' }), { mime: 'image/gif' })
    const a = await store.url(H1)
    const b = await store.url(H1)
    expect(a).toBe(b)
    expect(urls.made).toEqual([{ u: a, type: 'image/gif' }])
    store.release(H1)
    vi.advanceTimersByTime(60000)
    expect(urls.live.has(a)).toBe(true)          // one holder left
    store.release(H1)
    vi.advanceTimersByTime(29000)
    expect(urls.live.has(a)).toBe(true)
    const again = await store.url(H1)             // taken again within the 30 s: kept
    expect(again).toBe(a)
    store.release(H1)
    vi.advanceTimersByTime(30001)
    expect(urls.live.has(a)).toBe(false)
    expect(await store.url(H2)).toBeNull()
  })

  it('two callers asking at once get one URL', async () => {
    await store.put(H1, new Blob(['abc']), { mime: 'image/webp' })
    const [a, b] = await Promise.all([store.url(H1), store.url(H1)])
    expect(a).toBe(b)
    expect(urls.made).toHaveLength(1)
    store.release(H1); store.release(H1)
    vi.advanceTimersByTime(30001)
    expect(urls.live.size).toBe(0)
  })

  it('types a MOV as video/mp4 where the browser would not play it as what it is', async () => {
    await store.put(H1, new Blob(['mov']), { mime: 'video/quicktime' })
    await store.url(H1)
    expect(urls.made[0].type).toBe('video/mp4')
    expect(playType('video/quicktime', () => 'maybe')).toBe('video/quicktime')
    expect(playType('video/webm', () => '')).toBe('video/webm')
  })

  it('writes when a file was shown at most once an hour', async () => {
    await store.put(H1, new Blob(['abc']), { mime: 'image/webp' })
    await store.url(H1); store.release(H1)
    const first = (await store.list())[0].shownAt
    expect(first).toBe(clock)
    vi.advanceTimersByTime(30001)                 // revoked, so the next url() makes a new one
    clock += 10 * 60000
    await store.url(H1); store.release(H1)
    expect((await store.list())[0].shownAt).toBe(first)
    vi.advanceTimersByTime(30001)
    clock += 60 * 60000
    await store.url(H1); store.release(H1)
    expect((await store.list())[0].shownAt).toBe(clock)
  })

  it('retainOnly keeps the set, and whatever was put at or after the given moment', async () => {
    await store.put(H1, new Blob(['1']), { mime: 'image/webp' })
    await store.put(H2, new Blob(['2']), { mime: 'image/webp' })
    const since = clock
    clock += 1
    await store.put(H3, new Blob(['3']), { mime: 'image/webp' })
    const removed = await store.retainOnly(new Set([H1]), { keepPutAfter: since + 1 })
    expect(removed).toBe(1)
    expect((await store.list()).map(r => r.hash).sort()).toEqual([H1, H3])
  })

  it('marks synced and rejected, and lists what is pending', async () => {
    await store.put(H1, new Blob(['1']), { mime: 'image/webp' })
    await store.put(H2, new Blob(['2']), { mime: 'image/webp' })
    expect([...await store.pendingHashes()].sort()).toEqual([H1, H2])
    await store.markSynced(H1)
    await store.markRejected(H2)
    expect([...store.pendingNow()]).toEqual([H2])
    expect([...store.rejectedNow()]).toEqual([H2])
    expect((await store.get(H2)).rejected).toBe(true)
    // A rejected file put again (the user picked it anew) is still refused until the server
    // says otherwise; one the server sends is simply synced.
    await store.put(H2, new Blob(['2']), { mime: 'image/webp', pending: false })
    expect((await store.get(H2))).toMatchObject({ pending: false, rejected: false })
  })

  it('tells its listeners about every change, and clearAll empties it', async () => {
    const seen = vi.fn()
    store.subscribe(seen)
    await store.put(H1, new Blob(['1']), { mime: 'image/webp' })
    await store.remove(H1)
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2)
    await store.put(H2, new Blob(['2']), { mime: 'image/webp' })
    await store.clearAll()
    expect(await store.list()).toEqual([])
  })

  it('falls back to memory, and says so, when its backend cannot open', async () => {
    const broken = { name: 'idb', persistent: true, open: async () => false }
    const s = createMediaStore(broken, { objectURL: urls })
    await s.ready()
    expect(s.persistent).toBe(false)
    expect(s.backendName).toBe('memory')
    await s.put(H1, new Blob(['x']), { mime: 'image/png' })
    expect(await s.has(H1)).toBe(true)
  })
})
