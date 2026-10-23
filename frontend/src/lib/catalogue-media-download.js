// Device-local batches. Sharing a hash shares one transfer, not the lifetime of its callers.
const RETRIES = [2000, 8000]
const RUNNING = new Set(['queued', 'downloading'])
const errorOf = e => ({ code: e?.code || 'network', status: e?.status || null,
  retryAfterMs: e?.retryAfterMs || null, message: String(e?.message || e?.code || 'network') })
const retryable = e => ['network', 'timeout'].includes(e.code) ||
  (e.code === 'http' && (e.status === 408 || e.status === 429 || e.status >= 500))
const clone = x => JSON.parse(JSON.stringify(x))
const waitForRetry = async (ms, allowed) => {
  const deadline = Date.now() + ms
  // Long Retry-After values must not overflow setTimeout and immediately retry. Short
  // intervals also let Pause/Cancel release a lane while it waits rather than transfers.
  while (allowed() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())))
}

export function createCatalogueMediaDownloads({ manifest, store, transport, assetUrl,
  onChange = () => {}, online = () => globalThis.navigator?.onLine !== false,
  sleep = waitForRetry,
  makeId = () => globalThis.crypto.randomUUID(), now = Date.now } = {}) {
  const assets = new Map(manifest.assets.map(a => [a.assetId, a]))
  const hashAssets = new Map()
  for (const a of assets.values()) hashAssets.set(a.sha256, [...(hashAssets.get(a.sha256) || []), a])
  const byHash = new Map()
  const active = new Map()
  const completedSets = new WeakMap(), requestHashes = new WeakMap()
  const done = b => {
    const cached = completedSets.get(b)
    if (cached?.array === b.completed && cached.set.size === b.completed.length) return cached.set
    const set = new Set(b.completed)
    completedSets.set(b, { array: b.completed, set })
    return set
  }
  const requested = (b, hash) => {
    let cached = requestHashes.get(b)
    if (cached?.array !== b.assetIds) {
      const map = new Map()
      for (const id of b.assetIds) {
        const h = assets.get(id)?.sha256
        if (h) map.set(h, [...(map.get(h) || []), id])
      }
      cached = { array: b.assetIds, map }; requestHashes.set(b, cached)
    }
    return cached.map.get(hash) || []
  }
  let batches = []
  let foreground = true
  let scheduled = false
  let writing = Promise.resolve()
  let stopped = false

  const emit = () => onChange()
  const persist = () => {
    const saved = clone(batches)
    const next = writing.catch(() => {}).then(() => store.saveJobs(saved))
    writing = next
    return next
  }
  const owners = hash => batches.filter(b => b.status !== 'cancelled' &&
    requested(b, hash).some(id => !done(b).has(id) && !b.failed[id]))
  const eligible = hash => owners(hash).some(b => RUNNING.has(b.status))
  const finishBatch = b => {
    if (b.status === 'cancelled') return
    if (['no-space', 'io'].includes(b.error?.code)) { b.status = 'paused'; return }
    const completed = done(b)
    const pending = b.assetIds.filter(id => !completed.has(id) && !b.failed[id])
    if (b.retryOnly && b.retryOnly.every(id => completed.has(id) || b.failed[id])) {
      delete b.retryOnly
      b.status = pending.length ? 'paused' : Object.keys(b.failed).length ? 'failed' : 'ready'
      return
    }
    if (!pending.length) b.status = Object.keys(b.failed).length ? 'failed' : 'ready'
    else if (b.status === 'pausing' && !pending.some(id => active.has(assets.get(id)?.sha256))) b.status = 'paused'
  }
  const record = (hash, fields) => {
    byHash.set(hash, { ...byHash.get(hash), ...fields })
    emit()
  }
  const pauseAll = () => {
    for (const b of batches) if (RUNNING.has(b.status) || b.status === 'pausing') {
      b.status = b.assetIds.some(id => active.has(assets.get(id)?.sha256)) ? 'pausing' : 'paused'
    }
  }
  const schedule = () => {
    if (scheduled || stopped) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; pump() })
  }
  const run = async (asset, task) => {
    const hash = asset.sha256
    const destination = store.staging(makeId())
    const generations = new Map(hashAssets.get(hash).map(a => [a.assetId, store.generation(a)]))
    let failure = null
    try {
      if (!await store.has(asset)) {
        for (let attempt = 0; ; attempt++) {
          if (!owners(hash).length) return
          try {
            if (!online()) throw { code: 'offline' }
            record(hash, { status: 'downloading', received: 0, bytes: asset.bytes, error: null, retries: attempt })
            for (const b of owners(hash)) for (const id of requested(b, hash)) b.retries[id] = attempt
            const url = assetUrl(asset)
            if (!url) throw { code: 'unavailable' }
            const result = await transport.download({ url, destination, expectedBytes: asset.bytes,
              onProgress: p => record(hash, { received: Math.min(asset.bytes, typeof p === 'number' ? p : p.bytes || 0) }) })
            // Native transport also checks every redirect. Check the reported final origin again
            // so an injected transport cannot accidentally forward credentials or trust a mirror.
            const final = new URL(result.finalUrl)
            if (final.protocol !== 'https:' || final.origin !== new URL(url).origin || final.username || final.password)
              throw { code: 'redirect' }
            if (result.bytesWritten !== asset.bytes) throw { code: 'size' }
            const wanted = owners(hash).flatMap(b => requested(b, hash))
              .map(id => assets.get(id)).find(a => a.sha256 === hash && store.generation(a) === generations.get(a.assetId))
            if (!wanted) return
            record(hash, { status: 'verifying', received: asset.bytes })
            if (!await store.commit(wanted, destination, generations.get(wanted.assetId), () =>
              owners(hash).some(b => requested(b, hash).includes(wanted.assetId)) &&
              store.generation(wanted) === generations.get(wanted.assetId))) return
            break
          } catch (e) {
            const err = errorOf(e)
            await store.discard(destination).catch(() => {})
            if (err.code === 'offline' || !online()) { pauseAll(); failure = null; return }
            if (err.code === 'no-space' || err.code === 'io') {
              pauseAll()
              for (const b of owners(hash)) b.error = err
              failure = err; break
            }
            if (attempt >= RETRIES.length || !retryable(err)) { failure = err; break }
            if (!eligible(hash) || !foreground) return
            const wait = Math.max(RETRIES[attempt], err.status === 429 ? err.retryAfterMs || 0 : 0)
            record(hash, { status: 'queued', error: err, retries: attempt + 1 })
            await sleep(wait, () => eligible(hash) && foreground)
            if (!eligible(hash) || !foreground) return
          }
        }
      }
      if (!failure && await store.has(asset)) {
        for (const b of owners(hash)) {
          for (const id of requested(b, hash)) if (!done(b).has(id)) {
            if (await store.retain(assets.get(id), generations.get(id))) {
              b.completed.push(id)
              delete b.failed[id]
            }
          }
        }
        record(hash, { status: 'downloaded', received: asset.bytes, error: null })
      } else if (failure) {
        for (const b of owners(hash)) for (const id of requested(b, hash)) b.failed[id] = failure
        record(hash, { status: 'failed', error: failure })
      }
    } catch (e) {
      failure = errorOf(e)
      for (const b of owners(hash)) {
        b.status = 'paused'
        b.error = failure
      }
      record(hash, { status: 'failed', error: failure })
    } finally {
      await store.discard(destination).catch(() => {})
      if (active.get(hash) === task) active.delete(hash)
      for (const b of batches) finishBatch(b)
      // An error here is visible and pauses scheduling; it cannot turn an undurable job into
      // a success. The verified object can still be recovered independently at next launch.
      try { await persist() } catch (e) { stopped = true; pauseAll(); for (const b of batches) if (b.status !== 'cancelled') b.error = errorOf({ code: 'io', message: e.message }) }
      emit()
      schedule()
    }
  }
  const pump = () => {
    if (stopped || !foreground) return
    if (!online()) { pauseAll(); persist().catch(() => {}); emit(); return }
    for (const b of batches) {
      if (!RUNNING.has(b.status)) continue
      for (const id of b.assetIds) {
        if (active.size >= 2) return
        const a = assets.get(id)
        if (!a || a.bundledPath || done(b).has(id) || b.failed[id] || active.has(a.sha256) ||
          b.retryOnly && !b.retryOnly.includes(id)) continue
        b.status = 'downloading'
        const task = {}
        active.set(a.sha256, task)
        run(a, task)
      }
    }
  }
  const find = id => {
    const b = batches.find(x => x.id === id)
    if (!b) throw new Error('Unknown download batch')
    return b
  }

  return {
    async init() {
      const saved = await store.readJobs()
      batches = Array.isArray(saved) ? saved.filter(b => b && typeof b.id === 'string' && Array.isArray(b.assetIds)).map(b => {
        const changed = b.mediaRevision !== manifest.mediaRevision
        const unavailable = []
        const ids = b.assetIds.flatMap(id => {
          if (!changed && assets.has(id)) return [id]
          const [drawingId, kind] = String(id).split(':')
          const a = manifest.assets.find(a => a.drawingId === drawingId && a.kind === kind)
          if (!a) { unavailable.push(id); return [] }
          return [a.assetId]
        })
        const failed = !changed && b.failed && typeof b.failed === 'object'
          ? Object.fromEntries(Object.entries(b.failed).filter(([id]) => ids.includes(id))) : {}
        return { ...b, assetIds: [...new Set(ids)].sort(), completed: [], failed, retries: changed ? {} : b.retries || {},
          mediaRevision: manifest.mediaRevision, status: b.status === 'cancelled' ? 'cancelled' : 'paused',
          requiresConfirmation: changed, unavailable }
      }) : []
      for (const b of batches) {
        if (b.status === 'cancelled') continue
        for (const id of b.assetIds) {
          const a = assets.get(id), generation = store.generation(a)
          if (a.bundledPath || await store.has(a) && await store.retain(a, generation)) {
            b.completed.push(id); delete b.failed[id]
          }
        }
        if (b.assetIds.length && b.completed.length === b.assetIds.length && b.status !== 'cancelled') b.status = 'ready'
      }
      await persist()
      emit()
    },
    async enqueue(ids) {
      const assetIds = [...new Set(ids)].filter(id => assets.get(id)?.kind === 'clip').sort()
      const b = { id: makeId(), mediaRevision: manifest.mediaRevision, assetIds,
        completed: [], failed: {}, retries: {}, status: 'queued', createdAt: now(), requiresConfirmation: false, unavailable: [] }
      for (const id of assetIds) {
        const a = assets.get(id), generation = store.generation(a)
        if (a.bundledPath || await store.has(a) && await store.retain(a, generation)) b.completed.push(id)
      }
      finishBatch(b)
      batches.push(b)
      await persist()
      emit(); schedule()
      return { batchId: b.id }
    },
    async pause(id) {
      const b = find(id)
      if (!RUNNING.has(b.status)) return
      b.status = b.assetIds.some(id => active.has(assets.get(id)?.sha256)) ? 'pausing' : 'paused'
      await persist(); emit()
    },
    async resume(id) {
      const b = find(id)
      if (!['paused', 'failed'].includes(b.status)) return
      // Explicit Continue is confirmation of the newly previewed snapshot after an upgrade.
      b.requiresConfirmation = false
      b.status = 'queued'; b.failed = {}; delete b.error
      delete b.retryOnly
      stopped = false
      await persist(); emit(); schedule()
    },
    async retry(id) {
      const b = find(id)
      if (!Object.keys(b.failed).length) return
      b.retryOnly = Object.keys(b.failed)
      b.status = 'queued'; b.failed = {}; delete b.error
      stopped = false
      await persist(); emit(); schedule()
    },
    async cancel(id) {
      const b = find(id)
      b.status = 'cancelled'
      await persist(); emit()
    },
    async cancelPending() {
      for (const b of batches) if (!['ready', 'cancelled'].includes(b.status)) b.status = 'cancelled'
      await persist(); emit()
    },
    async exclude(ids) {
      const selected = new Set(ids)
      for (const b of batches) {
        b.assetIds = b.assetIds.filter(id => !selected.has(id))
        b.completed = b.completed.filter(id => !selected.has(id))
        for (const id of selected) delete b.failed[id]
        if (!b.assetIds.length) b.status = 'cancelled'
        else finishBatch(b)
      }
      await persist(); emit()
    },
    setForeground(value) {
      foreground = value
      if (!value) { pauseAll(); persist().catch(() => {}); emit() }
      // Returning to the foreground never resumes a paused batch implicitly.
    },
    setOnline(value) { if (!value) { pauseAll(); persist().catch(() => {}); emit() } },
    snapshot() {
      const resources = {}
      const waitingIds = new Set(batches.filter(b => RUNNING.has(b.status))
        .flatMap(b => { const done = new Set(b.completed), retry = b.retryOnly && new Set(b.retryOnly)
          return b.assetIds.filter(id => !done.has(id) && !b.failed[id] && (!retry || retry.has(id))) }))
      for (const a of assets.values()) {
        const r = byHash.get(a.sha256)
        const waiting = waitingIds.has(a.assetId)
        if (r && (active.has(a.sha256) || r.status === 'failed' && !waiting)) resources[a.assetId] = { ...r, bytes: a.bytes }
        else if (waiting) resources[a.assetId] = { status: 'queued', bytes: a.bytes, received: 0 }
      }
      return { batches: clone(batches), resources }
    },
    async idle() { while (active.size || scheduled) await new Promise(r => setTimeout(r, 0)); await writing }
  }
}
