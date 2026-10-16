/* Where the diary index (diary-index.js) is kept between visits. Two backends with one async
 * interface:
 *
 *   open()                          → boolean; false when the backend cannot be used
 *   load()                          → { meta, days }  (meta null when nothing was saved)
 *   apply({ put, remove, meta })    → days to put, dates to remove and the meta record, in ONE
 *                                     transaction (`meta` left out keeps the saved one)
 *   wipe()                          → everything gone, in one transaction
 *   destroy()                       → the whole database deleted (IndexedDB: deleteDatabase), for
 *                                     when wipe() fails; the store is opened again after it
 *
 * IndexedDB database 'gains-diary-index': object store 'days' (keyPath `date`, one record per
 * day) and 'meta' (one record, { v, owner, cursor, total, complete, syncedAt }). Opening can fail
 * (some private windows block it) and a write can hit the quota: the caller then falls back to
 * memoryIndexStore(), as lib/media-store-idb.js's callers do.
 */

const DB = 'gains-diary-index'
const DAYS = 'days'
const META = 'meta'
const META_KEY = 'meta'

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error || new Error('aborted'))
})

export function idbIndexStore({ idb = globalThis.indexedDB } = {}) {
  let db = null
  const tx = (stores, mode) => db.transaction(stores, mode)
  return {
    name: 'idb',
    async open() {
      if (!idb) return false
      try {
        db = await new Promise((resolve, reject) => {
          const r = idb.open(DB, 1)
          r.onupgradeneeded = () => {
            if (!r.result.objectStoreNames.contains(DAYS)) r.result.createObjectStore(DAYS, { keyPath: 'date' })
            if (!r.result.objectStoreNames.contains(META)) r.result.createObjectStore(META)
          }
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
          r.onblocked = () => reject(new Error('blocked'))
        })
        // Another tab upgrading a later version asks this one to let go.
        db.onversionchange = () => { try { db.close() } catch { /* already closed */ } }
        // A write test: some browsers open the database and then refuse every write.
        const t = tx(META, 'readwrite')
        t.objectStore(META).put(1, '.probe')
        t.objectStore(META).delete('.probe')
        await done(t)
        return true
      } catch {
        try { db?.close() } catch { /* nothing to close */ }
        db = null
        return false
      }
    },
    async load() {
      const t = tx([DAYS, META], 'readonly')
      const [days, meta] = await Promise.all([req(t.objectStore(DAYS).getAll()), req(t.objectStore(META).get(META_KEY))])
      return { meta: meta ?? null, days: days ?? [] }
    },
    async apply({ put = [], remove = [], meta } = {}) {
      const t = tx([DAYS, META], 'readwrite')
      const days = t.objectStore(DAYS)
      for (const date of remove) days.delete(date)
      for (const day of put) days.put(day)
      if (meta) t.objectStore(META).put(meta, META_KEY)
      await done(t)
    },
    async wipe() {
      const t = tx([DAYS, META], 'readwrite')
      t.objectStore(DAYS).clear()
      t.objectStore(META).clear()
      await done(t)
    },
    // The way out when wipe() fails: the whole database deleted. Rejects when it cannot be (a
    // tab still holding it open), so the caller knows the days are still there.
    async destroy() {
      try { db?.close() } catch { /* already closed */ }
      db = null
      if (!idb) throw new Error('no indexedDB')
      await new Promise((resolve, reject) => {
        const r = idb.deleteDatabase(DB)
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
        r.onblocked = () => reject(new Error('blocked'))
      })
    },
  }
}

export function memoryIndexStore() {
  const days = new Map()
  let meta = null
  return {
    name: 'memory',
    async open() { return true },
    async load() { return { meta: meta && structuredClone(meta), days: [...days.values()].map(d => structuredClone(d)) } },
    async apply({ put = [], remove = [], meta: next } = {}) {
      for (const date of remove) days.delete(date)
      for (const day of put) days.set(day.date, structuredClone(day))
      if (next) meta = structuredClone(next)
    },
    async wipe() {
      days.clear()
      meta = null
    },
    async destroy() {
      days.clear()
      meta = null
    },
  }
}
