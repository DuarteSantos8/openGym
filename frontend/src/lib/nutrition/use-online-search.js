import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useNutrition } from './store.js'
import { canSearch, noteAnswer, noteSearch, useOffBudget, waitFor } from './off-budget.js'

const DEBOUNCE_MS = 500
export const MIN_QUERY = 2
export const CACHE_MAX = 40

// What Open Food Facts answered, by language and query, for the session: going to My foods and
// back, or typing a query again, shows it without spending one of the hub's 30 searches a minute.
// One cache for the food pickers and the global search, the 40 most recently used answers
// (oldest first in the Map), and the searches in flight by the same key so that two places asking
// for the same query send one request.
const cache = new Map()
const inflight = new Map()
const keyOf = (q, lang, country) => `${lang}|${country || ''}|${q.trim().toLowerCase()}`
// Bumped by a reset: an answer that was on its way across one is not kept.
let epoch = 0

const remember = (key, results) => {
  cache.delete(key)
  cache.set(key, results)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}

/** Forgets the answers and abandons the searches in flight: sign-out, another profile, tests. */
export function resetOnlineSearch() {
  epoch += 1
  cache.clear()
  inflight.forEach(entry => entry.ctl.abort())
  inflight.clear()
}

// Signing out, or another account signing in: the last person's searches are not the next one's.
if (typeof useStore.subscribe === 'function') {
  useStore.subscribe((s, prev) => {
    if (String(prev.user?.id ?? '') !== String(s.user?.id ?? '')) resetOnlineSearch()
  })
}

/** The answer this session already has for the query, or undefined. */
export function cachedOnline(q, { lang = 'en', country = null } = {}) {
  const key = keyOf(q, lang, country)
  const hit = cache.get(key)
  if (hit) remember(key, hit)
  return hit
}

const aborted = () => Object.assign(new Error('aborted'), { status: 0, code: 'aborted' })
const budgetSpent = () => Object.assign(new Error('Open Food Facts budget spent'), { status: 429, code: 'http' })

function start(key, q, { lang, country, kind }) {
  const ctl = new AbortController()
  const was = epoch
  noteSearch(kind)
  const entry = { key, ctl, watchers: 0, promise: null }
  entry.promise = useNutrition.getState().searchOnline(q.trim(), lang, { signal: ctl.signal, country, onResponse: res => noteAnswer(res) })
    .then(results => {
      if (was === epoch) remember(key, results)
      return results
    })
    .finally(() => { if (inflight.get(key) === entry) inflight.delete(key) })
  inflight.set(key, entry)
  return entry
}

// One caller's wait on a shared search: its own `signal` ends its wait with 'aborted', and the
// search itself only when nobody is waiting on it any more. An abandoned search is dropped from
// the ones in flight at once: its promise only rejects, so a caller asking for the same query
// next must start a search of its own, not join that one.
function watch(entry, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return }
    entry.watchers += 1
    const leave = () => {
      entry.watchers -= 1
      if (entry.watchers === 0) {
        entry.ctl.abort()
        if (inflight.get(entry.key) === entry) inflight.delete(entry.key)
      }
      reject(aborted())
    }
    signal?.addEventListener('abort', leave, { once: true })
    entry.promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', leave))
  })
}

/** One Open Food Facts search, counted against the budget (off-budget.js) and kept in the cache;
 *  the same query already on its way is joined, not sent again. `kind` is 'auto' for a search
 *  nobody asked for by name (typing), 'tap' for one they did.
 *  Throws an NtError: 'aborted' once `signal` aborts, and a 429 when the budget is spent, so that
 *  every caller, the pickers and the global search alike, stays inside it. */
export async function fetchOnline(q, { lang = 'en', country = null, signal, kind = 'auto' } = {}) {
  const key = keyOf(q, lang, country)
  const hit = cachedOnline(q, { lang, country })
  if (hit) return hit
  let entry = inflight.get(key)
  if (!entry) {
    if (!canSearch(kind)) throw budgetSpent()
    entry = start(key, q, { lang, country, kind })
  }
  return watch(entry, signal)
}

// Open Food Facts results for what is typed, once typing pauses. Nothing is asked for a query
// under MIN_QUERY characters, while the search is off, or for one already answered this session.
// A newer query aborts the one in flight; an aborted search is not an error, and an answer to a
// query no longer typed never shows. While the budget is spent (the hub paused every search with a
// 429, off-budget.js, whoever ran into it, or the client's own count has no room) nothing is
// asked: the status is 'paused' with the `seconds` left, and the query is asked once the wait is
// over. After a 429 typing never asks again by itself, as the budget keeps its last ten for the
// searches a person asks for: the status is then 'tap', and `ask()` is that search, from an
// explicit action (the picker's search key); it is spent from the ten kept for it.
// While the device is offline (and the answer is not cached) the status is 'offline', and the
// search is asked when the connection returns. A search that fails on the wire is an 'error':
// `ask()` runs it again.
// status: 'idle' | 'loading' | 'ready' | 'error' | 'paused' | 'tap' | 'offline'
const isConnected = () => typeof navigator === 'undefined' || navigator.onLine !== false

export function useOnlineSearch(query, { active, lang, country = null }) {
  const q = query.trim()
  const [state, setState] = useState({ status: 'idle', query: '', results: [], error: null })
  const [asked, setAsked] = useState(null)        // { q, n }: an explicit search for this query
  const pausedUntil = useOffBudget(s => s.pausedUntil)
  // Until when the client's own count has no room, as the last search found it.
  const [spentUntil, setSpentUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const until = Math.max(pausedUntil, spentUntil)
  const paused = until > now
  const tapped = asked?.q === q
  const [connected, setConnected] = useState(isConnected)

  useEffect(() => {
    const sync = () => setConnected(isConnected())
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync) }
  }, [])

  // The countdown ticks while a wait lasts, and its end asks again.
  useEffect(() => {
    setNow(Date.now())
    const left = until - Date.now()
    if (left <= 0) return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const end = setTimeout(() => { clearInterval(tick); setNow(Date.now()) }, left)
    return () => { clearInterval(tick); clearTimeout(end) }
  }, [until])

  useEffect(() => {
    if (!active || q.length < MIN_QUERY) {
      setState({ status: 'idle', query: '', results: [], error: null })
      return undefined
    }
    const hit = cachedOnline(q, { lang, country })
    if (hit) {
      setState({ status: 'ready', query: q, results: hit, error: null })
      return undefined
    }
    if (!connected) {
      setState({ status: 'offline', query: q, results: [], error: null })
      return undefined
    }
    const kind = tapped ? 'tap' : 'auto'
    const held = spentFor(kind)
    if (held) {
      setSpentUntil(held.until)
      setState({ status: held.status, query: q, results: [], error: null })
      return undefined
    }
    const ctl = new AbortController()
    setState(s => ({ ...s, status: 'loading', query: q, error: null }))
    const timer = setTimeout(async () => {
      try {
        const results = await fetchOnline(q, { lang, country, signal: ctl.signal, kind })
        if (!ctl.signal.aborted) setState({ status: 'ready', query: q, results, error: null })
      } catch (e) {
        if (e?.code === 'aborted' || ctl.signal.aborted) return
        // The budget ran out while this waited its turn: the same wait as before the search.
        const held = e?.status === 429 ? spentFor(kind) : null
        if (held) setSpentUntil(held.until)
        setState({ status: held ? held.status : 'error', query: q, results: [], error: held ? null : e })
      }
    }, tapped ? 0 : DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [active, q, lang, country, paused, connected, tapped, asked?.n])

  return { ...state, seconds: Math.max(0, Math.ceil((until - now) / 1000)), ask: () => setAsked(a => ({ q, n: (a?.n || 0) + 1 })) }
}

// Why a search of this kind cannot go now, or null when it can: 'paused' with when it comes back,
// or 'tap' when only a search the person asks for can say. The hub's pause is counted down first,
// whatever follows it.
function spentFor(kind) {
  const at = Date.now()
  const pausedUntil = useOffBudget.getState().pausedUntil
  if (at < pausedUntil) return { status: 'paused', until: pausedUntil }
  const wait = waitFor(kind, at)
  if (wait <= 0) return null
  return wait === Infinity ? { status: 'tap', until: 0 } : { status: 'paused', until: at + wait }
}
