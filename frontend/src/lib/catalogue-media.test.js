import { describe, it, expect, vi } from 'vitest'
import { createCatalogueMedia, startCatalogueMedia } from './catalogue-media.js'

const mk = (id, kind, hash, mode = 'slim') => ({ assetId: `${id}:${kind}:180x180:webp`, drawingId: id, kind, format: 'webp',
  width: 180, height: 180, bytes: 100, sha256: hash.repeat(64), remotePath: `objects/${hash.repeat(64)}.webp`,
  bundledPath: kind === 'still' || mode === 'full' ? `exercise-media/${kind}/${id}.webp` : null })
const clip = mk('0001', 'clip', 'a'), still = mk('0001', 'still', 'b')
function fixture(mode = 'slim') {
  const manifest = { schemaVersion: 1, mode, baseUrl: 'https://media.example/', mediaRevision: 'd'.repeat(64),
    catalogueRevision: 'e'.repeat(64), assets: [mk('0001', 'clip', 'a', mode), mk('0001', 'still', 'b', mode)] }
  let retained = false, gen = 0
  const release = vi.fn()
  const store = { init: async () => {}, readJobs: async () => [], saveJobs: async () => {},
    has: async () => retained, acquire: async () => retained ? { url: 'file:///local.webp', release } : null,
    retain: async () => retained,
    generation: () => gen, staging: id => 'staging/' + id, discard: async () => {},
    commit: async () => { retained = true; return true }, freeBytes: async () => null,
    remove: async () => { retained = false; gen++; return { removedBytes: 100, deferredCount: 0 } },
    removeAll: async () => { retained = false; gen++; return { removedBytes: 100, deferredCount: 0 } },
    removeObsolete: async () => ({ removedBytes: 0, deferredCount: 0 }),
    verify: async () => { retained = false; return false },
    snapshot: () => ({ resources: retained ? { [clip.assetId]: { status: 'downloaded', bytes: 100 } } : {}, downloadedBytes: retained ? 100 : 0 }) }
  const transport = { download: vi.fn(async ({url, expectedBytes}) => ({ finalUrl: url, bytesWritten: expectedBytes })) }
  let n = 0
  const service = createCatalogueMedia({ manifest, store, transport, makeId: () => 'id' + ++n })
  return { service, store, transport, release }
}

describe('catalogue media service', () => {
  it('cancels pending work on sign-out/account switch, including a change during startup', async () => {
    let state = { user: { id: 'one' } }, notify
    const unsubscribe = vi.fn()
    const profile = { getState: () => state, subscribe: fn => { notify = fn; return unsubscribe } }
    let ready
    const startup = new Promise(resolve => { ready = resolve })
    const service = { cancelPending: vi.fn(async () => {}) }
    const stop = startCatalogueMedia(profile, () => startup)
    state = { user: null }; notify(state)
    ready(service); await startup; await Promise.resolve()
    expect(service.cancelPending).toHaveBeenCalledOnce()
    notify({ user: { id: 'two' } })
    expect(service.cancelPending).toHaveBeenCalledOnce()
    notify({ user: { id: 'three' } })
    expect(service.cancelPending).toHaveBeenCalledTimes(2)
    stop(); expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('resolves bundled first, downloaded second, otherwise reports missing without fetching', async () => {
    const f = fixture(); await f.service.init()
    expect((await f.service.resolve(still.assetId)).status).toBe('bundled')
    expect((await f.service.resolve(clip.assetId)).status).toBe('missing')
    expect((await f.service.resolve('unknown')).status).toBe('unavailable')
    expect(f.transport.download).not.toHaveBeenCalled()
    await f.service.enqueue([clip.assetId]); await f.service.idle()
    const resolved = await f.service.resolve(clip.assetId)
    expect(resolved.status).toBe('downloaded')
    resolved.release(); expect(f.release).toHaveBeenCalledOnce()
  })

  it('estimates missing physical bytes with two-file headroom and honest unknown free space', async () => {
    const f = fixture(); await f.service.init()
    expect(await f.service.estimate([clip.assetId, clip.assetId, still.assetId])).toEqual({
      missingCount: 1, downloadBytes: 100, peakAdditionalBytes: 200 + 16 * 1024 * 1024, freeBytes: null })
    f.store.freeBytes = async () => 10
    await expect(f.service.enqueue([clip.assetId])).rejects.toMatchObject({ code: 'no-space' })
    expect(f.transport.download).not.toHaveBeenCalled()
  })

  it('keeps a stable subscription snapshot until changes and updates after cleanup and corruption', async () => {
    const f = fixture(); await f.service.init()
    expect(f.service.snapshot()).toBe(f.service.snapshot())
    const notify = vi.fn(); const unsub = f.service.subscribe(notify)
    await f.service.enqueue([clip.assetId]); await f.service.idle()
    expect(f.service.snapshot().resources[clip.assetId].status).toBe('downloaded')
    expect(await f.service.revalidate(clip.assetId)).toBe(false)
    expect(f.service.snapshot().resources[clip.assetId].status).toBe('missing')
    await f.service.removeAll()
    expect(f.service.snapshot().downloadedBytes).toBe(0)
    expect(notify).toHaveBeenCalled(); unsub()
  })

  it('full build uses matching bundled media without any transfer', async () => {
    const f = fixture('full'); await f.service.init()
    expect((await f.service.resolve(clip.assetId)).status).toBe('bundled')
    await f.service.enqueue([clip.assetId]); await f.service.idle()
    expect(f.service.snapshot().bundledBytes).toBe(200)
    expect(f.transport.download).not.toHaveBeenCalled()
  })
})
