/* The browser's backend for lib/media-store.js: IndexedDB database 'opengym-media', object store
 * 'blobs', one record per file keyed by its hash — { hash, blob, mime, size, putAt, shownAt,
 * pending, rejected }.
 *
 * IndexedDB rather than the Cache API or localStorage: it holds Blobs as they are (a browser keeps
 * them on disk and hands back a reference, so listing records does not read the bytes), it is
 * there for guests and the demo as much as for a signed-in browser, and it is per origin like
 * the rest of the profile. Opening can fail — some private windows block it, an old Firefox
 * refuses Blobs in it — and then open() answers false and the store falls back to memory.
 */

const DB = 'opengym-media'
const STORE = 'blobs'

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error || new Error('aborted'))
})
const meta = r => {
  const { blob, data, ...rest } = r
  return rest
}

export function idbBackend({ idb = globalThis.indexedDB } = {}) {
  let db = null
  const tx = mode => db.transaction(STORE, mode)
  return {
    name: 'idb',
    persistent: true,
    async open() {
      if (!idb) return false
      try {
        db = await new Promise((resolve, reject) => {
          const r = idb.open(DB, 1)
          r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'hash' }) }
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
          r.onblocked = () => reject(new Error('blocked'))
        })
        // Another tab upgrading a later version asks this one to let go.
        db.onversionchange = () => { try { db.close() } catch { /* already closed */ } }
        // A write test: some browsers open the database and then refuse every Blob put into it.
        const t = tx('readwrite')
        t.objectStore(STORE).put({ hash: '.probe', data: new Uint8Array([120]).buffer, mime: '', size: 1 })
        t.objectStore(STORE).delete('.probe')
        await done(t)
        return true
      } catch {
        try { db?.close() } catch { /* nothing to close */ }
        db = null
        return false
      }
    },
    async all() {
      const out = []
      await new Promise((resolve, reject) => {
        const r = tx('readonly').objectStore(STORE).openCursor()
        r.onsuccess = () => {
          const c = r.result
          if (!c) return resolve()
          if (typeof c.value?.hash === 'string' && !c.value.hash.startsWith('.')) out.push(meta(c.value))
          c.continue()
        }
        r.onerror = () => reject(r.error)
      })
      return out
    },
    async getBlob(hash) {
      const r = await req(tx('readonly').objectStore(STORE).get(hash))
      if (!r) return null
      if (r.data) return new Blob([r.data], { type: r.mime || '' })
      if (!r.blob) return null
      // A record from before `data`: read it through once. On WebKit a large one may no longer be
      // readable — then it is missing (the caller fetches it again or shows the fallback tile)
      // rather than a video that never plays. A readable one is rewritten in the new shape.
      let buf
      try { buf = await r.blob.arrayBuffer() } catch { return null }
      if (typeof r.size === 'number' && buf.byteLength !== r.size) return null
      try {
        const t = tx('readwrite')
        const { blob: _old, ...rest } = r
        t.objectStore(STORE).put({ ...rest, data: buf })
        await done(t)
      } catch { /* still readable this time; the next read tries again */ }
      return new Blob([buf], { type: r.mime || '' })
    },
    async put(rec, blob) {
      // Read before the transaction opens: an await inside it would let it commit early.
      const data = blob ? await blob.arrayBuffer() : undefined
      const t = tx('readwrite')
      t.objectStore(STORE).put(data ? { ...rec, data } : { ...rec })
      await done(t)
    },
    async patch(hash, fields) {
      const t = tx('readwrite')
      const s = t.objectStore(STORE)
      const r = s.get(hash)
      r.onsuccess = () => { if (r.result) s.put({ ...r.result, ...fields }) }
      await done(t)
    },
    async remove(hash) {
      const t = tx('readwrite')
      t.objectStore(STORE).delete(hash)
      await done(t)
    },
    async clear() {
      const t = tx('readwrite')
      t.objectStore(STORE).clear()
      await done(t)
    }
  }
}
