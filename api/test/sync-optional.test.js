import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as sync from '../sync-stamps.js'
import { collectionCases } from '../../frontend/src/lib/__fixtures__/contracts/merge-cases.mjs'
collectionCases(test, (a, b) => sync.stampPut(a, structuredClone(b), { stamped: true, now: 100 }),
  (s, k) => sync.visibleOptionalEntries(s, k))
import { boundaryCases } from '../../frontend/src/lib/__fixtures__/contracts/merge-cases.mjs'
boundaryCases(test, (a, b) => sync.stampPut(a, structuredClone(b), { stamped: true, now: 100 }),
  (s, k) => sync.visibleOptionalEntries(s, k))

import { reviewCases } from '../../frontend/src/lib/__fixtures__/contracts/merge-cases.mjs'
reviewCases(test, sync, (a, b) => sync.stampPut(structuredClone(a), structuredClone(b), { stamped: true, now: 250 }))
test('stamping retains malformed raw elements without making them visible or changing unrelated clocks', () => {
  const raw = [null, false, 17, [], { opaque: true }]
  for (const key of sync.OPTIONAL_COLLECTIONS) {
    const unchanged = { id: 'held', label: 'Held', _ts: 10, _f: { label: 10 } }
    const prev = { [key]: [...raw, unchanged, { id: 'edit', label: 'Before', _ts: 10, _f: { label: 10 } }] }
    const next = structuredClone(prev); next[key].at(-1).label = 'After'
    sync.stampOptionalCollections(prev, next, 20)
    assert.deepEqual(next[key].slice(0, raw.length), raw)
    assert.deepEqual(next[key][raw.length], unchanged)
    assert.equal(next[key].at(-1)._f.label, 20)
    assert.deepEqual(sync.visibleOptionalEntries(next, key).map(e => e.id), ['held', 'edit'])
  }
  const legacy = { workouts: [], _ts: 7 }, before = JSON.stringify(legacy)
  sync.stampOptionalCollections(structuredClone(legacy), legacy, 20)
  assert.equal(JSON.stringify(legacy), before)
})
