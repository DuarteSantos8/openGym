import { useEffect, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { per100Of } from '../../lib/nutrition/foods.js'
import { settingOf } from '../../lib/nutrition/use-nt-settings.js'
import { canSearch, pausedFor, useOffBudget } from '../../lib/nutrition/off-budget.js'
import { cachedOnline, fetchOnline } from '../../lib/nutrition/use-online-search.js'
import { useNutrition } from '../../lib/nutrition/store.js'
import { rangesIn } from '../../lib/search/match.js'

const DEBOUNCE_MS = 500
export const AUTO_MIN = 3
export const AUTO_OWN_MAX = 5

/** An Open Food Facts result as a row: per 100 g, never saved until it is logged or saved. */
export function onlineRow(food, words = []) {
  const per100 = per100Of(food)
  return {
    type: 'online', id: food.barcode || food.client_key, key: 'online:' + (food.barcode || food.client_key), title: food.name,
    ranges: words.length ? rangesIn(food.name, words) : [],
    subtitle: [food.brand, t('per 100 {0}', food.nutrition_basis === 'ml' ? 'ml' : 'g')].filter(Boolean).join(' · '),
    media: { kind: 'glyph', glyph: 'apple' }, value: Math.round(Number((per100 || food).nutrition?.calories) || 0), unit: 'kcal', per100: true,
    food, score: 0, frecency: 0,
  }
}

/** When the search may ask Open Food Facts by itself (ux-search.md §5): three letters typed, opened
 *  from Home or Nutrition or scoped to your foods, and fewer than five of your foods match. */
export const autoOnline = ({ query, tab, group, ownCount }) =>
  query.trim().length >= AUTO_MIN && (tab === 'home' || tab === 'food' || group === 'foods') && ownCount < AUTO_OWN_MAX

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

/**
 * The Open Food Facts group for a settled query. status:
 *   'off'      nutrition or Open Food Facts is off: no group at all
 *   'idle'     nothing to ask yet
 *   'tap'      it would cost a search nobody asked for: a one-tap row asks (`ask()`)
 *   'loading' | 'ready' | 'error' (`retry()`) | 'paused' (`seconds` to go, then it retries once)
 *   'offline'  comes back when the connection does
 */
export function useOnlineResults({ query, words, tab, group, ownCount, nutrition, open }) {
  const settings = useNutrition(s => s.settings.data)
  const enabled = nutrition && open && settingOf(settings, 'offEnabled') !== false
  const lang = typeof settings?.offSearchLanguage === 'string' ? settings.offSearchLanguage : 'en'
  const country = settingOf(settings, 'offSearchCountry') || null
  const q = query.trim()
  const pausedUntil = useOffBudget(s => s.pausedUntil)
  const [asked, setAsked] = useState(null)        // { q, n }: a tap asked for this query
  const [state, setState] = useState({ status: 'idle', q: '', results: [], error: null })
  const [now, setNow] = useState(Date.now())
  const [isOnline, setOnline] = useState(online())

  useEffect(() => {
    const on = () => setOnline(online())
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])

  // The countdown ticks in place; at zero the paused search is asked again, once.
  useEffect(() => {
    if (!(pausedUntil > Date.now())) return undefined
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= pausedUntil) { clearInterval(id); setAsked(a => ({ q, n: (a?.n || 0) + 1, retry: true })) }
    }, 1000)
    return () => clearInterval(id)
  }, [pausedUntil, q])

  // The retry at the end of a countdown asks again for the query it held, but nobody tapped: it is
  // spent from the automatic budget, never the ten kept for taps.
  const tapped = asked && asked.q === q
  const retrying = tapped && asked.retry === true
  const auto = autoOnline({ query: q, tab, group, ownCount })

  useEffect(() => {
    if (!enabled || q.length < 2) { setState({ status: 'idle', q, results: [], error: null }); return undefined }
    const hit = cachedOnline(q, { lang, country })
    if (hit) { setState({ status: 'ready', q, results: hit, error: null }); return undefined }
    if (!isOnline) { setState({ status: 'offline', q, results: [], error: null }); return undefined }
    if (!tapped && !auto) { setState({ status: 'tap', q, results: [], error: null }); return undefined }
    const kind = tapped && !retrying ? 'tap' : 'auto'
    if (!canSearch(kind)) {
      setState({ status: Date.now() < useOffBudget.getState().pausedUntil ? 'paused' : 'tap', q, results: [], error: null })
      return undefined
    }
    const ctl = new AbortController()
    setState({ status: 'loading', q, results: [], error: null })
    const timer = setTimeout(async () => {
      try {
        const results = await fetchOnline(q, { lang, country, signal: ctl.signal, kind })
        if (!ctl.signal.aborted) setState({ status: 'ready', q, results, error: null })
      } catch (e) {
        if (e?.code === 'aborted' || ctl.signal.aborted) return
        // A 429 is the hub's pause (counted down), or the client's own budget running out while
        // this waited its turn (nothing to count down: a tap asks again).
        const spent = e?.status === 429 ? (Date.now() < useOffBudget.getState().pausedUntil ? 'paused' : 'tap') : null
        setState({ status: spent || (e?.code === 'offline' ? 'offline' : 'error'), q, results: [], error: e })
      }
    }, tapped ? 0 : DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [enabled, q, lang, country, isOnline, tapped, retrying, auto, asked?.n])

  const own = new Set()
  const rows = state.status === 'ready' && state.q === q
    ? state.results.filter(f => { const k = f.barcode || f.client_key; if (own.has(k)) return false; own.add(k); return true }).map(f => onlineRow(f, words))
    : []
  return {
    status: !enabled ? 'off' : state.q !== q && state.status !== 'idle' ? 'loading' : state.status,
    rows,
    seconds: pausedFor(now),
    ask: () => setAsked(a => ({ q, n: (a?.n || 0) + 1 })),
    retry: () => setAsked(a => ({ q, n: (a?.n || 0) + 1 })),
  }
}
