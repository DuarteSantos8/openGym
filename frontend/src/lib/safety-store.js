// Where the safety copies (lib/safety-copies.js) are kept: IndexedDB database 'opengym-safety',
// object store 'copies', one record per copy. Separate from localStorage on purpose: a browser that
// evicts or a bug that wipes the profile's localStorage key leaves this alone. Clearing all site
// data takes it too, which is why asking the browser for persistent storage comes with it.
// Every call resolves, never throws: with no IndexedDB (a private window) there are just no copies.
import { autoCopyDue, makeCopy, withCopy } from './safety-copies.js'

const DB = 'opengym-safety'
const STORE = 'copies'

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error || new Error('aborted'))
})

let dbp = null
const open = (idb = globalThis.indexedDB) => {
  if (!idb) return Promise.resolve(null)
  if (!dbp) {
    dbp = new Promise(resolve => {
      try {
        const r = idb.open(DB, 1)
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }) }
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => resolve(null)
        r.onblocked = () => resolve(null)
      } catch { resolve(null) }
    })
  }
  return dbp
}
/** For tests: forget the open connection so a new fake IndexedDB is used. */
export const resetSafetyStore = () => { dbp = null }

export async function listCopies() {
  try {
    const db = await open()
    if (!db) return []
    return (await req(db.transaction(STORE).objectStore(STORE).getAll())).sort((a, b) => (b.at || 0) - (a.at || 0))
  } catch { return [] }
}

/** Stores `copy`, then drops the ones the keep rules no longer want. Resolves true when stored. */
export async function saveCopy(copy) {
  if (!copy) return false
  try {
    const db = await open()
    if (!db) return false
    // Read first, then write in one go: a transaction left open across an await closes by itself.
    const existing = await listCopies()
    const ids = new Set(withCopy(existing, copy).map(c => c.id))
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    for (const old of existing) if (!ids.has(old.id)) os.delete(old.id)
    os.put(copy)
    await done(tx)
    return true
  } catch { return false }
}

export async function deleteCopy(id) {
  try {
    const db = await open()
    if (!db) return
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await done(tx)
  } catch { /* the copy stays; the list shows it again */ }
}

/** A copy taken just before a deletion ('reset' | 'import'). Resolves true when one was stored. */
export const copyBefore = (S, reason) => saveCopy(makeCopy(S, reason))

/** The daily copy: taken when one is due. Resolves true when one was stored. */
export async function copyDaily(S) {
  if (!autoCopyDue(S, await listCopies())) return false
  return saveCopy(makeCopy(S, 'auto'))
}

/**
 * Asks the browser not to clear this site's storage on its own (low disk, long disuse). Safe to
 * call every start: the browser answers the same once it has decided. Resolves true when granted.
 */
export async function keepStorage() {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return !!(await navigator.storage.persist())
  } catch { return false }
}
