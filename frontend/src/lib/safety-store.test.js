import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyBefore, copyDaily, deleteCopy, keepStorage, listCopies, resetSafetyStore, saveCopy } from './safety-store.js'
import { KEEP_AUTO, makeCopy } from './safety-copies.js'

/* Just enough IndexedDB: one database, one store keyed by `id`, requests that answer on the next
   tick, and transactions that complete after their last request. */
function fakeIdb() {
  const rows = new Map()
  const later = fn => setTimeout(fn, 0)
  const request = run => { const r = { onsuccess: null, onerror: null, result: undefined }; later(() => { r.result = run(); r.onsuccess?.() }); return r }
  const db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const t = { oncomplete: null, onerror: null, onabort: null, pending: 0 }
      const settle = () => { if (--t.pending === 0) later(() => t.oncomplete?.()) }
      const track = run => { t.pending++; return request(() => { const v = run(); later(settle); return v }) }
      t.objectStore = () => ({
        put: v => track(() => { rows.set(v.id, structuredClone(v)) }),
        delete: k => track(() => { rows.delete(k) }),
        getAll: () => track(() => [...rows.values()]),
      })
      return t
    },
  }
  return { rows, open() { const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: db }; later(() => r.onsuccess?.()); return r } }
}

const profile = (n = 2) => ({ workouts: Array.from({ length: n }, (_, i) => ({ id: 'w' + i })), routines: [] })
let idb
beforeEach(() => { idb = fakeIdb(); globalThis.indexedDB = idb; resetSafetyStore() })
afterEach(() => { delete globalThis.indexedDB; resetSafetyStore() })

describe('the safety store', () => {
  it('saves a copy and lists it back, newest first', async () => {
    await saveCopy(makeCopy(profile(1), 'auto', 1000))
    await saveCopy(makeCopy(profile(2), 'reset', 2000))
    const list = await listCopies()
    expect(list.map(c => c.at)).toEqual([2000, 1000])
    expect(list[0].state.workouts).toHaveLength(2)
  })
  it('keeps only the newest automatic copies', async () => {
    for (let i = 1; i <= KEEP_AUTO + 2; i++) await saveCopy(makeCopy(profile(), 'auto', i * 1000))
    expect((await listCopies()).map(c => c.at)).toEqual([5000, 4000, 3000].slice(0, KEEP_AUTO))
  })
  it('a copy before a reset survives a run of automatic ones', async () => {
    await copyBefore(profile(), 'reset')
    for (let i = 1; i <= 6; i++) await saveCopy(makeCopy(profile(), 'auto', Date.now() + i * 1000))
    expect((await listCopies()).some(c => c.reason === 'reset')).toBe(true)
  })
  it('an empty profile makes no copy', async () => {
    expect(await copyBefore({}, 'reset')).toBe(false)
    expect(await listCopies()).toEqual([])
  })
  it('the daily copy is taken once a day', async () => {
    expect(await copyDaily(profile())).toBe(true)
    expect(await copyDaily(profile())).toBe(false)
    expect(await listCopies()).toHaveLength(1)
  })
  it('deletes a copy', async () => {
    await saveCopy(makeCopy(profile(), 'auto', 1000))
    await deleteCopy('1000-auto')
    expect(await listCopies()).toEqual([])
  })
  it('without IndexedDB there are no copies and nothing throws', async () => {
    delete globalThis.indexedDB; resetSafetyStore()
    expect(await listCopies()).toEqual([])
    expect(await saveCopy(makeCopy(profile(), 'auto'))).toBe(false)
  })
})

describe('asking the browser to keep storage', () => {
  const nav = v => Object.defineProperty(globalThis.navigator, 'storage', { value: v, configurable: true })
  it('asks once and says whether it was granted', async () => {
    let asked = 0
    nav({ persisted: async () => false, persist: async () => { asked++; return true } })
    expect(await keepStorage()).toBe(true)
    expect(asked).toBe(1)
  })
  it('does not ask again when already granted', async () => {
    let asked = 0
    nav({ persisted: async () => true, persist: async () => { asked++; return true } })
    expect(await keepStorage()).toBe(true)
    expect(asked).toBe(0)
  })
  it('a browser without it is fine', async () => {
    nav(undefined)
    expect(await keepStorage()).toBe(false)
  })
})
