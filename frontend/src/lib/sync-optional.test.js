import { test, expect } from 'vitest'
import * as sync from './sync-merge.js'
import { collectionCases } from './__fixtures__/contracts/merge-cases.mjs'
collectionCases(test, sync.mergeStates, (s, k) => sync.visibleOptionalEntries(s, k))
test('optional fields are stamped automatically by the existing store change hook', () => {
  const prev = { nutritionEntries: [{ id: 'a', schemaVersion: 1, grams: 100, _ts: 10, _f: { grams: 10 } }] }
  const next = structuredClone(prev); next.nutritionEntries[0].grams = 150
  sync.stampChange(prev, next, 20)
  expect(next.nutritionEntries[0]._f.grams).toBe(20)
})
import { boundaryCases } from './__fixtures__/contracts/merge-cases.mjs'
boundaryCases(test, sync.mergeStates, (s, k) => sync.visibleOptionalEntries(s, k))
test('prefer takes preferred record values but never displays another copy’s tombstoned record', () => {
  const a = { nutritionEntries: [{ id: 'a', name: 'preferred', _ts: 10 }] }
  const b = { nutritionEntries: [{ id: 'a', name: 'other', _ts: 20 }, { id: 'b', _ts: 10 }], deleted: { nutritionEntries: { b: 30 } } }
  const out = sync.mergeStates(a, b, { prefer: 'a' })
  expect(sync.visibleOptionalEntries(out, 'nutritionEntries').map(x => x.name)).toEqual(['preferred'])
})
test('reset inventory names optional ids', () => {
  expect(sync.resetIdsOf({ nutritionEntries: [{ id: 'a', _ts: 10 }] }).nutritionEntries).toEqual(['a'])
})
test('deliberate older backup restore revives only live backup records and restamps fields', () => {
  const backup = { nutritionEntries: [{ id: 'a', name: 'old', _ts: 10 }, { id: 'b', _ts: 10 }], deleted: { nutritionEntries: { b: 15 } } }
  const current = { nutritionEntries: [{ id: 'a', name: 'new', _ts: 20 }], deleted: { nutritionEntries: { a: 30 } } }
  sync.stampRestore(backup, [current], 40)
  const out = sync.mergeStates(backup, current)
  expect(sync.visibleOptionalEntries(out, 'nutritionEntries').map(x => x.name)).toEqual(['old'])
})
for (const key of ['activities', 'providerLinks']) test(`${key}: store stamping, add/edit/delete and API merge plumbing`, async () => {
  const api = await import('../../../api/sync-stamps.js')
  const prev = { [key]: [{ id: 'a', schemaVersion: 1, label: 'old', _ts: 10, _f: { label: 10, schemaVersion: 10 } }] }
  const changed = structuredClone(prev); changed[key][0].label = 'new'; changed[key].push({ id: 'b', schemaVersion: 1 })
  sync.stampChange(prev, changed, 20)
  expect(changed[key][0]._f.label).toBe(20)
  for (const out of [sync.mergeStates(prev, changed), api.stampPut(prev, structuredClone(changed), { stamped: true })]) {
    expect(out[key].map(x => x.id)).toEqual(['a', 'b']); expect(out[key][0].label).toBe('new')
  }
  const removed = structuredClone(changed); removed[key] = removed[key].filter(x => x.id !== 'a')
  sync.stampChange(changed, removed, 30)
  expect(sync.visibleOptionalEntries(removed, key).map(x => x.id)).toEqual(['b'])
  const server = api.stampPut(changed, structuredClone(removed), { stamped: true })
  expect(api.visibleOptionalEntries(server, key).map(x => x.id)).toEqual(['b'])
  const unstamped = structuredClone(prev); unstamped[key][0].label = 'API edit'
  api.stampPut(prev, unstamped, { overRead: true, now: 40 })
  expect(unstamped[key][0]._f.label).toBeGreaterThanOrEqual(40)
})
