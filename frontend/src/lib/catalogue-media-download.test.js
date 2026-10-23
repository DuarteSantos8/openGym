import { describe, it, expect, vi } from 'vitest'
import { createCatalogueMediaDownloads } from './catalogue-media-download.js'

const asset = (n, hash = String(n).repeat(64)) => ({ assetId: `000${n}:clip:180x180:mp4`, drawingId: `000${n}`,
  sha256: hash, kind: 'clip', format: 'mp4', width: 180, height: 180, bytes: 100,
  remotePath: `objects/${hash}.mp4`, bundledPath: null })
const A = asset(1), B = asset(2), C = asset(3), SAME = asset(4, A.sha256)
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture({ list = [A, B, C, SAME], download, saved = [], online = () => true, sleep = async () => {} } = {}) {
  let jobs = saved, counter = 0
  const kept = new Set(), generation = new Map()
  const store = {
    readJobs: async () => jobs, saveJobs: async j => { jobs = structuredClone(j) },
    has: async a => kept.has(a.sha256), generation: a => generation.get(a.sha256) || 0,
    retain: vi.fn(async (a, g) => kept.has(a.sha256) && (generation.get(a.sha256) || 0) === g),
    staging: id => `staging/${id}.part`, discard: vi.fn(async () => {}),
    commit: vi.fn(async (a, p, g) => { if ((generation.get(a.sha256) || 0) !== g) return false; kept.add(a.sha256); return true })
  }
  const transport = { download: vi.fn(download || (async ({url, expectedBytes}) => ({ finalUrl: url, bytesWritten: expectedBytes }))) }
  const manifest = { mediaRevision: 'r1', assets: list }
  const queue = createCatalogueMediaDownloads({ manifest, store, transport, online, sleep,
    makeId: () => `job-${++counter}`, assetUrl: a => `https://media.example/${a.remotePath}` })
  return { queue, store, transport, kept, generation, jobs: () => jobs }
}

describe('catalogue animation download batches', () => {
  it('uses two lanes, never marks pending bytes ready, then completes the snapshot', async () => {
    const gate = deferred()
    let active = 0, max = 0
    const f = fixture({ download: async ({url, expectedBytes}) => {
      active++; max = Math.max(max, active); await gate.promise; active--
      return { finalUrl: url, bytesWritten: expectedBytes }
    } })
    await f.queue.init()
    await f.queue.enqueue([A.assetId, B.assetId, C.assetId])
    await tick()
    expect(f.transport.download).toHaveBeenCalledTimes(2)
    expect(f.queue.snapshot().batches[0].completed).toEqual([])
    gate.resolve(); await f.queue.idle()
    expect(max).toBe(2)
    expect(f.queue.snapshot().batches[0].status).toBe('ready')
    expect(f.store.commit).toHaveBeenCalledTimes(3)
  })

  it('deduplicates hashes across batches and cancelling one owner preserves the other', async () => {
    const gate = deferred()
    const f = fixture({ download: async ({url, expectedBytes}) => { await gate.promise; return { finalUrl: url, bytesWritten: expectedBytes } } })
    await f.queue.init()
    const first = await f.queue.enqueue([A.assetId])
    await f.queue.enqueue([SAME.assetId])
    await tick(); await f.queue.cancel(first.batchId)
    gate.resolve(); await f.queue.idle()
    expect(f.transport.download).toHaveBeenCalledTimes(1)
    expect(f.store.retain).toHaveBeenCalledWith(SAME, 0)
    expect(f.queue.snapshot().batches.map(b => b.status)).toEqual(['cancelled', 'ready'])
  })

  it('does not commit when all owners cancel or cleanup advances the generation', async () => {
    const gate = deferred()
    const f = fixture({ download: async ({url, expectedBytes}) => { await gate.promise; return { finalUrl: url, bytesWritten: expectedBytes } } })
    await f.queue.init()
    const b = await f.queue.enqueue([A.assetId]); await tick()
    await f.queue.cancel(b.batchId)
    gate.resolve(); await f.queue.idle()
    expect(f.store.commit).not.toHaveBeenCalled()
    const second = deferred()
    f.transport.download.mockImplementation(async ({url, expectedBytes}) => { await second.promise; return { finalUrl: url, bytesWritten: expectedBytes } })
    await f.queue.enqueue([A.assetId]); await tick()
    f.generation.set(A.sha256, 1)
    await f.queue.exclude([A.assetId])
    second.resolve(); await f.queue.idle()
    expect(f.kept.size).toBe(0)
  })

  it('pauses after the current files and requires Continue after foreground returns', async () => {
    const gate = deferred()
    const f = fixture({ download: async ({url, expectedBytes}) => { await gate.promise; return { finalUrl: url, bytesWritten: expectedBytes } } })
    await f.queue.init()
    const b = await f.queue.enqueue([A.assetId, B.assetId, C.assetId]); await tick()
    f.queue.setForeground(false)
    expect(f.queue.snapshot().batches[0].status).toBe('pausing')
    gate.resolve(); await f.queue.idle()
    expect(f.transport.download).toHaveBeenCalledTimes(2)
    expect(f.queue.snapshot().batches[0].status).toBe('paused')
    f.queue.setForeground(true); await tick()
    expect(f.transport.download).toHaveBeenCalledTimes(2)
    await f.queue.resume(b.batchId); await f.queue.idle()
    expect(f.queue.snapshot().batches[0].status).toBe('ready')
  })

  it('retries network/408/429/5xx at most twice and respects Retry-After', async () => {
    const waits = []
    const f = fixture({ download: async () => { throw { code: 'http', status: 429, retryAfterMs: 10000 } }, sleep: async ms => { waits.push(ms) } })
    await f.queue.init(); await f.queue.enqueue([A.assetId]); await f.queue.idle()
    expect(waits).toEqual([10000, 10000])
    expect(f.transport.download).toHaveBeenCalledTimes(3)
    expect(f.queue.snapshot().batches[0].failed[A.assetId].status).toBe(429)
    expect(f.jobs()[0].retries[A.assetId]).toBe(2)
  })

  it.each([401, 403, 404])('never automatically retries HTTP %i', async status => {
    const f = fixture({ download: async () => { throw { code: 'http', status } } })
    await f.queue.init(); await f.queue.enqueue([A.assetId]); await f.queue.idle()
    expect(f.transport.download).toHaveBeenCalledTimes(1)
  })

  it.each(['hash', 'size', 'type'])('does not retry integrity failure %s', async code => {
    const f = fixture(); f.store.commit.mockRejectedValue({ code })
    await f.queue.init(); await f.queue.enqueue([A.assetId]); await f.queue.idle()
    expect(f.transport.download).toHaveBeenCalledTimes(1)
    expect(f.kept.size).toBe(0)
  })

  it('pauses offline without spending retries or starting the remaining resources', async () => {
    const f = fixture({ online: () => false })
    await f.queue.init(); await f.queue.enqueue([A.assetId, B.assetId]); await f.queue.idle()
    expect(f.transport.download).not.toHaveBeenCalled()
    expect(f.queue.snapshot().batches[0].status).toBe('paused')
  })

  it.each(['no-space', 'io'])('pauses the batch on %s and preserves actionable errors', async code => {
    const f = fixture({ download: async () => { throw { code } } })
    await f.queue.init(); await f.queue.enqueue([A.assetId, B.assetId, C.assetId]); await f.queue.idle()
    expect(f.queue.snapshot().batches[0].status).toBe('paused')
    expect(f.queue.snapshot().batches[0].error.code).toBe(code)
    expect(f.transport.download.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('cancels unfinished session batches while retaining already completed files', async () => {
    const f = fixture(); await f.queue.init()
    await f.queue.enqueue([A.assetId]); await f.queue.idle()
    const gate = deferred()
    f.transport.download.mockImplementation(async ({url, expectedBytes}) => { await gate.promise; return { finalUrl: url, bytesWritten: expectedBytes } })
    await f.queue.enqueue([B.assetId, C.assetId]); await tick()
    await f.queue.cancelPending(); gate.resolve(); await f.queue.idle()
    expect(f.queue.snapshot().batches.map(b => b.status)).toEqual(['ready', 'cancelled'])
    expect(f.kept).toEqual(new Set([A.sha256]))
  })

  it('rejects a reported redirect or incomplete body before commit', async () => {
    const f = fixture({ download: async () => ({ finalUrl: 'https://other.example/file', bytesWritten: 100 }) })
    await f.queue.init(); await f.queue.enqueue([A.assetId]); await f.queue.idle()
    expect(f.store.commit).not.toHaveBeenCalled()
    expect(f.queue.snapshot().batches[0].failed[A.assetId].code).toBe('redirect')
  })

  it('restores interrupted batches paused, retaining valid objects and requiring migration confirmation', async () => {
    const f = fixture({ saved: [{ id: 'old', assetIds: [A.assetId, '0002:clip:240x240:webp', '9999:clip:180x180:mp4'],
      completed: [], failed: {}, mediaRevision: 'old', status: 'downloading' }] })
    f.kept.add(A.sha256)
    await f.queue.init()
    const b = f.queue.snapshot().batches[0]
    expect(b.assetIds).toEqual([A.assetId, B.assetId])
    expect(b.completed).toEqual([A.assetId])
    expect(b.status).toBe('paused')
    expect(b.requiresConfirmation).toBe(true)
    expect(b.unavailable).toHaveLength(1)
    expect(f.transport.download).not.toHaveBeenCalled()
  })

  it('does not restore explicit retention for a previously cancelled shared request', async () => {
    const f = fixture({ saved: [{ id: 'cancelled', assetIds: [SAME.assetId], completed: [], failed: {},
      mediaRevision: 'r1', status: 'cancelled' }] })
    f.kept.add(A.sha256)
    await f.queue.init()
    expect(f.store.retain).not.toHaveBeenCalled()
    expect(f.queue.snapshot().batches[0].status).toBe('cancelled')
  })

  it('retries only failed resources, never redownloads successful ones', async () => {
    const f = fixture({ download: async ({url, expectedBytes}) => {
      if (url.includes(B.sha256)) throw { code: 'http', status: 404 }
      return { finalUrl: url, bytesWritten: expectedBytes }
    } })
    await f.queue.init(); const b = await f.queue.enqueue([A.assetId, B.assetId]); await f.queue.idle()
    f.transport.download.mockImplementation(async ({url, expectedBytes}) => ({ finalUrl: url, bytesWritten: expectedBytes }))
    await f.queue.retry(b.batchId); await f.queue.idle()
    expect(f.transport.download).toHaveBeenCalledTimes(3)
    expect(f.queue.snapshot().batches[0].status).toBe('ready')
  })

  it('retry failures does not start untouched resources from a space-paused batch', async () => {
    const f = fixture({ download: async () => { throw { code: 'no-space' } } })
    await f.queue.init(); const b = await f.queue.enqueue([A.assetId, B.assetId, C.assetId]); await f.queue.idle()
    const failedIds = Object.keys(f.queue.snapshot().batches[0].failed)
    expect(failedIds).toHaveLength(2)
    f.transport.download.mockImplementation(async ({url, expectedBytes}) => ({ finalUrl: url, bytesWritten: expectedBytes }))
    await f.queue.retry(b.batchId); await f.queue.idle()
    expect(f.transport.download).toHaveBeenCalledTimes(4)
    expect(f.queue.snapshot().batches[0].completed.sort()).toEqual(failedIds.sort())
    expect(f.queue.snapshot().batches[0].status).toBe('paused')
    await f.queue.resume(b.batchId); await f.queue.idle()
    expect(f.queue.snapshot().batches[0].status).toBe('ready')
    expect(f.transport.download).toHaveBeenCalledTimes(5)
  })
})
