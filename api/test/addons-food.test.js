import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barcodeProblem, normalizeOpenFoodFacts, createFoodLookup } from '../addons/food.js'

test('barcodes are strictly numeric GTIN-sized strings, preserving leading zeros', () => {
  assert.equal(barcodeProblem('01234567'), null)
  assert.equal(barcodeProblem(' 3017620422003 '), null)
  assert.match(barcodeProblem('123'), /8 to 14/)
  assert.match(barcodeProblem('123456789012345'), /8 to 14/)
  assert.match(barcodeProblem('1234567x'), /digits/)
})

test('normalization preserves zero, distinguishes missing nutrition, and does not echo untrusted image URLs', () => {
  const result = normalizeOpenFoodFacts({
    result: { id: 'product_found' },
    product: {
      code: '3017620422003', product_name: 'Test cereal', brands: 'Sample Co',
      quantity: '400 g', nutrition_grades: 'b', serving_size: '40 g',
      nutriments: { 'energy-kcal_100g': '0', proteins_100g: 9.2, fat_100g: null,
        carbohydrates_100g: 13, sugars_100g: '2.1' },
      allergens_tags: ['en:milk', 'en:gluten'],
      image_url: 'https://not-licensed.example/img.jpg'
    }
  }, '3017620422003')
  assert.deepEqual(result, {
    barcode: '3017620422003', name: 'Test cereal', brand: 'Sample Co', quantity: '400 g',
    serving: '40 g', grade: 'B',
    per100: { kcal: 0, proteinG: 9.2, carbohydrateG: 13, fatG: null, sugarG: 2.1 }, basis: null,
    allergens: ['milk', 'gluten'], source: 'Open Food Facts'
  })
  assert.equal(normalizeOpenFoodFacts({ status: 0 }, '3017620422003'), null)
  assert.equal(normalizeOpenFoodFacts({ result: { id: 'product_not_found' } }, '3017620422003'), null)
})

test('the read-only lookup uses a fixed OFF domain, User-Agent, bounds, and a per-barcode cache', async () => {
  const calls = []
  let now = 1000
  const lookup = createFoodLookup({
    now: () => now, ttlMs: 1000, userAgent: 'openGym-SorenFork/0.1 (https://github.com/sorensadrgit-art/openGym)',
    fetchImpl: async (url, opts) => {
      calls.push([url, opts])
      return { ok: true, json: async () => ({ result: { id: 'product_found' },
        product: { product_name: 'Yogurt', nutriments: { proteins_100g: 4 } } }) }
    }
  })
  const first = await lookup('0123456789012')
  assert.equal(first.status, 200)
  assert.equal(first.body.food.name, 'Yogurt')
  assert.equal((await lookup('0123456789012')).body.food.name, 'Yogurt')
  assert.equal(calls.length, 1)
  assert.match(calls[0][0], /^https:\/\/world\.openfoodfacts\.org\/api\/v3\.6\/product\/0123456789012\.json\?fields=/)
  assert.match(calls[0][1].headers['User-Agent'], /openGym-SorenFork/)
  assert.equal((await lookup('xx')).status, 400)
  assert.equal(calls.length, 1)
  now += 1001
  await lookup('0123456789012')
  assert.equal(calls.length, 2)
})

test('a missing product and upstream failures return safe bounded results', async () => {
  const missing = createFoodLookup({ fetchImpl: async () => ({ ok: true,
    json: async () => ({ result: { id: 'product_not_found' } }) }) })
  assert.deepEqual(await missing('3017620422003'), { status: 404, body: { error: 'Product not found' } })
  const unavailable = createFoodLookup({ fetchImpl: async () => { throw new Error('secret network detail') } })
  assert.deepEqual(await unavailable('3017620422003'), { status: 502, body: { error: 'Food lookup unavailable' } })
})

test('simultaneous requests for one barcode make one upstream request', async () => {
  let calls = 0
  const lookup = createFoodLookup({ fetchImpl: async () => {
    calls++
    await new Promise(resolve => setImmediate(resolve))
    return { ok: true, json: async () => ({ result: { id: 'product_found' }, product: { product_name: 'A' } }) }
  } })
  const [a, b] = await Promise.all([lookup('3017620422003'), lookup('3017620422003')])
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
})

// The shape API v3.6 really answers (checked live, Nov 2026): `nutriments` is empty and the
// numbers sit in nutrition.aggregated_set, each with its unit, basis and source.
const v36 = (nutrients, set = {}) => ({
  result: { id: 'product_found' },
  product: { product_name: 'Hazelnut spread', nutriments: {}, nutrition: { aggregated_set: { per: '100g', preparation: 'as_sold', ...set, nutrients } } }
})

test('API v3.6: nutrients are read from nutrition.aggregated_set, not the empty legacy map', () => {
  const food = normalizeOpenFoodFacts(v36({
    'energy-kcal': { source: 'manufacturer', source_per: '100g', unit: 'kcal', value: 539, value_computed: 533.3 },
    proteins: { source: 'manufacturer', source_per: '100g', unit: 'g', value: 6.3 },
    carbohydrates: { source: 'packaging', source_per: '100g', unit: 'g', value: 57.5 },
    fat: { source: 'manufacturer', source_per: '100g', unit: 'g', value: 30.9 },
    sugars: { source: 'manufacturer', source_per: '100g', unit: 'g', value: 56.3 },
  }), '3017620422003')
  assert.deepEqual(food.per100, { kcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9, sugarG: 56.3 })
  assert.equal(food.basis, '100g')
})

test('API v3.6: values Open Food Facts estimated itself are not shown as label values', () => {
  const food = normalizeOpenFoodFacts(v36({
    'energy-kcal': { source: 'packaging', unit: 'kcal', value: 44 },
    proteins: { modifier: '~', source: 'estimate', unit: 'g', value: 0.4 },
  }), '5449000000996')
  assert.equal(food.per100.kcal, 44)
  assert.equal(food.per100.proteinG, null)
})

test('API v3.6: units are brought to grams and kcal, a kJ-only label becomes kcal, a per-serving set is refused', () => {
  const food = normalizeOpenFoodFacts(v36({
    energy: { source: 'packaging', unit: 'kJ', value: 418.4 },
    proteins: { source: 'packaging', unit: 'mg', value: 1500 },
    fat: { source: 'packaging', unit: 'g', value: '2' },
  }, { per: '100ml' }), '5449000000996')
  assert.deepEqual(food.per100, { kcal: 100, proteinG: 1.5, carbohydrateG: null, fatG: 2, sugarG: null })
  assert.equal(food.basis, '100ml')
  const serving = normalizeOpenFoodFacts(v36({ proteins: { source: 'packaging', unit: 'g', value: 9 } }, { per: 'serving' }), '5449000000996')
  assert.equal(serving.per100.proteinG, null)
  assert.equal(serving.basis, null)
})

test('the lookup asks Open Food Facts for the v3.6 nutrition field as well as the legacy one', async () => {
  let asked = ''
  const lookup = createFoodLookup({ fetchImpl: async url => { asked = url; return { ok: true, json: async () => v36({}) } } })
  await lookup('3017620422003')
  const fields = new URL(asked).searchParams.get('fields').split(',')
  assert.ok(fields.includes('nutrition'))
  assert.ok(fields.includes('nutriments'))
})

// Open Food Facts v3 answers an unknown barcode with HTTP 404 and a failure body (checked live,
// 2026-11-13: GET /api/v3.6/product/0000000000017.json -> 404, result.id product_not_found).
// That is "not in the database", not an outage, and must not read as one.
test('an unknown barcode (upstream HTTP 404) is "Product not found", not "lookup unavailable"', async () => {
  const notFound = createFoodLookup({ fetchImpl: async () => ({ ok: false, status: 404,
    json: async () => ({ status: 'failure', result: { id: 'product_not_found' }, errors: [{ message: { id: 'product_not_found' } }] }) }) })
  assert.deepEqual(await notFound('0000000000017'), { status: 404, body: { error: 'Product not found' } })
  // A 404 whose body is not JSON is still "not found".
  const bare = createFoodLookup({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => { throw new Error('html') } }) })
  assert.deepEqual(await bare('3017620422003'), { status: 404, body: { error: 'Product not found' } })
  // Real upstream trouble stays a 502.
  for (const status of [429, 500, 503]) {
    const busy = createFoodLookup({ fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) })
    assert.deepEqual(await busy('3017620422003'), { status: 502, body: { error: 'Food lookup unavailable' } }, String(status))
  }
})
