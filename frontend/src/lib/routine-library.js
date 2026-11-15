// The Coach's routines library in the app (api/coach/core/routine-library.js, docs/ROUTINES_LIBRARY.md):
// the built-in starter plans plus the community index at a configurable address (the instance's
// `coach.routinesUrl`, else opengym.ch), fetched by the app, cached for a day, and simply absent
// when it cannot be read. A question to the Coach carries the few entries that match it.
import { builtinIndex, normalizeIndex, searchRoutines, compactEntry, entryToBundle, DEFAULT_INDEX_URL } from '../../../api/coach/core/routine-library.js'
import { validatePlan } from '../../../api/coach/core/validate.js'
import { nativeFetch } from './capacitor-fetch.js'
import { useStore } from '../store/useStore.js'

const CACHE = 'og_routines_index_v1'
const TTL_MS = 24 * 3600000
let memo = null

/** The index address in force: the server's, '' or 'off' for none, else the default. */
export function indexUrl(config = useStore.getState().config) {
  const set = config?.coach?.routinesUrl
  if (set === 'off' || set === '') return null
  return typeof set === 'string' && /^https:\/\//.test(set) ? set : DEFAULT_INDEX_URL
}

const store = () => { try { return globalThis.localStorage || null } catch { return null } }

/** The community entries (normalised), [] when there is no index or it cannot be read. */
export async function communityEntries({ url = indexUrl(), fetchImpl = nativeFetch, now = Date.now() } = {}) {
  if (!url) return []
  if (memo && memo.url === url && now - memo.at < TTL_MS) return memo.entries
  try {
    const c = JSON.parse(store()?.getItem(CACHE) || 'null')
    if (c && c.url === url && now - c.at < TTL_MS && Array.isArray(c.raw?.routines)) {
      memo = { url, at: c.at, entries: normalizeIndex(c.raw).entries }
      return memo.entries
    }
  } catch { /* no cache */ }
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(String(res.status))
    const raw = JSON.parse(await res.text())
    const { entries } = normalizeIndex(raw)
    memo = { url, at: now, entries }
    try { store()?.setItem(CACHE, JSON.stringify({ url, at: now, raw })) } catch { /* full */ }
    return entries
  } catch {
    // No index there (yet), offline, or not one: the built-in plans are the library then. Asked
    // again in an hour rather than on every question.
    memo = { url, at: now - TTL_MS + 3600000, entries: [] }
    return []
  }
}

export const allEntries = async opts => [...builtinIndex(), ...(await communityEntries(opts))]

/** The entries a question goes along with, in the shape the Coach reads (compactEntry). */
export async function routineHits(S, text, opts) {
  const equipment = S?.coach?.profile?.equipment || []
  return searchRoutines(await allEntries(opts), { text, equipment, limit: 6 }).map(compactEntry)
}

/** One entry as a plan bundle the plan import screen takes, or null. */
export async function importBundle(id, opts) {
  const e = (await allEntries(opts)).find(x => x.id === id)
  if (!e) return null
  const v = validatePlan(entryToBundle(e), {})
  return v.ok ? v.bundle : null
}

export function _resetLibrary() { memo = null }
