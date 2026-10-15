import { useEffect, useState } from 'react'
import { useNutrition } from './store.js'

const DEBOUNCE_MS = 500
export const MIN_QUERY = 2

// What Open Food Facts answered, by language and query, for the session: going to My foods and
// back, or typing a query again, shows it without spending one of the hub's 30 searches a minute.
const cache = new Map()
const keyOf = (q, lang) => `${lang}|${q.toLowerCase()}`

/** Forgets the answers (tests). */
export const clearOnlineSearchCache = () => cache.clear()

// Open Food Facts results for what is typed, once typing pauses. Nothing is asked for a query
// under MIN_QUERY characters, while the search is off, or for one already answered this session.
// A newer query aborts the one in flight; an aborted search is not an error, and an answer to a
// query no longer typed never shows.
// status: 'idle' | 'loading' | 'ready' | 'error'
export function useOnlineSearch(query, { active, lang, country = null }) {
  const q = query.trim()
  const [state, setState] = useState({ status: 'idle', query: '', results: [], error: null })

  useEffect(() => {
    if (!active || q.length < MIN_QUERY) {
      setState({ status: 'idle', query: '', results: [], error: null })
      return undefined
    }
    const key = keyOf(q, lang + '|' + (country || ''))
    if (cache.has(key)) {
      setState({ status: 'ready', query: q, results: cache.get(key), error: null })
      return undefined
    }
    const ctl = new AbortController()
    setState(s => ({ ...s, status: 'loading', query: q, error: null }))
    const timer = setTimeout(async () => {
      try {
        const results = await useNutrition.getState().searchOnline(q, lang, { signal: ctl.signal, country })
        cache.set(key, results)
        if (!ctl.signal.aborted) setState({ status: 'ready', query: q, results, error: null })
      } catch (e) {
        if (e?.code !== 'aborted' && !ctl.signal.aborted) setState({ status: 'error', query: q, results: [], error: e })
      }
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [active, q, lang, country])

  return state
}
