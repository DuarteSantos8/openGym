import { useEffect, useMemo } from 'react'
import { ownFoodWith } from './barcode.js'
import { matchesFood, recentFoods } from './diary.js'
import { useNutrition } from './store.js'
import { settingOf } from './use-nt-settings.js'
import { MIN_QUERY, useOnlineSearch } from './use-online-search.js'

export const OWN_SHOWN = 50

const mostUsed = (a, b) => (b.usage_count || 0) - (a.usage_count || 0) || String(a.name).localeCompare(String(b.name))

// Your saved copy of an online result: the same barcode, or the key the result was saved under.
// Never the name, which the person may have edited.
const savedCopy = (foods, result) =>
  (result.barcode ? ownFoodWith(foods, result.barcode) : undefined) ?? (result.client_key ? foods.find(f => f.client_key === result.client_key) : undefined)

/**
 * What the food pickers show for what is typed: the one search every place that picks a food uses.
 *   recents  your foods by last use (no query only)
 *   own      your foods, `limit` of them: matching the query (and any saved copy of an online
 *            result, however renamed), or (no query) the rest of them, most used first;
 *            `ownTotal` is how many there are before the limit
 *   online   Open Food Facts, Romanian products first (off.js): { status, results, error }, where
 *            status is 'idle' (nothing asked: the query is under two characters) | 'loading' |
 *            'ready' | 'error'. A product you already saved is left out (it is in `own`).
 *   foods    the store's foods ({ status, list, error }), for the loading and error notes
 * Loads your foods once. Results come back as the unsaved foods they are: save one before using
 * it anywhere that needs an id (its `client_key` makes a retried save one food, not two).
 */
export function useFoodSearch(query, { limit = OWN_SHOWN } = {}) {
  const foods = useNutrition(s => s.foods)
  const settings = useNutrition(s => s.settings.data)
  const lang = settings?.offSearchLanguage
  const q = query.trim()
  // Profile › Food sources: no online results while Open Food Facts is off; its language and
  // country steer the search and the order.
  const online = useOnlineSearch(query, {
    active: settingOf(settings, 'offEnabled'),
    lang: typeof lang === 'string' ? lang : 'en',
    country: settingOf(settings, 'offSearchCountry'),
  })

  useEffect(() => { useNutrition.getState().loadFoods() }, [])

  const recents = useMemo(() => (q ? [] : recentFoods(foods.list)), [foods.list, q])

  // The render after typing still holds the answer to the previous query: not an answer yet.
  const status = q.length < MIN_QUERY ? 'idle' : online.query !== q ? 'loading' : online.status
  const { results, saved } = useMemo(() => {
    const out = { results: [], saved: [] }
    if (status !== 'ready') return out
    for (const r of online.results) {
      const copy = savedCopy(foods.list, r)
      if (copy) out.saved.push(copy)
      else out.results.push(r)
    }
    return out
  }, [status, online.results, foods.list])

  const allOwn = useMemo(() => {
    if (q) {
      const named = foods.list.filter(f => matchesFood(f, q))
      return [...named, ...saved.filter(f => !named.includes(f))]
    }
    const recent = new Set(recents.map(f => f.id))
    return foods.list.filter(f => !recent.has(f.id)).sort(mostUsed)
  }, [foods.list, recents, saved, q])

  return { query: q, recents, own: allOwn.slice(0, limit), ownTotal: allOwn.length, online: { status, results, error: online.error }, foods }
}
