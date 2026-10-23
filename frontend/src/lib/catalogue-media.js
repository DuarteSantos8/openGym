import { validateCatalogueManifest, catalogueAssetUrl } from './catalogue-media-manifest.js'
import { createCatalogueMediaDownloads } from './catalogue-media-download.js'

const RESERVE = 16 * 1024 * 1024
export function createCatalogueMedia({ manifest, bundledResolver = a => a.bundledPath, store, transport,
  online, sleep, makeId } = {}) {
  validateCatalogueManifest(manifest)
  const assets = new Map(manifest.assets.map(a => [a.assetId, a]))
  const listeners = new Set()
  let current = null
  let queue
  const refresh = () => {
    const disk = store.snapshot()
    const jobs = queue?.snapshot() || { batches: [], resources: {} }
    const resources = Object.fromEntries(manifest.assets.map(a => [a.assetId,
      { status: 'missing', bytes: a.bytes, received: 0, error: null }]))
    Object.assign(resources, jobs.resources, disk.resources)
    const bundled = new Map()
    for (const a of assets.values()) if (a.bundledPath) {
      resources[a.assetId] = { status: 'bundled', bytes: a.bytes, received: a.bytes, error: null }
      bundled.set(a.bundledPath, a.bytes)
    }
    current = { ...disk, ...jobs, resources, downloadedBytes: disk.downloadedBytes || 0,
      obsoleteBytes: disk.obsoleteBytes || 0, bundledBytes: [...bundled.values()].reduce((n, b) => n + b, 0) }
    listeners.forEach(fn => fn())
  }
  queue = createCatalogueMediaDownloads({ manifest, store, transport,
    assetUrl: a => catalogueAssetUrl(manifest, a), onChange: refresh, online, sleep, makeId })
  const service = {
    manifest,
    async init() { await store.init(); await queue.init(); refresh(); return service },
    async resolve(id) {
      const asset = assets.get(id)
      if (!asset) return { status: 'unavailable', url: null, release() {} }
      if (asset.bundledPath) {
        const url = await bundledResolver(asset)
        if (url) return { status: 'bundled', url, release() {} }
      }
      const local = await store.acquire(asset)
      refresh()
      return local ? { status: 'downloaded', url: local.url, async release() {
        try { await local.release() } catch { /* keep failed cleanup visible for a later retry */ }
        refresh()
      } } : { status: 'missing', url: null, release() {} }
    },
    async estimate(ids) {
      const missing = new Map()
      let missingCount = 0
      for (const id of new Set(ids)) {
        const a = assets.get(id)
        if (!a || a.kind !== 'clip' || a.bundledPath || await store.has(a)) continue
        missingCount++
        missing.set(a.sha256, a.bytes)
      }
      const sizes = [...missing.values()].sort((a, b) => b - a)
      const downloadBytes = sizes.reduce((n, b) => n + b, 0)
      let freeBytes = null
      try { freeBytes = await store.freeBytes() } catch { /* report unavailable, never assume enough */ }
      return { missingCount, downloadBytes, peakAdditionalBytes: downloadBytes ? downloadBytes + sizes.slice(0, 2).reduce((n, b) => n + b, 0) + RESERVE : 0,
        freeBytes: Number.isFinite(freeBytes) && freeBytes >= 0 ? freeBytes : null }
    },
    async enqueue(ids) {
      const estimate = await service.estimate(ids)
      if (estimate.freeBytes !== null && estimate.freeBytes < estimate.peakAdditionalBytes)
        throw Object.assign(new Error('Not enough storage space'), { code: 'no-space', status: null, retryAfterMs: null })
      return queue.enqueue(ids)
    },
    pause: id => queue.pause(id),
    resume: async id => {
      const batch = queue.snapshot().batches.find(b => b.id === id)
      if (!batch) return
      const estimate = await service.estimate(batch.assetIds)
      if (estimate.freeBytes !== null && estimate.freeBytes < estimate.peakAdditionalBytes)
        throw Object.assign(new Error('Not enough storage space'), { code: 'no-space' })
      await queue.resume(id)
    },
    cancel: id => queue.cancel(id),
    cancelPending: () => queue.cancelPending(),
    retry: async id => {
      const batch = queue.snapshot().batches.find(b => b.id === id)
      if (!batch) return
      const estimate = await service.estimate(Object.keys(batch.failed))
      if (estimate.freeBytes !== null && estimate.freeBytes < estimate.peakAdditionalBytes)
        throw Object.assign(new Error('Not enough storage space'), { code: 'no-space' })
      await queue.retry(id)
    },
    async remove(ids) { await queue.exclude(ids); const result = await store.remove(ids); refresh(); return result },
    async removeAll() {
      await queue.exclude([...assets.keys()])
      const result = await store.removeAll()
      refresh(); return result
    },
    async removeObsolete() { const result = await store.removeObsolete(); refresh(); return result },
    async revalidate(id) {
      const asset = assets.get(id)
      const valid = asset ? await store.verify(asset) : false
      refresh(); return valid
    },
    snapshot() { return current },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    setForeground: value => queue.setForeground(value),
    setOnline: value => queue.setOnline(value),
    idle: () => queue.idle()
  }
  refresh()
  return service
}

let runtime = null
let starting = null
let runtimeSnapshot = null
const subscribers = new Set()
const publish = () => { runtimeSnapshot = runtime?.snapshot() || null; subscribers.forEach(fn => fn()) }
export const getCatalogueMedia = () => runtime
export const catalogueMediaSnapshot = () => runtimeSnapshot
export function subscribeCatalogueMedia(fn) { subscribers.add(fn); return () => subscribers.delete(fn) }

// Observe identity only. No profile data is persisted in jobs, and cached public objects can
// stay, but unfinished batches must not carry over into another person's use of the device.
export function startCatalogueMedia(profileStore, initialize = initCatalogueMedia) {
  let previous = profileStore.getState().user?.id || null
  let changedDuringStartup = false, service = null, stopped = false
  const unsubscribe = profileStore.subscribe(state => {
    const next = state.user?.id || null
    if (previous && previous !== next) {
      if (service) service.cancelPending().catch(() => {})
      else changedDuringStartup = true
    }
    previous = next
  })
  Promise.resolve(initialize()).then(value => {
    if (stopped) return
    service = value
    if (changedDuringStartup) service?.cancelPending().catch(() => {})
  }).catch(() => {})
  return () => { stopped = true; unsubscribe() }
}

// Only the manifest inside this signed application is trusted. No account, server, preferences
// or network manifest can change the set of content hashes this build accepts.
export async function initCatalogueMedia() {
  if (runtime) return runtime
  if (starting) return starting
  starting = (async () => {
    const { MOBILE, isAndroid } = await import('./mobile.js')
    if (!MOBILE || !await isAndroid()) return null
    const res = await fetch('exercise-media/manifest.json', { credentials: 'omit', cache: 'no-store' })
    if (!res.ok) return null
    const manifest = validateCatalogueManifest(await res.json())
    const [{ createCatalogueMediaNative }, { createCatalogueMediaStore }] = await Promise.all([
      import('./catalogue-media-native.js'), import('./catalogue-media-store.js')])
    const { files, transport } = await createCatalogueMediaNative()
    const store = createCatalogueMediaStore({ manifest, files })
    const instance = createCatalogueMedia({ manifest, store, transport })
    await instance.init()
    runtime = instance
    runtime.subscribe(publish)
    publish()
    const { App } = await import('@capacitor/app')
    App.addListener('appStateChange', ({ isActive }) => runtime.setForeground(isActive))
    try { const state = await App.getState(); runtime.setForeground(state.isActive) } catch { /* foreground by default */ }
    globalThis.addEventListener?.('offline', () => runtime.setOnline(false))
    return runtime
  })().catch(() => null).finally(() => { starting = null })
  return starting
}
