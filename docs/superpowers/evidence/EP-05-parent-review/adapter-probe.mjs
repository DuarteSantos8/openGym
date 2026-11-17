import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
const root = resolve(process.argv[2] || '.')
const { createFoodLookup, normalizeProduct } = await import(pathToFileURL(resolve(root, 'api/food-lookup.js')))
const barcode = '3017620422003'
const payload = { status: 'success', result: { id: 'product_found' }, product: {
  code: barcode, product_name: 'Synthetic fixture', quantity: '330 ml',
  nutrition: { aggregated_set: { per: '100g', preparation: 'as_sold', nutrients: {
    proteins: { value: 0, unit: 'g' }, carbohydrates: { value: '7', unit: 'g' },
    fat: { value: -1, unit: 'g' }, 'energy-kj': { value: 418.4, unit: 'kJ' },
  } } },
} }
let calls = 0, observed
const transport = async (url, options) => {
  calls++; observed = { url, headers: options.headers }
  return { statusCode: 200, headers: {}, body: Readable.from([JSON.stringify(payload)]) }
}
let checks = 0
async function rejects(promise, status, code) {
  await assert.rejects(promise, e => e.status === status && e.code === code)
  checks++
}
const input = { uid: 'synthetic-a', nutrition: true, barcode }
const disabled = createFoodLookup({ transport })
await rejects(disabled.lookup(input), 403, 'food-lookup-disabled')
const lookup = createFoodLookup({ enabled: true, transport, userMax: 30 })
await rejects(lookup.lookup({ ...input, uid: '' }), 401, 'food-lookup-auth-required')
for (const nutrition of [false, undefined, 'true', 1]) {
  await rejects(lookup.lookup({ ...input, nutrition }), 403, 'nutrition-disabled')
}
await rejects(lookup.lookup({ ...input, barcode: barcode + '?uid=private' }), 400, 'food-lookup-invalid-barcode')
assert.equal(calls, 0); checks++
const first = await lookup.lookup(input)
assert.deepEqual(first.per100, { basis: 'g', energyKcal: 100, energyConversion: 'kJ/4.184', proteinG: 0 }); checks++
first.label = 'corrupted by caller'
const second = await lookup.lookup({ ...input, uid: 'synthetic-b' })
assert.equal(second.label, 'Synthetic fixture'); assert.equal(calls, 1); checks++
await rejects(lookup.lookup({ ...input, nutrition: false }), 403, 'nutrition-disabled')
assert.equal(calls, 1); checks++
assert.equal(new URL(observed.url).origin, 'https://world.openfoodfacts.org')
assert.deepEqual(Object.keys(observed.headers).sort(), ['Accept', 'User-Agent'])
assert.ok(!JSON.stringify(observed).includes('synthetic-a')); checks++
const oversized = createFoodLookup({ enabled: true, transport: async () => ({
  statusCode: 200, headers: {}, body: Readable.from([Buffer.alloc(65537)])
}) })
await rejects(oversized.lookup(input), 502, 'food-lookup-upstream')
const slow = createFoodLookup({ enabled: true, totalTimeoutMs: 5, transport: () => new Promise(() => {}) })
await rejects(slow.lookup(input), 504, 'food-lookup-timeout')
const malformed = structuredClone(payload)
malformed.product.nutrition.aggregated_set.per = 'serving'
assert.throws(() => normalizeProduct(malformed, barcode), e => e.code === 'food-lookup-upstream'); checks++
console.log(JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  checks, liveRequests: 0, status: 'pass' }))
