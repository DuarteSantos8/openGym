import { afterEach, expect, it } from 'vitest'
import { normalizeAliases, registerExerciseAliases } from './exercise-aliases.js'
import { CATALOGUE, searchExercises, searchScore } from './exercises.js'
import { stampEdits, mergeStates, sinceReset } from './sync-merge.js'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'

afterEach(() => registerExerciseAliases({}))
it('normalizes bounded text without accepting malformed imported values', () => {
  expect(normalizeAliases(' OHP, overhead press, ohp,\n Military press ')).toEqual(['OHP', 'overhead press', 'Military press'])
  expect(normalizeAliases([null, {}, 42, ' x ', 'X'])).toEqual(['x'])
  expect(normalizeAliases({ bad: true })).toEqual([])
  expect(normalizeAliases(['x'.repeat(100)])[0]).toHaveLength(80)
  expect(normalizeAliases(Array.from({ length: 30 }, (_, i) => String(i)))).toHaveLength(20)
})
it('updates cached built-in search immediately, clears aliases and isolates profiles', () => {
  const ex = CATALOGUE.find(e => e.id === '1162')
  const original = structuredClone(ex)
  expect(searchExercises([ex], 'my special lift')).toEqual([])
  registerExerciseAliases({ [ex.id]: ['my special lift'] })
  expect(searchExercises([ex], 'my special lift')).toEqual([ex])
  expect(searchScore(ex, 'my special lift')).toBeGreaterThan(0)
  registerExerciseAliases({ [ex.id]: [] })
  expect(searchExercises([ex], 'my special lift')).toEqual([])
  registerExerciseAliases(null)
  expect(ex).toEqual(original)
})
it('finds custom aliases without changing the primary name or identity', () => {
  const ex = { id: 'c1', n: 'My press', aliases: ['Viking lift'], custom: true }
  expect(searchExercises([ex], 'Viking lift')).toEqual([ex])
  expect(searchScore(ex, 'Viking lift')).toBeGreaterThan(0)
})
it('merges different exercise edits and preserves an explicit clear against stale devices', () => {
  const before = { _ts: 1, exAliases: { a: ['Old'] } }
  const a = { _ts: 2, exAliases: { a: [] } }
  const b = { _ts: 3, exAliases: { a: ['Old'], b: ['Row'] } }
  stampEdits(before, a, 20)
  stampEdits(before, b, 30)
  for (const [left, right] of [[a, b], [b, a]]) {
    const merged = mergeStates(left, right)
    expect(merged.exAliases).toEqual({ a: [], b: ['Row'] })
    expect(JSON.parse(JSON.stringify(merged)).exAliases).toEqual(merged.exAliases)
  }
  expect(sinceReset(a, 100).exAliases).toEqual({})
})
it('preserves custom aliases in a shared plan', () => {
  const source = { unit: 'kg', week: {}, routines: [{ id: 'r1', name: 'A', ex: [{ id: 'c1', sets: 3, reps: 8 }] }],
    customEx: [{ id: 'c1', n: 'My press', bp: 'shoulders', eq: 'barbell', aliases: ['Viking lift'] }] }
  const bundle = buildPlanBundle(source)
  expect(bundle.customEx[0].aliases).toEqual(['Viking lift'])
  const target = { unit: 'kg', routines: [], customEx: [], week: {} }
  mergePlan(target, parsePlan(JSON.stringify(bundle)))
  expect(target.customEx[0].aliases).toEqual(['Viking lift'])
})
