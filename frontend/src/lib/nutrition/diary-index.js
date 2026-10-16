import { create } from 'zustand'
import { NtApi, nutritionAvailable } from './api.js'
import { nutritionOf, totalsOf } from './diary.js'
import { idbIndexStore, memoryIndexStore } from './diary-index-store.js'
import { useNutrition } from './store.js'
import { useStore } from '../../store/useStore.js'

// The diary as a search index kept on the device: per day its date, kcal and the items' names, so
// "find the day I ate X" works offline and no search term ever leaves the phone. Filled from
// NutriTrace's GET /api/diary/index (api.js getDiaryIndex; contract: fitness-eval
// docs/reviews/api-diary-index.md): a first load by pages, then increments from a cursor, kept in
// IndexedDB (diary-index-store.js, memory when that is unavailable).
//
// Three things keep it true: the cursor sync (any change on any device), local patches (your own
// writes and every day the diary reads, from useNutrition, with no request), and a `rev` guard so
// an older answer never overwrites a newer one. A `total` that disagrees with the local count
// catches what a cursor cannot see (hard deletes): one rebuild per session. After an account change
// every answer still in flight is dropped (`gen`, as store.js does).

const VERSION = 1
const DEFAULT_LIMIT = 200
const MIN_LIMIT = 25
const MIN_GAP_MS = 30_000
const IDLE_FALLBACK_MS = 1500
const LOCK = 'gains-diary-index'
const DATE = /^\d{4}-\d{2}-\d{2}$/
// Set before the saved copy is wiped and cleared once it is: still there at the next open means
// the last wipe never finished, and nothing is read from the store until it has.
const OWED_KEY = 'gains_diary_index_wipe_owed'

/** status: 'idle' | 'loading' | 'ready' | 'error'. `complete`: every day has landed. `stale`: the
 *  last sync failed and the cache is served as it was. `offline`: it failed for lack of a
 *  connection. `version` changes whenever the days do. */
const initialState = () => ({ status: 'idle', complete: false, stale: false, offline: false, error: null, version: 0 })
export const useDiaryIndex = create(() => initialState())

const defaults = () => ({ api: NtApi, openBackend: () => idbIndexStore(), now: () => Date.now(), idle: null })
let env = defaults()

let gen = 0
let version = 0
let days = new Map()
let meta = null
let backend = null
let store = null
let loadedGen = -1
let inflight = null
let ctl = null
let lastAttemptAt = 0
let totalRebuilt = false
let cursorRebuilt = false
let listCache = { v: -1, list: [] }

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ownerNow = () => String(useStore.getState().user?.id ?? '')
const publish = patch => useDiaryIndex.setState(patch)
const bump = () => {
  version += 1
  publish({ version })
}

/* ------------------------------------------------------------------ rev ---------------------- */

/** 'YYYY-MM-DD HH:MM:SS' (UTC, as NutriTrace stores it) or an ISO instant → 'YYYY-MM-DDTHH:MM:SSZ'.
 *  Anything else is ''. A rev is only ever compared as text. */
export function normalizeRev(v) {
  if (typeof v !== 'string') return ''
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v.trim())
  if (!m) return ''
  const zone = m[3] && m[3] !== 'Z' ? m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : 'Z'
  const at = Date.parse(`${m[1]}T${m[2]}${zone}`)
  return Number.isNaN(at) ? '' : new Date(at).toISOString().slice(0, 19) + 'Z'
}

/* ------------------------------------------------------------------ entries ------------------ */

function cleanItem(i) {
  if (!isObj(i) || typeof i.uuid !== 'string' || typeof i.name !== 'string') return null
  const out = { uuid: i.uuid, name: i.name }
  if (typeof i.brand === 'string' && i.brand) out.brand = i.brand
  out.food_id = typeof i.food_id === 'number' && Number.isFinite(i.food_id) ? i.food_id : null
  out.meal = Number(i.meal) || 0
  out.kcal = Number.isFinite(i.kcal) ? i.kcal : 0
  const parts = Array.isArray(i.parts) ? i.parts.filter(p => typeof p === 'string') : []
  if (parts.length) out.parts = parts
  return out
}

// `truncated`: the server sent only the items that fit its page (a day over 2 MiB on its own,
// api-contract.md); the day is kept and searched over those, marked partial, until a read of the
// whole day (patchDiaryDay) replaces it.
function cleanDay(d) {
  if (!isObj(d) || typeof d.date !== 'string' || !DATE.test(d.date)) return null
  const day = {
    date: d.date,
    rev: normalizeRev(d.rev),
    kcal: Number.isFinite(d.kcal) ? d.kcal : 0,
    items: (Array.isArray(d.items) ? d.items : []).map(cleanItem).filter(Boolean),
  }
  if (d.truncated === true) day.truncated = true
  return day
}

// Whether a page's copy of a day may replace the one held: a newer change, or the same one with
// no fewer items (a trimmed copy never replaces the whole day read at the same rev).
const replaces = (incoming, local) => !local || incoming.rev > local.rev || (incoming.rev === local.rev && !(incoming.truncated && !local.truncated))

// The food an item points at, as the server writes `food_id`: not a recipe (its id is a meal's),
// null when the item has no saved food.
function foodIdOf(item) {
  if (item.is_recipe) return null
  const id = item.food_server_id === null ? null : (item.food_server_id ?? item.id)
  return typeof id === 'number' ? id : null
}

const isText = v => typeof v === 'string' && v.trim() !== ''

// The names of what a split recipe was exploded into, nested splits included, as the server
// reads them (server/lib/diary-index.js partNames): six levels at most.
const PARTS_MAX_DEPTH = 6
function partNames(children, depth = 1) {
  const names = []
  if (depth > PARTS_MAX_DEPTH || !Array.isArray(children)) return names
  for (const child of children) {
    if (!isObj(child)) continue
    if (isText(child.name)) names.push(child.name)
    if (Array.isArray(child._splitItems)) names.push(...partNames(child._splitItems, depth + 1))
  }
  return names
}

function indexItem(item) {
  return cleanItem({
    uuid: item.uuid,
    name: item.name,
    brand: isText(item.brand) ? item.brand : undefined,
    food_id: foodIdOf(item),
    meal: item.meal,
    kcal: Math.round(nutritionOf(item).calories || 0),
    parts: partNames(item._splitItems),
  })
}

const sameDay = (a, b) => a.rev === b.rev && JSON.stringify(a) === JSON.stringify(b)

/* ------------------------------------------------------------------ storage ------------------ */

const owedStorage = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const isOwed = () => { try { return owedStorage()?.getItem(OWED_KEY) === '1' } catch { return false } }
const setOwed = on => {
  try { if (on) owedStorage()?.setItem(OWED_KEY, '1'); else owedStorage()?.removeItem(OWED_KEY) } catch { /* no storage: the owner check on load is the guard */ }
}

// Empties the saved copy. A wipe that fails is tried again as deleting the whole database; false
// when neither worked, the wipe still owed.
async function settleOwed(s) {
  try {
    await s.wipe()
  } catch {
    try {
      await s.destroy()
      if (!(await s.open())) return false
    } catch {
      return false
    }
  }
  setOwed(false)
  return true
}

// The memory store this session fell back to: emptying it says nothing about the saved copy, so
// it never settles what is owed.
let fallback = null

async function wipeStore(s) {
  if (s === fallback) {
    await s.wipe()
    return true
  }
  setOwed(true)
  return settleOwed(s)
}

function backendOf() {
  backend ??= (async () => {
    const s = env.openBackend()
    let ok = false
    try { ok = await s.open() } catch { ok = false }
    // The last session could not finish a wipe: it comes before anything is read, and a store
    // that still cannot be emptied is not used (this session runs on memory).
    if (ok && isOwed()) ok = await settleOwed(s)
    if (ok) return s
    const m = memoryIndexStore()
    await m.open()
    fallback = m
    return m
  })()
  return backend
}

// IndexedDB failed after it opened (a quota error, a corrupt database): the rest of the session
// runs on memory, and the next visit tries IndexedDB again.
async function fallBackToMemory() {
  const m = memoryIndexStore()
  await m.open()
  fallback = m
  store = m
  backend = Promise.resolve(m)
  return m
}

function validMeta(m) {
  if (!isObj(m) || typeof m.owner !== 'string' || typeof m.v !== 'number') return null
  return {
    v: m.v,
    owner: m.owner,
    cursor: typeof m.cursor === 'string' && m.cursor ? m.cursor : null,
    total: Number.isFinite(m.total) ? m.total : 0,
    complete: m.complete === true,
    syncedAt: Number.isFinite(m.syncedAt) ? m.syncedAt : 0,
  }
}

// Reads what the last visit (or another tab) saved. Days patched here since, newer than what is
// saved, stay. What was saved is shown only when the meta that vouches for it is `owner`'s, at
// this schema version: days with no meta, an invalid one, another account's or an older version's
// are never put in front of the person, and the saved copy is reported as `discarded`, for the
// caller to wipe.
async function ensureLoaded(g, refresh, owner) {
  if (loadedGen === g && !refresh) return false
  store = await backendOf()
  let snap
  try {
    snap = await store.load()
  } catch {
    await fallBackToMemory()
    snap = { meta: null, days: [] }
  }
  if (g !== gen) return false
  const saved = validMeta(snap.meta)
  const mine = !!saved && saved.owner === owner && saved.v === VERSION
  const stored = new Map()
  if (mine) {
    for (const d of snap.days) {
      const day = cleanDay(d)
      if (day) stored.set(day.date, day)
    }
  }
  for (const [date, local] of days) {
    if (local.rev > (stored.get(date)?.rev ?? '')) stored.set(date, local)
  }
  days = stored
  meta = mine ? saved : null
  loadedGen = g
  bump()
  publish({ complete: !!meta?.complete, ...(meta?.complete && useDiaryIndex.getState().status === 'idle' ? { status: 'ready' } : {}) })
  return !mine && (!!snap.meta || snap.days.length > 0)
}

// Empties the memory copy and the saved one. A saved copy that cannot be emptied is owed (see
// OWED_KEY) and the rest of the session runs on memory.
async function wipeAll(g) {
  days = new Map()
  meta = null
  bump()
  publish({ complete: false })
  if (!(await wipeStore(store))) await fallBackToMemory()
  return g === gen
}

// A patch of one day, saved without waiting for it. Nothing is saved before the first load has
// read the store (the next sync brings the day back from the server).
function persist(put) {
  if (!store || !meta || loadedGen !== gen) return
  store.apply({ put, remove: [] }).catch(() => {})
}

/* ------------------------------------------------------------------ sync --------------------- */

function fail(e) {
  const code = e?.code
  const kept = !!meta?.complete
  if (code === 'aborted') {
    publish({ status: kept ? 'ready' : 'idle' })
    return
  }
  const network = code === 'offline' || code === 'timeout'
  publish({ status: network && kept ? 'ready' : 'error', stale: true, offline: code === 'offline', error: e })
}

const badResponse = () => Object.assign(new Error('bad response'), { status: 200, code: 'bad-response' })

// One page, or null once the failure is shown. A 502 (the answer was too big for the hub) is asked
// again with half the days; a 400 or 403 on a cursor drops it and starts over, once.
async function fetchPage(g, signal, run) {
  let halved = false
  for (;;) {
    try {
      return await env.api.getDiaryIndex({ since: meta?.cursor || undefined, limit: run.limit, signal })
    } catch (e) {
      if (g !== gen) return null
      if (e?.status === 502 && !halved && run.limit > MIN_LIMIT) {
        halved = true
        run.limit = Math.max(MIN_LIMIT, Math.floor(run.limit / 2))
        continue
      }
      if ((e?.status === 400 || e?.status === 403) && meta?.cursor && !cursorRebuilt) {
        cursorRebuilt = true
        if (!(await wipeAll(g))) return null
        publish({ status: 'loading' })
        continue
      }
      fail(e)
      return null
    }
  }
}

async function work(g, refresh) {
  const signal = ctl.signal
  const owner = ownerNow()
  const discarded = await ensureLoaded(g, refresh, owner)
  if (g !== gen) return
  if (discarded && !(await wipeAll(g))) return
  publish(meta?.complete ? (useDiaryIndex.getState().status === 'idle' ? { status: 'ready' } : {}) : { status: 'loading' })

  const run = { limit: DEFAULT_LIMIT }
  for (;;) {
    const page = await fetchPage(g, signal, run)
    if (!page || g !== gen) return
    if (!isObj(page) || !Array.isArray(page.days) || typeof page.next !== 'string') return fail(badResponse())

    const put = []
    const remove = []
    for (const raw of page.days) {
      if (!isObj(raw) || typeof raw.date !== 'string') continue
      if (raw.deleted === true) {
        if (days.has(raw.date)) remove.push(raw.date)
        continue
      }
      const day = cleanDay(raw)
      if (day && replaces(day, days.get(day.date))) put.push(day)
    }
    const more = page.has_more === true
    const next = {
      v: VERSION,
      owner,
      cursor: page.next,
      total: Number.isFinite(page.total) ? page.total : 0,
      complete: !!meta?.complete || !more,
      syncedAt: env.now(),
    }

    try {
      await store.apply({ put, remove, meta: next })
    } catch {
      await fallBackToMemory()
      if (g !== gen) return
      await store.apply({ put, remove, meta: next }).catch(() => {})
    }
    if (g !== gen) return
    // A day patched while the page was being written may be newer than the page's copy.
    for (const day of put) {
      if (replaces(day, days.get(day.date))) days.set(day.date, day)
    }
    for (const date of remove) days.delete(date)
    meta = next
    bump()
    publish({ complete: next.complete })

    if (more) continue
    if (Number.isFinite(page.total) && page.total !== days.size && !totalRebuilt) {
      totalRebuilt = true
      if (!(await wipeAll(g))) return
      publish({ status: 'loading' })
      continue
    }
    cursorRebuilt = false
    publish({ status: 'ready', stale: false, offline: false, error: null, complete: true })
    return
  }
}

/** Catches the index up with the server: the first load by pages, or the changes since the last
 *  sync. Skipped when it ran less than 30 s ago unless `force`; one at a time (across tabs too
 *  where Web Locks exist). Never rejects: a failure is shown in useDiaryIndex. */
export function syncDiaryIndex({ force = false } = {}) {
  if (!nutritionAvailable(useStore.getState().user)) return Promise.resolve()
  if (inflight && inflight.gen === gen) return inflight.promise
  if (!force && lastAttemptAt && env.now() - lastAttemptAt < MIN_GAP_MS) return Promise.resolve()
  lastAttemptAt = env.now()
  const g = gen
  ctl = new AbortController()
  const locks = globalThis.navigator?.locks
  const task = async () => {
    try {
      await (locks?.request ? locks.request(LOCK, () => work(g, true)) : work(g, false))
    } catch (e) {
      if (g === gen) fail(e)
    } finally {
      if (inflight?.promise === promise) inflight = null
    }
  }
  const promise = task()
  inflight = { gen: g, promise }
  return promise
}

/* ------------------------------------------------------------------ reading ------------------ */

/** The live days, newest date first. The same array until the days change. */
export function diaryIndexDays() {
  if (listCache.v !== version) {
    listCache = { v: version, list: [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) }
  }
  return listCache.list
}

/** Puts a day the app just read or wrote into the index, with no request. `entry` is a DiaryDay
 *  answer (GET or PUT /api/diary/:date). It is dropped when the index already holds a newer
 *  change of that day; an answer without `updated_at` never replaces one with it. */
export function patchDiaryDay(date, entry) {
  if (typeof date !== 'string' || !DATE.test(date) || !isObj(entry)) return
  const raw = Array.isArray(entry.items) ? entry.items.filter(isObj) : []
  const rev = normalizeRev(entry.updated_at)
  const local = days.get(date)
  if (local && rev < local.rev) return
  // A day nothing was ever logged to is not in the index (the server counts none either).
  if (!local && !rev && raw.length === 0) return
  const day = { date, rev, kcal: Math.round(totalsOf(raw).calories), items: raw.map(indexItem).filter(Boolean) }
  if (local && sameDay(local, day)) return
  days.set(date, day)
  bump()
  persist([day])
}

/** Sign-out or another account: the saved index and the one in memory are gone, and answers still
 *  on their way are dropped. Resolves once the saved copy is wiped. */
export function resetDiaryIndex() {
  gen += 1
  ctl?.abort()
  ctl = null
  inflight = null
  days = new Map()
  meta = null
  loadedGen = -1
  lastAttemptAt = 0
  totalRebuilt = false
  cursorRebuilt = false
  started = false
  version += 1
  publish({ ...initialState(), version })
  const wipe = async () => {
    const s = store || await backendOf()
    if (!(await wipeStore(s))) await fallBackToMemory()
  }
  return wipe().catch(() => {})
}

/* ------------------------------------------------------------------ triggers ----------------- */

let started = false
let removeTriggers = null

const trigger = options => {
  if (nutritionAvailable(useStore.getState().user)) syncDiaryIndex(options)
}

/** Once, when nutrition is available for the signed-in person: the first sync in idle time, then
 *  a sync when the tab shows again and when the connection returns (each at most every 30 s,
 *  except the connection coming back, which is worth one request). Safe to call on every render
 *  of the shell. */
export function startDiaryIndex() {
  if (started || !nutritionAvailable(useStore.getState().user)) return
  started = true
  const idle = env.idle || (cb => (typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 5000 }) : setTimeout(cb, IDLE_FALLBACK_MS)))
  idle(() => trigger())
  if (removeTriggers || typeof document === 'undefined' || typeof window === 'undefined') return
  const onVisible = () => { if (document.visibilityState === 'visible') trigger() }
  const onOnline = () => trigger({ force: true })
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  removeTriggers = () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}

/* ------------------------------------------------------------------ wiring ------------------- */

// Every day the diary store holds as read (own writes, read-repair) is patched into the index.
// (Tests that replace the stores with bare hooks have no subscribe.)
if (typeof useNutrition.subscribe === 'function') {
  useNutrition.subscribe((s, prev) => {
    if (s.days === prev.days) return
    for (const [date, d] of Object.entries(s.days)) {
      if (d !== prev.days[date] && d?.status === 'ready' && d.entry) patchDiaryDay(date, d.entry)
    }
  })
}

// A different account on this device, or signing out, never leaves the last one's days behind.
// Signing in from nothing is not a change: the saved index is that account's, kept by `owner`.
if (typeof useStore.subscribe === 'function') {
  useStore.subscribe((s, prev) => {
    const was = String(prev.user?.id ?? '')
    if (was && was !== String(s.user?.id ?? '')) resetDiaryIndex()
  })
}

/* ------------------------------------------------------------------ tests -------------------- */

export const __test = {
  VERSION,
  DEFAULT_LIMIT,
  MIN_GAP_MS,
  OWED_KEY,
  /** Replaces what the module talks to: { api, openBackend, now, idle }. */
  configure: options => { env = { ...env, ...options } },
  /** Back to a module nobody has used. */
  restore: () => {
    gen += 1
    ctl?.abort()
    removeTriggers?.()
    removeTriggers = null
    started = false
    env = defaults()
    days = new Map()
    meta = null
    backend = null
    store = null
    fallback = null
    loadedGen = -1
    inflight = null
    ctl = null
    lastAttemptAt = 0
    totalRebuilt = false
    cursorRebuilt = false
    version += 1
    publish({ ...initialState(), version })
  },
  meta: () => (meta ? { ...meta } : null),
  count: () => days.size,
}
