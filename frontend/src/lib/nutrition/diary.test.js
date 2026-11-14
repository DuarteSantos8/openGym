import { expect, test } from 'vitest'
import { createEntry } from './entry.js'
import { addEntry, changeEntry, deleteEntry, undoEntry, diaryDays, dailyTotals, foodSuggestions } from './diary.js'
import { stampChange, mergeStates, visibleOptionalEntries } from '../sync-merge.js'
const ctx = { now: new Date('2026-11-14T10:00:00Z'), timeZone: 'UTC' }
const food = (patch = {}) => createEntry({ label: 'Oats', day: '2026-11-14', meal: 'breakfast', ...patch }, ctx)
const change = (prev, fn, at = 100) => { const s = structuredClone(prev); fn(s); s._ts = stampChange(prev, s, at); return s }
test('totals sum only supported known numbers and count missing per nutrient', () => {
  const S = { nutritionEntries: [food({ energyKcal: 0, proteinG: 1.234 }), food({ energyKcal: 100, proteinG: 2.345 }), food(), { id: 'future', schemaVersion: 99, day: '2026-11-14', energyKcal: 999 }] }
  expect(dailyTotals(S, '2026-11-14')).toMatchObject({ energyKcal: { value: 100, unknown: 2 }, proteinG: { value: 3.579, unknown: 2 }, fatG: { value: 0, unknown: 4 } })
  expect(diaryDays(S)['2026-11-14']).toHaveLength(4)
})
test('delete retains payload by id; totals and suggestions never use hidden rows; undo keeps field clocks', () => {
  const a = food({ energyKcal: 80 }), b = food({ label: 'Pear', energyKcal: 30 })
  const start = change({}, s => { addEntry(s, a); addEntry(s, b) })
  const removed = change(start, s => deleteEntry(s, a.id), 200)
  expect(removed.nutritionEntries).toHaveLength(2)
  expect(dailyTotals(removed, a.day).energyKcal.value).toBe(30)
  expect(foodSuggestions(removed).map(x => x.label)).toEqual(['Pear'])
  const other = change(start, s => changeEntry(s, a.id, { proteinG: 7 }), 300)
  const joined = mergeStates(removed, other)
  const restored = change(joined, s => undoEntry(s, a.id, [other]), 400)
  expect(visibleOptionalEntries(restored, 'nutritionEntries')).toHaveLength(2)
  expect(restored.nutritionEntries.find(e => e.id === a.id)).toMatchObject({ proteinG: 7, _f: joined.nutritionEntries.find(e => e.id === a.id)._f })
  expect(restored.deleted.nutritionEntries[a.id]).toBeLessThan(0)
})
test('recent/frequent are derived, deterministic, bounded and exclude future records', () => {
  const S = { nutritionEntries: [food(), food(), food({ label: 'Pear' }), { id: 'future', schemaVersion: 99, label: 'Future' }] }
  expect(foodSuggestions(S, { order: 'frequent', query: 'oa' }).map(x => x.label)).toEqual(['Oats'])
  expect(foodSuggestions(S, { limit: 1 })).toHaveLength(1)
})
test('no-op actions do not materialize the collection in a legacy profile', () => {
  const S = { workouts: [] }; const before = JSON.stringify(S)
  deleteEntry(S, 'missing'); undoEntry(S, 'missing'); changeEntry(S, 'missing', { label: 'x' })
  expect(JSON.stringify(S)).toBe(before)
})
test('invalid or missing days are visible as undated, without refiling records or inflating daily unknowns', () => {
  const rows = [
    { ...food(), schemaVersion: 2, day: '2026-99-99' },
    { ...food(), day: undefined },
    { ...food(), schemaVersion: 2, day: '2026-11-14' },
  ]
  const S = { nutritionEntries: rows }, before = JSON.stringify(S)
  expect(diaryDays(S)['']).toEqual(rows.slice(0, 2))
  expect(diaryDays(S)['2026-11-14']).toEqual([rows[2]])
  expect(dailyTotals(S, '2026-11-14').energyKcal.unknown).toBe(1)
  expect(dailyTotals(S, '2026-11-15').energyKcal.unknown).toBe(0)
  expect(JSON.stringify(S)).toBe(before)
})
