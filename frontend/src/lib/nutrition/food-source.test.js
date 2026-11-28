import { expect, test } from 'vitest'
import { validateBarcode, sourceSnapshot, sourceFingerprint, lookupInput } from './food-source.js'
import { createEntry, editEntry } from './entry.js'

const product = () => ({ source: 'open-food-facts', externalId: '3017620422003', label: 'Synthetic oats', brand: 'Fixture', quantityText: '330 ml', per100: { basis: 'g', energyKcal: 200, proteinG: 8, fatG: 0 }, serving: { label: '30 g', grams: 30 }, fetchedAt: '2026-11-14T10:00:00.000Z', attribution: { text: 'Contains information from Open Food Facts, available under the Open Database License (ODbL).', url: 'https://world.openfoodfacts.org/product/3017620422003', license: 'ODbL-1.0', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' } })
test('GTIN preserves leading zeros and rejects non-ASCII, newline and check digit errors', () => {
  for (const value of ['96385074', '012345678905', '3017620422003', '03017620422003']) expect(validateBarcode(value)).toBe(true)
  for (const value of ['3017620422004', '3017620422003\n', '１２３４５６７８', '123', 3017620422003]) expect(validateBarcode(value)).toBe(false)
})
test('grams scale known values, keep zero and omit unknowns regardless of package volume', () => {
  expect(lookupInput(product(), '25', 'g')).toEqual({ label: 'Synthetic oats', amount: 25, unit: 'g', energyKcal: 50, proteinG: 2, fatG: 0 })
  expect(lookupInput(product(), 0, 'g').energyKcal).toBe(0)
})
test('explicit servings use producer arithmetic', () => {
  expect(lookupInput(product(), 2, 'serving')).toMatchObject({ amount: 2, unit: 'serving', servingSize: 30, servingUnit: 'g', energyKcal: 120, proteinG: 4.8 })
})
test('ml remains volume; only matching explicit servings are usable', () => {
  const p = product(); p.per100 = { basis: 'ml', energyKcal: 40, proteinG: 0 }; p.serving = { label: '125 ml', millilitres: 125 }
  expect(lookupInput(p, 2, 'serving')).toMatchObject({ servingUnit: 'mL', energyKcal: 100, proteinG: 0 })
  expect(lookupInput(p, 250, 'mL')).toMatchObject({ unit: 'mL', amount: 250, energyKcal: 100 })
  expect(() => lookupInput(p, 100, 'g')).toThrow()
  p.serving = { label: '30 g', grams: 30 }
  expect(() => lookupInput(p, 1, 'serving')).toThrow()
})
for (const value of ['', null, undefined, -1, Infinity, NaN, 'no', 1000001]) test(`invalid amount ${String(value)} cannot save`, () => {
  expect(() => lookupInput(product(), value, 'g')).toThrow()
})
test('calculated totals and serving products must remain bounded, with three decimals', () => {
  expect(() => lookupInput(product(), 1000000, 'g')).toThrow()
  expect(() => lookupInput(product(), 1000000, 'serving')).toThrow()
  expect(lookupInput(product(), 0.003, 'g').proteinG).toBe(0)
  expect(lookupInput(product(), 0.3, 'g').proteinG).toBe(0.024)
})
for (const value of [null, '8', -1, Infinity, 101]) test(`invalid source nutrient ${String(value)} rejected`, () => {
  const p = product(); p.per100.proteinG = value
  expect(() => sourceSnapshot(p)).toThrow()
})
test('snapshot selects bounded data and constructs safe links without retaining raw payloads', () => {
  const p = product(); p.image = 'https://bad/image'; p.attribution.url = 'javascript:alert(1)'; p.attribution.licenseUrl = 'data:text/html,evil'
  const copy = sourceSnapshot(p)
  expect(copy).not.toHaveProperty('image')
  expect(copy.attribution).toEqual(product().attribution)
  expect(copy.per100).not.toBe(p.per100)
  p.label = '<img src=x>'; expect(() => sourceSnapshot(p)).toThrow()
  p.label = 'x'.repeat(161); expect(() => sourceSnapshot(p)).toThrow()
})
test('source fingerprint is canonical, excludes fetch time/user edits, changes with source nutrients', async () => {
  const p = product(), h = await sourceFingerprint(p)
  expect(h).toMatch(/^sha256:[a-f0-9]{64}$/)
  const reordered = Object.fromEntries(Object.entries(p).reverse()); reordered.fetchedAt = '2026-11-15T00:00:00Z'; reordered.amount = 999
  expect(await sourceFingerprint(reordered)).toBe(h)
  reordered.per100 = { ...p.per100, proteinG: 7 }
  expect(await sourceFingerprint(reordered)).not.toBe(h)
})
test('confirmed events have distinct UUIDs, immutable provenance and deep source snapshots', async () => {
  const p = product(), contentFingerprint = await sourceFingerprint(p)
  const context = { source: p.source, externalId: p.externalId, contentFingerprint, sourceSnapshot: p }
  const input = { ...lookupInput(p, 25, 'g'), day: '2026-11-14', meal: 'snack' }
  const a = createEntry(input, context), b = createEntry(input, context)
  expect(a.id).not.toBe(b.id)
  expect(a.sourceSnapshot).toEqual(p)
  p.per100.energyKcal = 999
  expect(a.sourceSnapshot.per100.energyKcal).toBe(200)
  const edited = editEntry(a, { label: 'My correction', energyKcal: 1, source: 'bad', sourceSnapshot: {}, contentFingerprint: 'bad' })
  expect(edited).toMatchObject({ source: a.source, contentFingerprint, sourceSnapshot: a.sourceSnapshot, energyKcal: 1 })
})
