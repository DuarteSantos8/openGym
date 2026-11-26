// Opt-in, read-only Open Food Facts adapter. No food, profile or workout data is persisted.
// The server sets the User-Agent that browsers cannot set themselves.
// `nutrition` is where API v3.6 keeps the numbers (aggregated_set); `nutriments` is the legacy
// flat map, still read for records and mirrors that only have it.
const FIELDS = 'code,product_name,brands,quantity,serving_size,nutrition_grades,nutriments,nutrition,allergens_tags'
const API = 'https://world.openfoodfacts.org/api/v3.6/product'
const DEFAULT_AGENT = 'openGym-SorenFork/0.1 (https://github.com/sorensadrgit-art/openGym)'

export function barcodeProblem(value) {
  const code = String(value ?? '').trim()
  if (!/^\d+$/.test(code)) return 'Barcode must contain digits only'
  if (code.length < 8 || code.length > 14) return 'Barcode must contain 8 to 14 digits'
  return null
}

const short = (v, max = 120) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const numeric = n => n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n)

// To grams (macros) from what a label may state. Anything else is not a mass and is refused.
const TO_G = { g: 1, mg: 1e-3, 'µg': 1e-6, mcg: 1e-6, ug: 1e-6 }
const BASES = new Set(['100g', '100ml'])
const round = (v, places = 2) => v == null ? null : Math.round(v * 10 ** places) / 10 ** places

/** API v3.6: per-100 values from nutrition.aggregated_set, or null when it has no usable set.
 * Values Open Food Facts estimated itself (source "estimate") are left out: the diary shows what
 * the label says, or nothing. A set per serving is refused, servings are not comparable. */
function fromAggregatedSet(set) {
  if (!set || typeof set !== 'object' || !BASES.has(set.per)) return null
  if (set.preparation && set.preparation !== 'as_sold') return null
  const nutrients = set.nutrients && typeof set.nutrients === 'object' ? set.nutrients : {}
  const read = (key, unitTable) => {
    const n = nutrients[key]
    if (!n || typeof n !== 'object' || n.source === 'estimate') return null
    const value = numeric(n.value)
    const factor = unitTable[String(n.unit || '').trim()]
    return value == null || value < 0 || factor == null ? null : value * factor
  }
  const grams = key => round(read(key, TO_G))
  let kcal = read('energy-kcal', { kcal: 1 })
  if (kcal == null) {
    const kj = read('energy-kj', { kJ: 1, kj: 1 }) ?? read('energy', { kJ: 1, kj: 1 })
    if (kj != null) kcal = kj / 4.184
  }
  return {
    basis: set.per,
    per100: { kcal: kcal == null ? null : Math.round(kcal), proteinG: grams('proteins'), carbohydrateG: grams('carbohydrates'), fatG: grams('fat'), sugarG: grams('sugars') },
  }
}

export function normalizeOpenFoodFacts(payload, barcode) {
  if (!payload || payload.status === 0 || payload.result?.id === 'product_not_found') return null
  const p = payload.product
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const n = p.nutriments || {}
  // Only use numbers per 100 g/ml; serving values are not standardized across records.
  const allergens = Array.isArray(p.allergens_tags)
    ? [...new Set(p.allergens_tags.filter(a => typeof a === 'string').map(a => short(a.replace(/^[a-z]{2}:/i, ''), 35)).filter(Boolean))].slice(0, 12)
    : []
  const modern = fromAggregatedSet(p.nutrition?.aggregated_set)
  const legacy = {
    kcal: numeric(n['energy-kcal_100g']),
    proteinG: numeric(n.proteins_100g),
    carbohydrateG: numeric(n.carbohydrates_100g),
    fatG: numeric(n.fat_100g),
    sugarG: numeric(n.sugars_100g),
  }
  // The legacy map wins only where it actually has numbers (older mirrors); otherwise v3.6's set.
  const legacyHas = Object.values(legacy).some(v => v != null)
  const grade = typeof p.nutrition_grades === 'string' && /^[a-e]$/i.test(p.nutrition_grades)
    ? p.nutrition_grades.toUpperCase() : null
  return {
    barcode, name: short(p.product_name || p.product_name_en) || 'Unnamed product',
    brand: short(p.brands, 90), quantity: short(p.quantity, 50),
    serving: short(p.serving_size, 50), grade,
    per100: legacyHas || !modern ? legacy : modern.per100,
    basis: legacyHas || !modern ? null : modern.basis,
    allergens, source: 'Open Food Facts'
  }
}

export function createFoodLookup({
  fetchImpl = fetch, now = Date.now, ttlMs = 15 * 60 * 1000,
  userAgent = DEFAULT_AGENT, timeoutMs = 8000, maxEntries = 256
} = {}) {
  const cache = new Map()
  const pending = new Map()
  return async function lookupFood(raw) {
    const barcode = String(raw ?? '').trim()
    const problem = barcodeProblem(barcode)
    if (problem) return { status: 400, body: { error: problem } }
    const found = cache.get(barcode)
    if (found && now() < found.expires) return found.value
    if (pending.has(barcode)) return pending.get(barcode)
    const work = (async () => {
      try {
        const url = API + '/' + barcode + '.json?fields=' + FIELDS
        const response = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': userAgent },
          signal: AbortSignal.timeout(timeoutMs)
        })
        // v3 answers an unknown barcode with HTTP 404 (result.id product_not_found): not an outage.
        if (response.status === 404) return { status: 404, body: { error: 'Product not found' } }
        if (!response.ok) return { status: 502, body: { error: 'Food lookup unavailable' } }
        const food = normalizeOpenFoodFacts(await response.json(), barcode)
        if (!food) return { status: 404, body: { error: 'Product not found' } }
        return { status: 200, body: { food } }
      } catch {
        return { status: 502, body: { error: 'Food lookup unavailable' } }
      }
    })()
    pending.set(barcode, work)
    try {
      const result = await work
      if (result.status === 200) {
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value)
        cache.set(barcode, { value: result, expires: now() + ttlMs })
      }
      return result
    } finally {
      pending.delete(barcode)
    }
  }
}
