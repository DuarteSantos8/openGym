// The food diary: what you ate per meal and the calories and macros it adds up to.
//
// Stored per item, the way a progress photo is (lib/day-photos.js), so two devices that each
// logged a snack keep both:
//
//   S.foodLog = { <id>: { d: '2026-11-09', m: 'breakfast', n: 'Puur hagelslag', b: 'Albert Heijn',
//                         c: '8710400002970', g: 20, s: 15,
//                         per: [kcal, protein, carbs, fat, fiber, sugar, salt], _ts }, … }
//
// `q` is how many portions of a recipe (no `g` then; `per` is one portion).
// `s` is one serving in grams, from the label, when it has one. Fiber, sugar and salt came later:
// an older item has four numbers and reads as 0 for the rest.
// `per` is per 100 g when `g` is set (a product), or for the whole item when it is not (a
// quick entry typed by hand). Removing an item writes `{ _ts }`, not a deleted key: a delete would
// come straight back from the other device's copy (lib/sync-merge.js mergeStampedMap).
// ponytail: cleared items stay as small tombstones forever, prune old ones if the document grows.
//
// Products come from Open Food Facts (open data, ODbL), which has good Dutch coverage: a barcode
// is one lookup, a search asks for products sold in the Netherlands first.
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const num = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0)
const r1 = v => Math.round(v * 10) / 10
// What `per` holds, in order, and the keys the totals use for them.
export const NUTRIENTS = ['kcal', 'p', 'c', 'f', 'fib', 'sug', 'salt']

/** The meal a new entry goes under by default, from the hour of the day. */
export function mealAt(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 21) return 'dinner'
  return 'snack'
}

/** A stored item read back with the junk left out, or null for a cleared or broken one. */
export function readFood(e) {
  if (!isMap(e) || typeof e.d !== 'string' || !e.n || !Array.isArray(e.per)) return null
  return {
    d: e.d, m: MEALS.includes(e.m) ? e.m : 'snack', n: String(e.n).slice(0, 120),
    b: e.b ? String(e.b).slice(0, 80) : '', c: e.c ? String(e.c) : '',
    g: num(e.g) || null, s: num(e.s) || null, q: num(e.q) || null, per: NUTRIENTS.map((_, i) => num(e.per[i])),
  }
}

/** { kcal, p, c, f, fib, sug, salt } one item adds, rounded: kcal whole, grams to a tenth. */
export function totalsOf(item) {
  const k = item.g ? item.g / 100 : (item.q || 1)
  const out = {}
  NUTRIENTS.forEach((n, i) => { const v = num(item.per[i]) * k; out[n] = n === 'kcal' ? Math.round(v) : r1(v) })
  return out
}

/** The items logged on `iso`, oldest first, each with its `id`. */
export function foodsOn(S, iso) {
  const map = isMap(S?.foodLog) ? S.foodLog : {}
  return Object.entries(map)
    .map(([id, e]) => { const x = readFood(e); return x && x.d === iso ? { id, _ts: e._ts || 0, ...x } : null })
    .filter(Boolean)
    .sort((a, b) => a._ts - b._ts)
}

/** The day's sum and the sum per meal: { kcal, p, c, f, meals: { breakfast: {…}, … } }. */
export function dayTotals(items) {
  const zero = () => Object.fromEntries(NUTRIENTS.map(n => [n, 0]))
  const out = { ...zero(), meals: Object.fromEntries(MEALS.map(m => [m, zero()])) }
  for (const it of items) {
    const t = totalsOf(it)
    for (const box of [out, out.meals[it.m]]) for (const k of NUTRIENTS) box[k] = r1(box[k] + t[k])
  }
  return out
}

/** S.foodLog with item `id` written, stamped `now`. */
export function withFood(map, id, item, now = Date.now()) {
  const x = readFood(item)
  if (!x) return isMap(map) ? map : {}
  const e = { d: x.d, m: x.m, n: x.n, per: x.per, _ts: now }
  if (x.b) e.b = x.b
  if (x.c) e.c = x.c
  if (x.g) e.g = x.g
  if (x.s) e.s = x.s
  if (x.q && !x.g) e.q = x.q
  return { ...(isMap(map) ? map : {}), [id]: e }
}

/** S.foodLog with item `id` cleared (see the top of this file). */
export const withoutFood = (map, id, now = Date.now()) => ({ ...(isMap(map) ? map : {}), [id]: { _ts: now } })

/**
 * What you logged before, newest first, one per product: the quick picks of the add sheet and
 * the first place a scanned barcode is looked for (so a product you typed in yourself is found
 * the next time you scan it). Each is a template { n, b, c, g, per } without day or meal.
 */
export function recentFoods(S, limit = 30) {
  const map = isMap(S?.foodLog) ? S.foodLog : {}
  const seen = new Set(), out = []
  const all = Object.values(map).filter(e => readFood(e)).sort((a, b) => (b._ts || 0) - (a._ts || 0))
  for (const e of all) {
    const x = readFood(e)
    const key = x.c || `${x.n}|${x.b}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ n: x.n, b: x.b, c: x.c, g: x.g, s: x.s, per: x.per })
    if (out.length >= limit) break
  }
  return out
}

/** The items of `meal` on day `from`, written again under day `to` (new ids), into `map`. */
export function copyMeal(map, from, to, meal, newId, now = Date.now()) {
  let out = isMap(map) ? map : {}
  for (const it of foodsOn({ foodLog: out }, from).filter(i => i.m === meal)) out = withFood(out, newId(), { ...it, d: to }, now)
  return out
}

/*
 * Saved meals: a set of items you eat together, added in one tap.
 *   S.foodMeals = { <id>: { n: 'Ontbijt', items: [{ n, b, c, g, s, per }, …], _ts }, … }
 * A recipe is a saved meal with `portions`: the pan of chili, made once, eaten in four. It is
 * logged as one item per portion (recipeItem). Stamped per meal like the log, a deleted one is
 * `{ _ts }`.
 */
export function savedMeals(S) {
  const map = isMap(S?.foodMeals) ? S.foodMeals : {}
  return Object.entries(map)
    .filter(([, m]) => isMap(m) && m.n && Array.isArray(m.items) && m.items.length)
    .map(([id, m]) => ({ id, n: String(m.n), portions: num(m.portions) || null, items: m.items.map(x => readFood({ ...x, d: '', m: 'snack' })).filter(Boolean) }))
    .sort((a, b) => a.n.localeCompare(b.n))
}

export function withSavedMeal(map, id, name, items, now = Date.now(), portions = null) {
  const clean = items.map(x => readFood({ d: '', m: 'snack', ...x })).filter(Boolean).map(({ n, b, c, g, s, q, per }) => ({ n, b, c, g, s, q, per }))
  const e = { n: String(name).trim().slice(0, 60), items: clean, _ts: now }
  if (num(portions) >= 1) e.portions = Math.round(num(portions))
  return { ...(isMap(map) ? map : {}), [id]: e }
}

/** A recipe as one loggable item: its name, one portion's nutrients, `q` 1. */
export function recipeItem(meal) {
  const t = savedMealTotal(meal)
  const k = meal.portions || 1
  return { n: meal.n, b: '', c: '', g: null, s: null, q: 1, per: NUTRIENTS.map(n => r1(t[n] / k)) }
}

/** A saved meal's total, to show next to its name. */
export const savedMealTotal = meal => dayTotals(meal.items.map(x => ({ ...x, m: 'snack' })))

/*
 * Water: S.foodWater = { '2026-11-09': { ml: 1500, _ts }, … }, one stamped entry per day.
 */
export const waterOn = (S, iso) => num(isMap(S?.foodWater) ? S.foodWater[iso]?.ml : 0)
export const withWater = (map, iso, ml, now = Date.now()) => ({ ...(isMap(map) ? map : {}), [iso]: { ml: Math.max(0, Math.round(ml)), _ts: now } })

/**
 * The seven days up to `iso`: [{ d, kcal, p, c, f }] oldest first, and the average over the days
 * that have anything logged (an empty day is a day you did not log, not a day you fasted).
 */
export function weekOf(S, iso, shift) {
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = shift(iso, -i)
    const t = dayTotals(foodsOn(S, d))
    days.push({ d, kcal: t.kcal, p: t.p, c: t.c, f: t.f })
  }
  const logged = days.filter(x => x.kcal > 0)
  const avg = k => (logged.length ? Math.round(logged.reduce((a, x) => a + x[k], 0) / logged.length) : 0)
  return { days, logged: logged.length, avg: { kcal: avg('kcal'), p: avg('p'), c: avg('c'), f: avg('f') } }
}

/*
 * Fasting: the one running fast, and the ones you finished.
 *   S.fast = { start: ms, hours: 16 } while one runs (a plain setting)
 *   S.foodFasts = { <id>: { start, end, hours, _ts }, … } stamped per fast
 */
export const FAST_PLANS = [12, 14, 16, 18, 20]
export function fastState(S, now = Date.now()) {
  const f = isMap(S?.fast) ? S.fast : null
  if (!f || !(f.start > 0)) return null
  const hours = num(f.hours) || 16
  const done = now - f.start
  const goal = hours * 3600000
  return { start: f.start, hours, done, left: Math.max(0, goal - done), reached: done >= goal, endsAt: f.start + goal }
}
export function pastFasts(S, limit = 10) {
  const map = isMap(S?.foodFasts) ? S.foodFasts : {}
  return Object.entries(map).filter(([, x]) => isMap(x) && x.start > 0 && x.end > x.start)
    .map(([id, x]) => ({ id, start: x.start, end: x.end, hours: num(x.hours), reached: x.end - x.start >= num(x.hours) * 3600000 }))
    .sort((a, b) => b.start - a.start).slice(0, limit)
}

/*
 * Reminders to log, in the app (a nudge on Home and the diary, not a notification): a main meal
 * whose time has passed with nothing logged under it today. Breakfast after 10:00, lunch after
 * 14:00, dinner after 20:00. Snacks are never owed.
 */
export const MEAL_DUE = { breakfast: 10, lunch: 14, dinner: 20 }
export function mealsOwed(S, iso, hour) {
  const logged = new Set(foodsOn(S, iso).map(i => i.m))
  return Object.keys(MEAL_DUE).filter(m => hour >= MEAL_DUE[m] && !logged.has(m))
}

/** Every logged item as a spreadsheet, one row per item, oldest day first. */
export function foodCSV(S) {
  const cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const map = isMap(S?.foodLog) ? S.foodLog : {}
  const rows = Object.values(map).map(readFood).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : MEALS.indexOf(a.m) - MEALS.indexOf(b.m)))
  const head = ['Date', 'Meal', 'Food', 'Brand', 'Barcode', 'Grams', 'kcal', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Sugar (g)', 'Salt (g)']
  const lines = rows.map(x => { const t = totalsOf(x); return [x.d, x.m, x.n, x.b, x.c, x.g ?? '', ...NUTRIENTS.map(n => t[n])].map(cell).join(',') })
  return [head.join(','), ...lines].join('\n') + '\n'
}

/* ------------------------------------------------------------ Open Food Facts -- */

const FIELDS = 'code,product_name,product_name_nl,product_name_en,brands,nutriments,serving_quantity'

/** An Open Food Facts product → a template { n, b, c, g, per }, or null without a name or energy. */
export function fromOff(p) {
  if (!isMap(p)) return null
  const n = String(p.product_name_nl || p.product_name || p.product_name_en || '').trim()
  const nu = isMap(p.nutriments) ? p.nutriments : {}
  // Many Dutch labels only give kJ; 4.184 kJ is one kcal.
  const kcal = nu['energy-kcal_100g'] ?? (nu['energy-kj_100g'] ?? nu.energy_100g) / 4.184
  if (!n || !Number.isFinite(+kcal)) return null
  const brands = Array.isArray(p.brands) ? p.brands : String(p.brands || '').split(',')
  return {
    n, b: String(brands[0] || '').trim(), c: String(p.code || ''),
    g: num(p.serving_quantity) || 100, s: num(p.serving_quantity) || null,
    per: [Math.round(+kcal), ...['proteins', 'carbohydrates', 'fat', 'fiber', 'sugars', 'salt'].map(k => r1(num(nu[k + '_100g'])))],
  }
}

// Each lookup goes to this server's /api/food/* first (contrib/cloudflare/food-proxy.js: an edge
// cache, retries, a second search backend), then straight to Open Food Facts when the server
// has no such route (a plain Docker install) or cannot be reached. Every call has a timeout, so a
// slow upstream ends in a message instead of a spinner that never stops.
const timed = (fetchFn, url, ms) => fetchFn(url, typeof AbortSignal?.timeout === 'function' ? { signal: AbortSignal.timeout(ms) } : undefined)

async function viaServer(path, fetchFn) {
  try {
    const res = await timed(fetchFn, path, 15000)
    const type = res.headers?.get?.('content-type') || ''
    // The single-page fallback answers an unknown route with index.html: not ours.
    if (!type.includes('json')) return undefined
    if (res.status === 404) return null
    return res.ok ? await res.json() : undefined
  } catch { return undefined }
}

/** The product behind a barcode, or null when Open Food Facts does not know it. Throws offline. */
export async function lookupBarcode(code, fetchFn = fetch) {
  const clean = String(code || '').replace(/\D/g, '')
  if (!clean) return null
  const mine = await viaServer(`/api/food/product/${clean}`, fetchFn)
  if (mine !== undefined) return mine?.product ? fromOff({ ...mine.product, code: clean }) : null
  const res = await timed(fetchFn, `https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${FIELDS}`, 10000)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('lookup failed')
  const body = await res.json()
  return body.status === 1 ? fromOff({ ...body.product, code: clean }) : null
}

// Searches already answered this session, so typing back to an earlier word costs nothing.
const searched = new Map()

/** Products matching `q`, those sold in the Netherlands first (all countries when none are). */
export async function searchFoods(q, fetchFn = fetch) {
  // The search reads a query language; quotes, colons and brackets in a name would be taken for it.
  const term = String(q || '').replace(/[":()\[\]{}]/g, ' ').trim()
  if (term.length < 2) return []
  const key = term.toLowerCase()
  if (searched.has(key)) return searched.get(key)
  let out
  const mine = await viaServer(`/api/food/search?q=${encodeURIComponent(term)}`, fetchFn)
  if (mine?.products) out = mine.products.map(fromOff).filter(Boolean)
  else {
    // The classic search: the newer search.openfoodfacts.org sends no CORS header, so a browser
    // cannot call it.
    const ask = async nl => {
      const u = new URLSearchParams({ search_terms: term, json: '1', page_size: '25', fields: FIELDS, lc: 'nl' })
      if (nl) u.set('countries_tags_en', 'netherlands')
      const res = await timed(fetchFn, `https://world.openfoodfacts.org/cgi/search.pl?${u}`, 15000)
      if (!res.ok) throw new Error('search failed')
      return ((await res.json()).products || []).map(fromOff).filter(Boolean)
    }
    const nl = await ask(true)
    out = nl.length ? nl : await ask(false)
  }
  searched.set(key, out)
  return out
}
