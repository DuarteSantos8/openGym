// Open Food Facts text search, ported from NutriTrace's client (src/lib/api.js _offSearchUrl,
// _mapOFFProduct; src/lib/off-name.js). Per-100 g import only: NutriTrace's "Import portion as
// per serving" setting and its result re-ranking (off-rank.js) are not carried over.
import { deriveSodiumSalt, newUuid } from './diary.js'

export const OFF_SEARCH_BASE = 'https://search.openfoodfacts.org/search'
export const OFF_PRODUCT_BASE = 'https://world.openfoodfacts.org/api/v3/product'

/** The product URL NutriTrace's proxy fetches for a barcode (src/lib/api.js lookupBarcode):
 *  `https://world.openfoodfacts.org/api/v3/product/<8-14 digits>?lc=<2 letters>`, nothing else.
 *  The hub accepts exactly this shape. */
export function offProductUrl(code, lang = 'en') {
  return `${OFF_PRODUCT_BASE}/${code}?lc=${/^[a-z]{2}$/.test(lang) ? lang : 'en'}`
}

function luceneEscape(s) {
  return String(s || '')
    .replace(/[+\-!(){}[\]^"~*?:\\/]/g, '\\$&')
    .replace(/&&/g, '\\&\\&')
    .replace(/\|\|/g, '\\|\\|')
}

/** A country by its English name as Open Food Facts tags it: "United Kingdom" is en:united-kingdom. */
export const countryTag = country => 'en:' + String(country).toLowerCase().replace(/\s+/g, '-')

/** The search URL NutriTrace's proxy fetches. The hub accepts exactly this shape. */
export function offSearchUrl(query, { page = 1, pageSize = 20, lang = 'en', country = null } = {}) {
  // A country other than World narrows the search itself, inside `q` as NutriTrace does
  // (api.js _offSearchUrl): `+countries_tags:"en:germany"`. 80 characters, escaped at most to 160,
  // plus the filter (36 for the longest country): under the hub's 200 for q, and no
  // parameter beyond q, page, page_size and langs (fitness-hub src/nt-routes.ts).
  const filter = country && country !== 'World' ? ` +countries_tags:"${countryTag(country)}"` : ''
  const params = new URLSearchParams({
    q: luceneEscape(String(query).trim().slice(0, 80)) + filter,
    page_size: String(Math.min(50, Math.max(1, pageSize))),
    page: String(Math.min(100, Math.max(1, page))),
    langs: /^[a-z]{2}$/.test(lang) ? lang : 'en',
  })
  return `${OFF_SEARCH_BASE}?${params.toString()}`
}

// [NutriTrace nutrient id, OFF nutriment key, multiplier from OFF's grams]
const OFF_NUTRIENTS = [
  ['kilojoules', 'energy'],
  ['fat', 'fat'],
  ['saturated-fat', 'saturated-fat'],
  ['trans-fat', 'trans-fat'],
  ['polyunsaturated-fat', 'polyunsaturated-fat'],
  ['monounsaturated-fat', 'monounsaturated-fat'],
  ['carbohydrates', 'carbohydrates'],
  ['sugars', 'sugars'],
  ['added-sugars', 'added-sugars'],
  ['fiber', 'fiber'],
  ['proteins', 'proteins'],
  ['salt', 'salt'],
  ['sodium', 'sodium', 1000],
  ['potassium', 'potassium', 1000],
  ['cholesterol', 'cholesterol', 1000],
  ['caffeine', 'caffeine', 1000],
  ['alcohol', 'alcohol'],
  ['calcium', 'calcium', 1000],
  ['iron', 'iron', 1000],
  ['magnesium', 'magnesium', 1000],
  ['vitamin-c', 'vitamin-c', 1000],
  ['vitamin-a', 'vitamin-a', 1000000],
  ['vitamin-d', 'vitamin-d', 1000000],
  ['vitamin-e', 'vitamin-e', 1000],
  ['vitamin-k', 'vitamin-k', 1000000],
  ['b1', 'vitamin-b1', 1000],
  ['b2', 'vitamin-b2', 1000],
  ['b3', 'vitamin-b3', 1000],
  ['b6', 'vitamin-b6', 1000],
  ['b9', 'vitamin-b9', 1000000],
  ['b12', 'vitamin-b12', 1000000],
  ['zinc', 'zinc', 1000],
  ['phosphorus', 'phosphorus', 1000],
]

const text = v => (typeof v === 'string' ? v.trim() : '')

// off-name.js: product_name is blank on products whose main language has none.
function productName(p, lang) {
  const main = text(p.lang || p.lc).toLowerCase()
  for (const field of ['product_name', 'generic_name']) {
    const tries = [p[field], p[`${field}_${lang}`], main && p[`${field}_${main}`], p[`${field}_en`]]
    for (const v of tries) if (text(v)) return text(v)
  }
  return ''
}

function basisOf(p) {
  const raw = String(p.nutrition_data_per || '').toLowerCase()
  if (raw === '100g') return 'g'
  if (raw === '100ml') return 'ml'
  const su = String(p.serving_quantity_unit || '').toLowerCase()
  if (su === 'g' || su === 'kg') return 'g'
  if (su === 'ml' || su === 'l') return 'ml'
  return null
}

const BASE_UNITS = new Set(['g', 'mg', 'kg', 'ml', 'l', 'oz', 'lb', 'cup', 'tbsp', 'tsp'])
// "1 slice (35 g)" with serving_quantity 35 → [{ abbr: 'slice', grams: 35 }]
function altUnitsOf(p) {
  const ss = text(p.serving_size)
  const sq = parseFloat(p.serving_quantity)
  if (!ss || !Number.isFinite(sq) || sq <= 0) return null
  const m = ss.match(/^\s*\d+\s*([a-zA-ZÀ-ÿ]+)/)
  const label = m ? m[1].toLowerCase() : ''
  if (!label || BASE_UNITS.has(label)) return null
  return [{ abbr: label, grams: Math.round(sq * 10) / 10 }]
}

/** One OFF search hit as an unsaved NutriTrace food (per 100 g, no `id`), or null when it is not
 *  usable: no name, or no "as sold" energy at all (NutriTrace's #241: it would log as 0 kcal). */
export function mapOffProduct(p, lang = 'en') {
  if (!p || typeof p !== 'object') return null
  const name = productName(p, lang)
  if (!name) return null
  const n = p.nutriments || {}
  const has = key => n[key + '_modifier'] !== '~' && n[key + '_100g'] !== undefined && n[key + '_100g'] !== null && n[key + '_100g'] !== ''
  const g = (key, mult) => (has(key) ? (parseFloat(n[key + '_100g']) || 0) * (mult || 1) : 0)
  if (!has('energy-kcal') && !has('energy')) return null
  const kcal = has('energy-kcal') ? g('energy-kcal') : g('energy') / 4.184
  const nutrition = { calories: Math.round(kcal * 10) / 10 }
  for (const [id, key, mult] of OFF_NUTRIENTS) nutrition[id] = g(key, mult)
  const brand = Array.isArray(p.brands) ? text(p.brands[0]) : text(String(p.brands || '').split(',')[0])
  return {
    name,
    brand,
    barcode: String(p.code || p._id || ''),
    portion: 100,
    unit: 'g',
    imgUrl: p.image_front_small_url || p.image_front_url || p.image_url || '',
    nutrition_basis: basisOf(p),
    alt_units: altUnitsOf(p),
    nutrition: deriveSodiumSalt(nutrition),
    // POST /api/foods returns the food made the first time for a key it has seen: a retry after
    // a lost answer saves one food, not two (server/lib/create-keys.js).
    client_key: newUuid(),
  }
}

/** Products sold in Romania come first (the owner's rule). The hub lets a search carry only q,
 *  page, page_size and langs, so Open Food Facts cannot be asked to rank by country: the hits'
 *  `countries_tags` are read here instead. */
export const RANK_FIRST_COUNTRY = 'en:romania'

/** The country whose products come first: the one picked in Profile › Food sources (`offSearchCountry`,
 *  by its English name, "United Kingdom" → en:united-kingdom), and Romania while it is World or unset. */
export function rankTagOf(country) {
  return country && country !== 'World' ? countryTag(country) : RANK_FIRST_COUNTRY
}

/** The search answer in either envelope NutriTrace's proxy sends: `hits` (a local OFF mirror) or
 *  `products` (the public API), products sold in the ranked country first (`country`, see
 *  rankTagOf), each group in Open Food Facts' order. */
export function offResults(data, lang = 'en', country = null) {
  const list = Array.isArray(data?.hits) ? data.hits : Array.isArray(data?.products) ? data.products : []
  const tag = rankTagOf(country)
  const soldInRankedCountry = p => Array.isArray(p?.countries_tags) && p.countries_tags.includes(tag)
  const ranked = [...list.filter(soldInRankedCountry), ...list.filter(p => !soldInRankedCountry(p))]
  return ranked.map(p => mapOffProduct(p, lang)).filter(Boolean)
}

/** A product lookup's answer (v3 says `status: 'success'`, a local mirror `status: 1`) as the
 *  food it describes, an unsaved one carrying `code`; null when OFF has the product but not
 *  enough nutrition to log it (mapOffProduct), `undefined` when it has no such product. */
export function offProduct(data, code, lang = 'en') {
  if (!data || typeof data !== 'object') return undefined
  const ok = data.status === 'success' || data.status === 1
  if (!ok || !data.product || typeof data.product !== 'object') return undefined
  const food = mapOffProduct(data.product, lang)
  return food ? { ...food, barcode: food.barcode || code } : null
}
