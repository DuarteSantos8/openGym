// Device-only catalogue objects. This store never reads or writes the training state.
const ROOT = 'opengym-catalogue-media'
const INDEX = ROOT + '/index.json'
const JOURNAL = ROOT + '/generations.json'
const keyOf = a => `${a.sha256}.${a.format}`
const objectPath = key => ROOT + '/objects/' + key
const error = code => Object.assign(new Error(code), { code, status: null, retryAfterMs: null })
const plain = x => x && typeof x === 'object' && !Array.isArray(x)

export function createCatalogueMediaStore({ manifest, files }) {
  const assets = new Map(manifest.assets.map(a => [a.assetId, a]))
  const byKey = new Map()
  for (const a of manifest.assets) {
    const k = keyOf(a)
    byKey.set(k, [...(byKey.get(k) || []), a])
  }
  let records = {}, generations = {}, tombstones = {}, retentions = {}, jobs = []
  const playing = new Map()
  let tail = Promise.resolve()
  const serial = fn => { const next = tail.catch(() => {}).then(fn); tail = next; return next }
  const assetOf = a => typeof a === 'string' ? assets.get(a) : a
  const generation = a => generations[assetOf(a)?.assetId] || 0
  const quietRemove = path => files.remove(path).catch(() => {})
  const read = async (path, check) => {
    try { const x = JSON.parse(await files.readText(path)); return check(x) ? x : null } catch { return null }
  }
  const atomic = async (path, data) => {
    const text = JSON.stringify(data)
    await files.writeText(path + '.tmp', text)
    let prior = null
    try { prior = await files.readText(path) } catch (e) { if (e?.code !== 'ENOENT' && e?.code !== 'not-found') throw e }
    const check = path === INDEX ? indexValid : path === JOURNAL ? journalValid : x => Array.isArray(x) || plain(x)
    let validPrior = false
    try { validPrior = prior !== null && check(JSON.parse(prior)) } catch { /* keep the previous complete copy */ }
    if (validPrior) {
      await files.writeText(path + '.previous.tmp', prior)
      await files.rename(path + '.previous.tmp', path.replace(/\.json$/, '.previous.json'))
    }
    await files.rename(path + '.tmp', path)
  }
  const saveIndex = (value = records) => atomic(INDEX, { version: 1, records: value })
  const saveJournal = async (deletion = false) => {
    const value = { version: 1, generations, tombstones, retentions }
    await atomic(JOURNAL, value)
    if (deletion) {
      // The fallback must also know about deletions. Falling back to pre-cleanup intent
      // could resurrect a file whose unlink was deferred for a player at the crash.
      await files.writeText(JOURNAL + '.previous.tmp', JSON.stringify(value))
      await files.rename(JOURNAL + '.previous.tmp', ROOT + '/generations.previous.json')
    }
  }
  const recordValid = r => plain(r) && /^[0-9a-f]{64}$/.test(r.hash) && /^(webp|mp4)$/.test(r.format) && Number.isSafeInteger(r.bytes) && r.bytes > 0 && Array.isArray(r.assetIds) && r.assetIds.every(x => typeof x === 'string')
  const indexValid = x => plain(x) && x.version === 1 && plain(x.records) && Object.entries(x.records).every(([k, r]) => recordValid(r) && k === `${r.hash}.${r.format}`)
  const journalValid = x => plain(x) && x.version === 1 && plain(x.generations) && Object.values(x.generations).every(n => Number.isSafeInteger(n) && n >= 0) && plain(x.tombstones) && Object.entries(x.tombstones).every(([k, v]) => /^[0-9a-f]{64}\.(webp|mp4)$/.test(k) && v === true) && (x.retentions === undefined || plain(x.retentions) && Object.entries(x.retentions).every(([k, ids]) => /^[0-9a-f]{64}\.(webp|mp4)$/.test(k) && Array.isArray(ids) && ids.every(id => typeof id === 'string')))
  const intendedIds = (key, candidates) => {
    const intent = retentions[key]
    if (!Object.prototype.hasOwnProperty.call(retentions, key)) return candidates.filter(a => !generations[a.assetId]).map(a => a.assetId)
    if (!intent.length) return []
    const identities = new Set(intent.map(id => id.split(':').slice(0, 2).join(':')))
    return candidates.filter(a => intent.includes(a.assetId) || identities.has(a.assetId.split(':').slice(0, 2).join(':'))).map(a => a.assetId)
  }
  const exists = async (key, expected) => {
    try { return (await files.stat(objectPath(key))).bytes === expected } catch { return false }
  }
  const usable = async a => {
    if (!a) return false
    const k = keyOf(a), r = records[k]
    if (!r?.assetIds.length || r.pendingDelete) return false
    if (await exists(k, a.bytes)) return true
    delete records[k]
    await saveIndex()
    return false
  }
  const deleteUnheld = async key => {
    const r = records[key]
    if (!r || r.assetIds.length) return { bytes: 0, deferred: 0 }
    if (playing.get(key)) { r.pendingDelete = true; return { bytes: 0, deferred: 1 } }
    // Propagate actual deletion failures: never report bytes as freed when removal failed.
    try { await files.remove(objectPath(key)) } catch (e) { if (e?.code !== 'ENOENT' && e?.code !== 'not-found') throw e }
    delete records[key]
    return { bytes: r.bytes, deferred: 0 }
  }
  const removeKeys = async (ids, keys) => {
    const selected = new Set(ids)
    for (const id of selected) generations[id] = (generations[id] || 0) + 1
    for (const key of keys) {
      const r = records[key]
      if (r) r.assetIds = r.assetIds.filter(id => !selected.has(id))
      if (retentions[key]) retentions[key] = retentions[key].filter(id => !selected.has(id))
      if (!r?.assetIds.length) tombstones[key] = true
    }
    // The journal precedes deletion and the index. A crash cannot revive removed orphans.
    await saveJournal(true)
    let removedBytes = 0, deferredCount = 0
    for (const key of keys) {
      const result = await deleteUnheld(key)
      removedBytes += result.bytes; deferredCount += result.deferred
    }
    await saveIndex()
    return { removedBytes, deferredCount }
  }

  return {
    generation,
    staging(id) {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(String(id))) throw error('io')
      return ROOT + '/staging/' + id + '.part'
    },
    async init() {
      return serial(async () => {
        for (const dir of [ROOT, ROOT + '/objects', ROOT + '/staging']) await files.mkdir(dir)
        const journal = await read(JOURNAL, journalValid) || await read(ROOT + '/generations.previous.json', journalValid)
        if (journal) { generations = journal.generations; tombstones = journal.tombstones; retentions = journal.retentions || {} }
        const index = await read(INDEX, indexValid) || await read(ROOT + '/index.previous.json', indexValid)
        records = index?.records || {}
        let journalChanged = false
        // If an existing journal is unreadable, preserve objects for explicit cleanup but do
        // not infer retention from them: cancellation evidence may have been lost.
        let journalLost = false
        if (!journal) {
          for (const path of [JOURNAL, ROOT + '/generations.previous.json']) {
            try { await files.stat(path); journalLost = true } catch { /* absent on first run */ }
          }
        }
        for (const name of await files.list(ROOT + '/staging')) await quietRemove(ROOT + '/staging/' + name)
        for (const [key, r] of Object.entries(records)) {
          if (!(await exists(key, r.bytes))) { delete records[key]; continue }
          const retained = r.assetIds.length > 0
          r.assetIds = r.assetIds.filter(id => assets.get(id) && keyOf(assets.get(id)) === key && !tombstones[key])
          if (journalLost || tombstones[key]) r.assetIds = []
          if (r.pendingDelete || tombstones[key]) { await deleteUnheld(key); continue }
          const candidates = (byKey.get(key) || []).filter(a => a.bytes === r.bytes)
          if (!journalLost && candidates.length && Object.prototype.hasOwnProperty.call(retentions, key)) {
            // A cleanup saves intent before the index. In particular, removing one of
            // several shared references does not set an object-level tombstone, so the
            // latest journal must also override a stale index's per-asset references.
            const intended = intendedIds(key, candidates)
            let verified = true
            if (intended.some(id => !r.assetIds.includes(id))) {
              try { await files.verify(objectPath(key), candidates[0]) } catch { verified = false }
            }
            r.assetIds = verified ? intended : []
            if (verified && JSON.stringify(retentions[key]) !== JSON.stringify(intended)) {
              // Normalize logical IDs after an upgrade so a later cleanup can remove
              // the current ID from the same authoritative journal.
              retentions[key] = intended
              journalChanged = true
            }
          } else if (retained && !r.assetIds.length && !journalLost && byKey.has(key)) {
            const ids = new Set(intendedIds(key, byKey.get(key)))
            const candidates = byKey.get(key).filter(a => ids.has(a.assetId) && a.bytes === r.bytes)
            if (candidates.length) {
              try { await files.verify(objectPath(key), candidates[0]); r.assetIds = candidates.map(a => a.assetId) } catch { /* cleanable old content */ }
            }
          }
          // Old versions remain visible as cleanable bytes, without becoming current media.
        }
        for (const key of await files.list(ROOT + '/objects')) {
          if (records[key] || !/^[0-9a-f]{64}\.(webp|mp4)$/.test(key)) continue
          const candidates = byKey.get(key) || []
          const a = candidates[0]
          let bytes = 0
          try { bytes = (await files.stat(objectPath(key))).bytes } catch { continue }
          const ids = intendedIds(key, candidates)
          if (a && ids.length && !journalLost && !tombstones[key]) {
            try {
              await files.verify(objectPath(key), a)
              records[key] = { hash: a.sha256, format: a.format, bytes, assetIds: ids, downloadedAt: Date.now() }
              continue
            } catch { /* unverifiable objects can be explicitly cleaned */ }
          }
          const [hash, format] = key.split('.')
          if (bytes > 0) records[key] = { hash, format, bytes, assetIds: [], downloadedAt: 0 }
        }
        const jobsValid = x => Array.isArray(x) || plain(x)
        jobs = await read(ROOT + '/jobs.json', jobsValid) || await read(ROOT + '/jobs.previous.json', jobsValid) || []
        if (journalChanged) await saveJournal()
        await saveIndex()
      })
    },
    has(a) { return serial(() => usable(assetOf(a))) },
    retain(a, expectedGeneration = generation(a)) {
      return serial(async () => {
        a = assetOf(a)
        if (!a || generation(a) !== expectedGeneration || !(await usable(a))) return false
        const record = records[keyOf(a)]
        if (!record.assetIds.includes(a.assetId)) {
          record.assetIds.push(a.assetId)
          retentions[keyOf(a)] = [...record.assetIds]
          await saveJournal(); await saveIndex()
        }
        return true
      })
    },
    acquire(a) {
      return serial(async () => {
        a = assetOf(a)
        if (!(await usable(a))) return null
        const key = keyOf(a)
        playing.set(key, (playing.get(key) || 0) + 1)
        let released = false, url
        try { url = await files.url(objectPath(key)) } catch (e) { playing.set(key, playing.get(key) - 1); throw e }
        return { url, release: () => serial(async () => {
          if (released) return
          released = true
          playing.set(key, Math.max(0, (playing.get(key) || 0) - 1))
          if (records[key]?.pendingDelete) { await deleteUnheld(key); await saveIndex() }
        }) }
      })
    },
    commit(a, path, expectedGeneration, canCommit = () => true) {
      return serial(async () => {
        a = assetOf(a)
        const permitted = () => !!a && generation(a) === expectedGeneration && canCommit()
        if (!permitted()) { await quietRemove(path); return false }
        try { await files.verify(path, a) } catch (e) { await quietRemove(path); throw e }
        if (!permitted()) { await quietRemove(path); return false }
        const key = keyOf(a)
        const old = records[key]
        const oldIntent = retentions[key] ? [...retentions[key]] : null
        const oldTombstone = tombstones[key]
        let objectChanged = false
        const retract = async () => {
          if (oldIntent) retentions[key] = oldIntent
          else delete retentions[key]
          if (oldTombstone) tombstones[key] = true
          else delete tombstones[key]
          if (old) records[key] = old
          else delete records[key]
          const removeNewObject = objectChanged && !old?.assetIds.length
          if (removeNewObject) {
            tombstones[key] = true
            if (!records[key]) records[key] = { hash: a.sha256, format: a.format, bytes: a.bytes, assetIds: [], downloadedAt: 0 }
          }
          await saveJournal(removeNewObject)
          if (removeNewObject) await deleteUnheld(key)
          await saveIndex()
          await quietRemove(path)
          return false
        }
        const ids = [...new Set([...(old?.assetIds || []), a.assetId])]
        // Persist authorized retention before the object rename. This distinguishes a
        // fresh explicit redownload from an old cancelled orphan after a crash.
        retentions[key] = ids
        delete tombstones[key]
        await saveJournal()
        if (!permitted()) return retract()
        let validExisting = false
        if (await exists(key, a.bytes)) {
          try { await files.verify(objectPath(key), a); validExisting = true } catch { /* replace corrupt same-size object */ }
        }
        if (!permitted()) return retract()
        if (!validExisting) { await files.rename(path, objectPath(key)); objectChanged = true }
        else await quietRemove(path)
        const committed = { hash: a.sha256, format: a.format, bytes: a.bytes, assetIds: ids, downloadedAt: Date.now() }
        try { await saveIndex({ ...records, [key]: committed }) } catch (e) {
          if (!permitted()) return retract()
          // A verified orphan can be recovered at next startup, but it is not ready before
          // its retention record has been durably saved.
          if (old) records[key] = old
          else delete records[key]
          throw e
        }
        if (!permitted()) return retract()
        records[key] = committed
        return true
      })
    },
    remove(assetIds) {
      return serial(() => {
        const ids = [...new Set(assetIds)].filter(id => assets.has(id))
        return removeKeys(ids, new Set(ids.map(id => keyOf(assets.get(id)))))
      })
    },
    removeAll() {
      return serial(() => removeKeys([...assets.keys(), ...Object.values(records).flatMap(r => r.assetIds)], new Set([...byKey.keys(), ...Object.keys(records)])))
    },
    removeObsolete() {
      return serial(() => {
        const keys = Object.keys(records).filter(k => !byKey.has(k) || !records[k].assetIds.length)
        return removeKeys(keys.flatMap(k => records[k].assetIds), new Set(keys))
      })
    },
    verify(a) {
      return serial(async () => {
        a = assetOf(a)
        if (!(await usable(a))) return false
        const key = keyOf(a)
        try { await files.verify(objectPath(key), a); return true } catch {
          records[key].assetIds = []
          await deleteUnheld(key)
          await saveIndex()
          return false
        }
      })
    },
    discard(path) { return quietRemove(path) },
    async freeBytes() { try { const n = await files.freeBytes(); return Number.isSafeInteger(n) && n >= 0 ? n : null } catch { return null } },
    saveJobs(value) { return serial(async () => { await atomic(ROOT + '/jobs.json', value); jobs = JSON.parse(JSON.stringify(value)) }) },
    readJobs() { return Promise.resolve(JSON.parse(JSON.stringify(jobs))) },
    snapshot() {
      const resources = {}
      let downloadedBytes = 0, obsoleteBytes = 0
      for (const [key, r] of Object.entries(records)) {
        downloadedBytes += r.bytes
        if (!byKey.has(key) || !r.assetIds.length) obsoleteBytes += r.bytes
        if (!r.assetIds.length || r.pendingDelete) continue
        for (const a of byKey.get(key) || []) if (a.bytes === r.bytes) resources[a.assetId] = { status: 'downloaded', bytes: r.bytes, hash: r.hash, received: r.bytes, error: null }
      }
      return { resources, downloadedBytes, obsoleteBytes }
    }
  }
}
