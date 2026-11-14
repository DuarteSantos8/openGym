import { describe, expect, test } from 'vitest'
import { createEntry, editEntry, servingAmount, normalizeEntry } from './entry.js'

const context = { now: new Date('2026-11-14T10:00:00Z'), timeZone: 'Europe/Lisbon' }
const input = { label: ' Oats ', day: '2026-11-14', meal: 'breakfast', energyKcal: '0' }
test('creates a bounded snapshot with a fresh UUID, explicit zero and missing unknowns', () => {
  const e = createEntry(input, context)
  expect(e.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  expect(e).toMatchObject({ schemaVersion: 1, label: 'Oats', source: 'manual', createdBy: 'manual', day: '2026-11-14', timeZone: 'Europe/Lisbon', energyKcal: 0 })
  expect(e).not.toHaveProperty('proteinG')
  expect(createEntry(input, context).id).not.toBe(e.id)
})
describe('units never invent density', () => {
  test.each([
    [{ amount: 12.34567, unit: 'g' }, { amountG: 12.346 }],
    [{ amount: 250, unit: 'mL' }, { amountMl: 250 }],
    [{ amount: 1.5, unit: 'serving', servingLabel: 'cup', servingSize: 200, servingUnit: 'mL' }, { amountMl: 300, serving: { label: 'cup', count: 1.5, size: 200, unit: 'mL' } }],
    [{ amount: 2, unit: 'serving', servingLabel: 'slice', servingSize: 30, servingUnit: 'g' }, { amountG: 60, serving: { label: 'slice', count: 2, size: 30, unit: 'g' } }],
    [{ amount: '', unit: 'g' }, {}],
  ])('%j', (given, want) => expect(servingAmount(given)).toEqual(want))
})
test.each([-1, NaN, Infinity, 'no', 1e12, true])('rejects invalid nutrient %s', energyKcal => {
  expect(() => createEntry({ ...input, energyKcal }, context)).toThrow()
})
test.each([
  { label: '' }, { day: '2026-02-30' }, { meal: 'anything' }, { amount: -1 },
  { amount: 3, unit: 'oz' }, { amount: 1e6, unit: 'serving', servingSize: 1e6, servingUnit: 'g', servingLabel: 'x' },
])('rejects invalid entry %j', patch => expect(() => createEntry({ ...input, ...patch }, context)).toThrow())
test('edit preserves provenance, identity, filing and opaque fields; nutrient amounts do not scale', () => {
  const e = { ...createEntry({ ...input, amount: 100, unit: 'g' }, { ...context, source: 'open-food-facts', externalId: 'off:123', contentFingerprint: 'sha256:' + 'a'.repeat(64) }), future: 9 }
  const next = editEntry(e, { label: 'Corrected', amount: 200, unit: 'g', proteinG: '', source: 'manual', day: '2027-01-01' })
  expect(next).toMatchObject({ id: e.id, source: 'open-food-facts', externalId: 'off:123', contentFingerprint: e.contentFingerprint, day: e.day, timeZone: e.timeZone, createdAt: e.createdAt, amountG: 200, energyKcal: 0, future: 9 })
  expect(next).not.toHaveProperty('proteinG')
  expect(e.label).toBe('Oats')
})
test('future versions stay opaque on read and cannot be edited', () => {
  const e = { id: 'opaque', schemaVersion: 99, label: { future: true }, energyKcal: 'future' }
  expect(normalizeEntry(e)).toEqual({ supported: false, entry: e })
  expect(() => editEntry(e, { label: 'x' })).toThrow()
})
test('canonical validation rejects invalid UUID, version and timezone without rewriting reads', () => {
  const e = createEntry(input, context)
  expect(normalizeEntry(e)).toEqual({ supported: true, entry: e })
  for (const patch of [{ id: 'bad' }, { schemaVersion: 0 }, { timeZone: 'Invalid/Zone' }, { proteinG: -1 }]) {
    expect(normalizeEntry({ ...e, ...patch }).supported).toBe(false)
  }
})
test('date-only entry has no fabricated instant', () => {
  expect(createEntry({ ...input, day: '2026-11-12' }, context)).not.toHaveProperty('occurredAt')
})
