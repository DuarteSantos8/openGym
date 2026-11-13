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
