import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createCatalogueMediaStore } from './catalogue-media-store.js'

const ROOT = 'opengym-catalogue-media'
const webp = Buffer.from('RIFF0000WEBPtest-content')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const asset = (id = '0001', bytes = webp) => ({ assetId: `${id}:clip:180x180:webp`, drawingId: id, kind: 'clip', format: 'webp', bytes: bytes.length, sha256: hash(bytes), width: 180, height: 180, bundledPath: null })
const manifest = assets => ({ assets, mediaRevision: 'one' })
const objectPath = a => `${ROOT}/objects/${a.sha256}.${a.format}`
const failure = code => Object.assign(new Error(code), { code })
function fakeFiles() {
  const data = new Map()
  let failIndex = false
  return {
    data,
    set failIndex(value) { failIndex = value },
    async mkdir() {},
    async readText(path) { if (!data.has(path)) throw failure('ENOENT'); return data.get(path).toString() },
    async writeText(path, text) { if (failIndex && path.endsWith('/index.json.tmp')) throw failure('no-space'); data.set(path, Buffer.from(text)) },
    async rename(from, to) { if (!data.has(from)) throw failure('ENOENT'); data.set(to, data.get(from)); data.delete(from) },
    async remove(path) { if (!data.delete(path)) throw failure('ENOENT') },
    async list(path) { return [...data.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(k => k.slice(path.length + 1)) },
    async stat(path) { if (!data.has(path)) throw failure('ENOENT'); return { bytes: data.get(path).length } },
    async verify(path, a) {
      const bytes = data.get(path)
      if (!bytes || bytes.length !== a.bytes) throw failure('size')
      if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw failure('type')
      if (hash(bytes) !== a.sha256) throw failure('hash')
      return { bytes: bytes.length, sha256: hash(bytes), format: 'webp' }
    },
    async url(path) { return 'file://' + path },
    async freeBytes() { return 50000000 }
  }
}
async function setup(assets = [asset()], files = fakeFiles()) {
  const store = createCatalogueMediaStore({ manifest: manifest(assets), files })
  await store.init()
  return { store, files, a: assets[0] }
}
async function put(store, files, a, id = 'job') {
  const path = store.staging(id)
  files.data.set(path, webp)
  return store.commit(a, path, store.generation(a))
}
function blockOnce(files, method, matches) {
  let enter, release, blocked = false
  const entered = new Promise(resolve => { enter = resolve })
  const continued = new Promise(resolve => { release = resolve })
  const original = files[method]
  files[method] = async (...args) => {
    if (!blocked && matches(...args)) { blocked = true; enter(); await continued }
    return original(...args)
  }
  return { entered, release }
}

describe('catalogue media object store', () => {
  it('commits verified files before listing them and keeps downloads outside training state', async () => {
    const { store, files, a } = await setup()
    expect(await store.has(a)).toBe(false)
    expect(await put(store, files, a)).toBe(true)
    expect(await store.has(a)).toBe(true)
    expect(store.snapshot()).toMatchObject({ downloadedBytes: webp.length, resources: { [a.assetId]: { status: 'downloaded' } } })
    expect([...files.data.keys()].every(path => path.startsWith(ROOT + '/'))).toBe(true)
    const restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(true)
    expect((await restarted.store.acquire(a)).url).toBe('file://' + objectPath(a))
  })

  it.each(['size', 'type', 'hash'])('rejects %s mismatches and removes the partial file', async code => {
    const { store, files, a } = await setup()
    const path = store.staging('bad')
    const bad = code === 'size' ? Buffer.alloc(2) : Buffer.from(webp)
    if (code === 'type') bad[0] = 0
    if (code === 'hash') bad[bad.length - 1] ^= 1
    files.data.set(path, bad)
    await expect(store.commit(a, path, 0)).rejects.toMatchObject({ code })
    expect(files.data.has(path)).toBe(false)
    expect(await store.has(a)).toBe(false)
  })

  it('recovers a committed orphan after index persistence failed, and cleans unfinished staging', async () => {
    const { store, files, a } = await setup()
    files.failIndex = true
    await expect(put(store, files, a)).rejects.toMatchObject({ code: 'no-space' })
    expect(files.data.has(objectPath(a))).toBe(true)
    expect(store.snapshot().resources[a.assetId]).toBeUndefined()
    files.data.set(store.staging('interrupted'), Buffer.alloc(3))
    files.failIndex = false
    const restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(true)
    expect(await files.list(ROOT + '/staging')).toEqual([])
  })

  it('uses the previous index and reconstructs verified objects when both indexes are broken', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    await store.saveJobs([{ status: 'downloading', assetIds: [a.assetId] }])
    files.data.set(ROOT + '/index.json', Buffer.from('{'))
    let restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(true)
    files.data.set(ROOT + '/index.json', Buffer.from('{'))
    files.data.set(ROOT + '/index.previous.json', Buffer.from('{'))
    restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(true)
    expect(await restarted.store.readJobs()).toEqual([{ status: 'downloading', assetIds: [a.assetId] }])
  })

  it('revokes missing files and revalidates same-length corruption after playback failure', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    const bad = Buffer.from(webp); bad[bad.length - 1] ^= 1
    files.data.set(objectPath(a), bad)
    expect(await store.verify(a)).toBe(false)
    expect(await store.has(a)).toBe(false)
    await put(store, files, a, 'again')
    files.data.delete(objectPath(a))
    expect(await store.has(a)).toBe(false)
    expect(store.snapshot().downloadedBytes).toBe(0)
  })

  it('replaces an existing corrupt object even when its byte length is unchanged', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    const bad = Buffer.from(webp); bad[bad.length - 1] ^= 1
    files.data.set(objectPath(a), bad)
    await put(store, files, a, 'replacement')
    expect(files.data.get(objectPath(a))).toEqual(webp)
    expect(await store.verify(a)).toBe(true)
  })

  it('reuses verified unchanged content when an upgrade changes the logical asset ID', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    const b = { ...a, assetId: '0001:clip:240x240:webp', width: 240, height: 240 }
    const restarted = await setup([b], files)
    expect(await restarted.store.has(b)).toBe(true)
    expect(restarted.store.snapshot().obsoleteBytes).toBe(0)
  })

  it('recovers jobs from the previous complete write', async () => {
    const { store, files, a } = await setup()
    await store.saveJobs([{ id: 'first', status: 'paused' }])
    await store.saveJobs([{ id: 'second', status: 'paused' }])
    files.data.set(ROOT + '/jobs.json', Buffer.from('{'))
    const restarted = await setup([a], files)
    expect(await restarted.store.readJobs()).toEqual([{ id: 'first', status: 'paused' }])
  })

  it('holds a playing file until release, and a stale download cannot undo cleanup', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    const playback = await store.acquire(a)
    const oldGeneration = store.generation(a)
    const stale = store.staging('stale'); files.data.set(stale, webp)
    expect(await store.remove([a.assetId])).toEqual({ removedBytes: 0, deferredCount: 1 })
    expect(files.data.has(objectPath(a))).toBe(true)
    expect(await store.acquire(a)).toBeNull()
    expect(await store.commit(a, stale, oldGeneration)).toBe(false)
    await playback.release(); await playback.release()
    expect(files.data.has(objectPath(a))).toBe(false)
    expect(store.snapshot().downloadedBytes).toBe(0)
    const restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(false)
  })

  it('cancellation during verification discards staging before any object is committed', async () => {
    const { store, files, a } = await setup()
    const path = store.staging('cancel-verifying'); files.data.set(path, webp)
    const gate = blockOnce(files, 'verify', name => name === path)
    let allowed = true
    const committing = store.commit(a, path, 0, () => allowed)
    await gate.entered
    allowed = false; gate.release()
    expect(await committing).toBe(false)
    expect(files.data.has(path)).toBe(false)
    expect(files.data.has(objectPath(a))).toBe(false)
    const restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(false)
  })

  it('cancellation during index persistence retracts new content and survives corrupt primary metadata', async () => {
    const { store, files, a } = await setup()
    const path = store.staging('cancel-index'); files.data.set(path, webp)
    const gate = blockOnce(files, 'writeText', name => name === ROOT + '/index.json.tmp')
    let allowed = true
    const committing = store.commit(a, path, 0, () => allowed)
    await gate.entered
    expect(files.data.has(objectPath(a))).toBe(true)
    expect(store.snapshot().resources[a.assetId]).toBeUndefined()
    allowed = false; gate.release()
    expect(await committing).toBe(false)
    expect(files.data.has(objectPath(a))).toBe(false)
    expect(store.snapshot().resources[a.assetId]).toBeUndefined()
    // Even fallback to a prior index must not turn a cancelled orphan into ready content.
    files.data.set(ROOT + '/generations.json', Buffer.from('{'))
    files.data.set(ROOT + '/index.json', Buffer.from('{'))
    files.data.set(ROOT + '/index.previous.json', Buffer.from('{'))
    files.data.set(objectPath(a), webp)
    const restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(false)
  })

  it('cancelling a new shared retention during persistence preserves the prior retained object', async () => {
    const a = asset(), b = asset('0002')
    const { store, files } = await setup([a, b])
    await put(store, files, a)
    const path = store.staging('cancel-shared'); files.data.set(path, webp)
    const gate = blockOnce(files, 'writeText', name => name === ROOT + '/index.json.tmp')
    let allowed = true
    const committing = store.commit(b, path, 0, () => allowed)
    await gate.entered
    allowed = false; gate.release()
    expect(await committing).toBe(false)
    expect(await store.has(a)).toBe(true)
    const saved = JSON.parse(await files.readText(ROOT + '/index.json'))
    expect(saved.records[`${a.sha256}.${a.format}`].assetIds).toEqual([a.assetId])
    expect(await store.remove([a.assetId])).toEqual({ removedBytes: webp.length, deferredCount: 0 })
    expect(await store.has(b)).toBe(false)
  })

  it('persists cleanup generations before file deletion so an undeletable orphan never revives', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    const remove = files.remove
    files.remove = async path => { if (path === objectPath(a)) throw failure('io'); return remove(path) }
    await expect(store.remove([a.assetId])).rejects.toMatchObject({ code: 'io' })
    files.data.set(ROOT + '/index.json', Buffer.from('{'))
    files.data.set(ROOT + '/index.previous.json', Buffer.from('{'))
    files.remove = remove
    const restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(false)
    expect(store.generation(a)).toBe(1)
  })

  it('recovers an authorized redownload after cleanup when the object rename outlives its index write', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    await store.remove([a.assetId])
    files.failIndex = true
    await expect(put(store, files, a, 'redownload')).rejects.toMatchObject({ code: 'no-space' })
    files.failIndex = false
    const restarted = await setup([a], files)
    expect(await restarted.store.has(a)).toBe(true)
    expect(restarted.store.generation(a)).toBe(1)
  })

  it('shares physical content and reports zero freed bytes while another asset retains it', async () => {
    const a = asset(), b = asset('0002')
    const { store, files } = await setup([a, b])
    await Promise.all([put(store, files, a, 'one'), put(store, files, b, 'two')])
    expect(store.snapshot().downloadedBytes).toBe(webp.length)
    expect(await store.remove([a.assetId])).toEqual({ removedBytes: 0, deferredCount: 0 })
    expect(await store.has(b)).toBe(true)
    expect(await store.remove([b.assetId])).toEqual({ removedBytes: webp.length, deferredCount: 0 })
    expect(await store.has(a)).toBe(false)
  })

  it.each(['primary', 'fallback'])('uses latest shared retention intent after cleanup outlives the %s index', async indexSource => {
    const a = asset(), b = asset('0002')
    const { store, files } = await setup([a, b])
    await put(store, files, a, 'first')
    await put(store, files, b, 'second')
    files.failIndex = true
    // The journal now retains only B, while the last complete index still retains A+B.
    await expect(store.remove([a.assetId])).rejects.toMatchObject({ code: 'no-space' })
    expect(files.data.has(objectPath(a))).toBe(true)
    files.failIndex = false
    if (indexSource === 'fallback') files.data.set(ROOT + '/index.json', Buffer.from('{'))

    const restarted = await setup([a, b], files)
    expect(await restarted.store.has(b)).toBe(true)
    const saved = JSON.parse(await files.readText(ROOT + '/index.json'))
    expect(saved.records[`${a.sha256}.${a.format}`].assetIds).toEqual([b.assetId])
    expect(await restarted.store.remove([b.assetId])).toEqual({ removedBytes: webp.length, deferredCount: 0 })
    expect(files.data.has(objectPath(a))).toBe(false)
    const again = await setup([a, b], files)
    expect(await again.store.has(a)).toBe(false)
    expect(await again.store.has(b)).toBe(false)
  })

  it('keeps legacy index retention when the journal predates explicit retention intent', async () => {
    const a = asset(), b = asset('0002')
    const { store, files } = await setup([a, b])
    await put(store, files, a, 'legacy-first')
    await put(store, files, b, 'legacy-second')
    const legacy = JSON.parse(await files.readText(ROOT + '/generations.json'))
    delete legacy.retentions
    files.data.set(ROOT + '/generations.json', Buffer.from(JSON.stringify(legacy)))
    const restarted = await setup([a, b], files)
    expect(await restarted.store.has(a)).toBe(true)
    expect(await restarted.store.has(b)).toBe(true)
    expect(await restarted.store.remove([a.assetId])).toEqual({ removedBytes: 0, deferredCount: 0 })
    expect(await restarted.store.remove([b.assetId])).toEqual({ removedBytes: webp.length, deferredCount: 0 })
  })

  it('normalizes upgraded shared asset IDs in retention intent before a later cleanup', async () => {
    const a = asset(), b = asset('0002')
    const { store, files } = await setup([a, b])
    await put(store, files, a, 'upgrade-first')
    await put(store, files, b, 'upgrade-second')
    const upgraded = { ...a, assetId: '0001:clip:240x240:webp', width: 240, height: 240 }
    const restarted = await setup([upgraded, b], files)
    expect(await restarted.store.has(upgraded)).toBe(true)
    const journal = JSON.parse(await files.readText(ROOT + '/generations.json'))
    expect(new Set(journal.retentions[`${a.sha256}.${a.format}`])).toEqual(new Set([upgraded.assetId, b.assetId]))
    expect(await restarted.store.remove([upgraded.assetId])).toEqual({ removedBytes: 0, deferredCount: 0 })
    const again = await setup([upgraded, b], files)
    expect(await again.store.remove([b.assetId])).toEqual({ removedBytes: webp.length, deferredCount: 0 })
  })

  it('retains a cached shared object for each explicit request and refuses stale retention', async () => {
    const a = asset(), b = asset('0002')
    const { store, files } = await setup([a, b])
    await put(store, files, a)
    expect(await store.retain(b, 0)).toBe(true)
    expect(await store.remove([a.assetId])).toEqual({ removedBytes: 0, deferredCount: 0 })
    expect(await store.has(b)).toBe(true)
    await store.remove([b.assetId])
    expect(await store.retain(b, 0)).toBe(false)
    expect(store.snapshot().downloadedBytes).toBe(0)
  })

  it('keeps obsolete version bytes until explicit cleanup and never reports them ready', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    const b = { ...a, sha256: 'f'.repeat(64) }
    const restarted = await setup([b], files)
    expect(await restarted.store.has(b)).toBe(false)
    expect(restarted.store.snapshot().obsoleteBytes).toBe(webp.length)
    expect(await restarted.store.removeObsolete()).toEqual({ removedBytes: webp.length, deferredCount: 0 })
    expect(restarted.store.snapshot().downloadedBytes).toBe(0)
  })

  it('removeAll invalidates active downloads and includes obsolete files', async () => {
    const { store, files, a } = await setup()
    await put(store, files, a)
    const path = store.staging('late'); files.data.set(path, webp)
    const old = store.generation(a)
    expect(await store.removeAll()).toEqual({ removedBytes: webp.length, deferredCount: 0 })
    expect(await store.commit(a, path, old)).toBe(false)
    expect(await store.freeBytes()).toBe(50000000)
    files.freeBytes = async () => { throw failure('io') }
    expect(await store.freeBytes()).toBeNull()
    expect(() => store.staging('../escape')).toThrow()
  })
})
