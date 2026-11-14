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
test('a preferred account record survives the guest reset or tombstone, while guest-only deletions stay hidden', async () => {
  const api = await import('../../../api/sync-stamps.js')
  const account = { nutritionEntries: [{ id: 'shared', grams: 100, _ts: 10, _f: { grams: 10 } }] }
  const resets = [
    { nutritionEntries: [], resetAt: 30, resetIds: { nutritionEntries: ['shared'] } },
    { nutritionEntries: [{ id: 'guest', _ts: 10 }], deleted: { nutritionEntries: { shared: 30, guest: 30 } } },
  ]
  for (const guest of resets) for (const [a, b, prefer] of [[account, guest, 'a'], [guest, account, 'b']]) {
    const outputs = [sync.mergeStates(a, b, { prefer }), sync.mergeOptionalCollections(a, b, {}, { prefer }), api.mergeOptionalCollections(a, b, {}, { prefer })]
    for (const out of outputs) expect(sync.visibleOptionalEntries(out, 'nutritionEntries').map(x => x.id)).toEqual(['shared'])
  }
})
test('unstamped older records preserve independent fields in either order without inventing deletions', async () => {
  const api = await import('../../../api/sync-stamps.js')
  const a = [{ id: 'shared', grams: 100 }], b = [{ id: 'shared', name: 'Apple' }]
  for (const merge of [sync.mergeOptionalEntries, api.mergeOptionalEntries]) {
    expect(merge(a, b)[0]).toMatchObject({ id: 'shared', grams: 100, name: 'Apple' })
    expect(merge(a, b)).toEqual(merge(b, a))
  }
  expect(sync.mergeStates({ nutritionEntries: a }, { nutritionEntries: b }).nutritionEntries[0]).toMatchObject({ grams: 100, name: 'Apple' })
})
test('a stamp map below the HTTP size limit does not overflow the JavaScript argument stack', async () => {
  const api = await import('../../../api/sync-stamps.js')
  const row = { id: 'large', _f: Object.fromEntries(Array.from({ length: 150000 }, (_, i) => [`f${i}`, 1])) }
  expect(JSON.stringify(row).length).toBeLessThan(5 * 1024 * 1024)
  for (const merge of [sync.mergeOptionalEntries, api.mergeOptionalEntries]) expect(merge([row], [])[0]._ts).toBe(1)
})
test('optional reset inventories do not evict ids at the legacy reset cap', () => {
  const S = { nutritionEntries: Array.from({ length: sync.RESET_ID_MAX + 1 }, (_, i) => ({ id: `id-${i}`, _ts: 1 })) }
  const ids = sync.resetIdsOf(S)
  expect(ids.nutritionEntries).toHaveLength(sync.RESET_ID_MAX + 1)
})

import { reviewCases } from './__fixtures__/contracts/merge-cases.mjs'
reviewCases(test, sync, sync.mergeStates)
for (const key of sync.OPTIONAL_COLLECTIONS) test(`F4 ${key}: actual identical PUT replay is stable and client/API agree`, async () => {
  const api = await import('../../../api/sync-stamps.js')
  const cur = { _ts: 400, [key]: [{ id: 'a', distanceM: 3, _ts: 286, _f: { distanceM: 286 } }] }
  const next = { _ts: 500, [key]: [{ id: 'a', distanceM: 3, note: 'x', _ts: 495, _f: { note: 495 } }] }
  const first = api.stampPut(structuredClone(cur), structuredClone(next), { overRead: true, now: 500 })
  const second = api.stampPut(structuredClone(first), structuredClone(next), { overRead: true, now: 500 })
  expect(second[key][0]._f.distanceM).toBe(286)
  expect(second[key]).toEqual(first[key])
  const third = { _ts: 400, [key]: [{ id: 'a', distanceM: 9, _ts: 300, _f: { distanceM: 300 } }] }
  for (const state of [first, second]) {
    expect(sync.mergeStates(state, third)[key][0].distanceM).toBe(9)
    expect(api.stampPut(state, structuredClone(third), { stamped: true })[key]).toEqual(sync.mergeStates(state, third)[key])
  }
})
for (const key of sync.OPTIONAL_COLLECTIONS) test(`F1 ${key}: explicit add-back owns the negative clock, ordinary edits stay hidden`, async () => {
  const api = await import('../../../api/sync-stamps.js')
  const gone = { _ts: 100, [key]: [{ id: 'a', name: 'Apple', _ts: 10, _f: { name: 10 } }], deleted: { [key]: { a: 100 } } }
  const restored = structuredClone(gone)
  const at = Math.max(50, sync.highestStamp(gone) + 1)
  restored.deleted[key].a = -at
  restored._ts = sync.stampChange(gone, restored, at)
  expect(restored[key][0]._f.name).toBe(10)
  const stale = structuredClone(gone); stale[key][0].name = 'Pear'
  stale._ts = sync.stampChange(gone, stale, 150)
  expect(sync.visibleOptionalEntries(stale, key)).toEqual([])
  for (const stamped of [true, false]) {
    const saved = api.stampPut(gone, structuredClone(restored), { stamped, overRead: true, now: 160 })
    expect(saved[key][0]._f.name).toBe(10)
    for (const [a, b] of [[saved, stale], [stale, saved]]) {
      expect(sync.visibleOptionalEntries(sync.mergeStates(a, b), key)).toHaveLength(1)
      expect(api.visibleOptionalEntries(api.stampPut(a, structuredClone(b), { stamped: true }), key)).toHaveLength(1)
    }
  }
})
