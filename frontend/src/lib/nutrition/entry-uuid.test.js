import { webcrypto } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { createEntry, normalizeEntry } from './entry.js'
import { lookupInput, sourceFingerprint, sourceSnapshot } from './food-source.js'
import fixture from '../__fixtures__/contracts/nutrition-source-entry.json'

afterEach(() => vi.unstubAllGlobals())
const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
for (const kind of ['manual', 'confirmed lookup']) test(`${kind} creates distinct supported events with genuine entropy when randomUUID is unavailable`, () => {
  const snapshot = sourceSnapshot(fixture.sourceSnapshot)
  const input = { ...(kind === 'manual' ? { label: 'Manual food', amount: 60, unit: 'g', energyKcal: 0 } : lookupInput(snapshot, 250, 'mL')), day: '2026-11-14', meal: 'snack' }
  const context = { now: new Date('2026-11-14T12:00:00.000Z'), timeZone: 'UTC', ...(kind === 'manual' ? {} : { source: snapshot.source, externalId: snapshot.externalId, contentFingerprint: sourceFingerprint(snapshot), sourceSnapshot: snapshot }) }
  const native = vi.fn(webcrypto.randomUUID.bind(webcrypto)), entropy = vi.fn(webcrypto.getRandomValues.bind(webcrypto))
  vi.stubGlobal('crypto', { randomUUID: native, getRandomValues: entropy })
  const nativeEntry = createEntry(input, context)
  expect(native).toHaveBeenCalledTimes(1)
  expect(nativeEntry.id).toBe(native.mock.results[0].value)
  expect(entropy).not.toHaveBeenCalled()

  vi.stubGlobal('crypto', { getRandomValues: entropy })
  const first = createEntry(input, context), second = createEntry(input, context)
  expect(entropy).toHaveBeenCalledTimes(2)
  expect(new Set([nativeEntry.id, first.id, second.id]).size).toBe(3)
  const { id: nativeId, ...nativeData } = nativeEntry
  for (const entry of [nativeEntry, first, second]) {
    expect(entry.id).toMatch(v4)
    expect(normalizeEntry(entry).supported).toBe(true)
    const { id, ...data } = entry
    expect(data).toEqual(nativeData)
  }
  if (kind === 'confirmed lookup') {
    expect(first.sourceSnapshot).toEqual(snapshot)
    expect(first.sourceSnapshot).not.toBe(snapshot)
    expect(first.contentFingerprint).toBe(sourceFingerprint(snapshot))
    snapshot.label = 'Changed after confirmation'
    expect(first.sourceSnapshot.label).toBe(fixture.sourceSnapshot.label)
  }
})
