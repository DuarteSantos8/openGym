import { test, expect } from 'vitest'
import nutrition from './__fixtures__/contracts/nutrition-entry.json'
import sourced from './__fixtures__/contracts/nutrition-source-entry.json'
import { sourceFingerprint, sourceSnapshot } from './nutrition/food-source.js'
import activity from './__fixtures__/contracts/activity.json'
import link from './__fixtures__/contracts/provider-link.json'
import deleted from './__fixtures__/contracts/tombstoned-profile.json'
import older from './__fixtures__/contracts/older-nutrition-entry.json'
import { mergeStates, stampOptionalCollections, visibleOptionalEntries } from './sync-merge.js'
import { stateJson } from './state-json.js'

test('confirmed source fixture retains original ml basis and fingerprint across serialization', () => {
  const restored = JSON.parse(stateJson({ nutritionEntries: [sourced] })).nutritionEntries[0]
  expect(restored).toEqual(sourced)
  expect(sourceSnapshot(restored.sourceSnapshot)).toEqual(restored.sourceSnapshot)
  expect(sourceFingerprint(restored.sourceSnapshot)).toBe(restored.contentFingerprint)
  expect(restored.amountMl).toBe(250)
  expect(restored.energyKcal).toBe(100)
  expect(restored).not.toHaveProperty('amountG')
  expect(restored).not.toHaveProperty('fatG')
})

test('canonical fixtures round-trip without changing units, provenance, unknown fields or tombstones', () => {
  const S = { ...deleted, activities: [activity], providerLinks: [link], workouts: [], unit: 'lb' }
  const restored = JSON.parse(stateJson(S))
  expect(restored).toEqual(S)
  const merged = mergeStates(restored, { unit: 'kg', workouts: [], _ts: 1, nutritionEntries: [older] })
  expect(visibleOptionalEntries(merged, 'nutritionEntries')).toEqual([])
  expect(merged.activities[0].distanceM).toBe(5000)
  expect(merged.activities[0].contentFingerprint).toBe(activity.contentFingerprint)
  expect(merged.providerLinks[0].serverConnectionId).toBe(link.serverConnectionId)
})
test('an older schema can be read without silently filling missing nutrients with zero', () => {
  const merged = mergeStates({ nutritionEntries: [nutrition] }, { nutritionEntries: [older] })
  expect(merged.nutritionEntries[0].schemaVersion).toBe(1)
  expect(older.proteinG).toBeUndefined()
  expect(merged.nutritionEntries[0].proteinG).toBe(8)
})
test('optional hooks do not add any key or change serialized bytes in a legacy profile', () => {
  const text = '{"unit":"kg","workouts":[],"routines":[],"modules":{"body":false},"_ts":42}'
  const saved = JSON.parse(text), next = JSON.parse(text)
  stampOptionalCollections(saved, next, 43)
  expect(stateJson(next)).toBe(text)
})
