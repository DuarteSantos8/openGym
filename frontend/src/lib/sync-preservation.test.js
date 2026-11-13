import { test, expect } from 'vitest'
import { mergeStates } from './sync-merge.js'
test('a 409 merge preserves an unstamped unknown top-level field missing on the newer device', () => {
  expect(mergeStates({ _ts: 20 }, { _ts: 10, futureSetting: { answer: 42 } }).futureSetting).toEqual({ answer: 42 })
})
test('a 409 merge preserves an unknown entry field unless its omission was stamped', () => {
  const old = { routines: [{ id: 'r', name: 'Push', ex: [], futureField: 42 }] }
  const newer = { _ts: 20, routines: [{ id: 'r', name: 'Pull', ex: [], _ts: 20 }] }
  expect(mergeStates(newer, old).routines[0].futureField).toBe(42)
  newer.routines[0]._f = { futureField: 20 }
  expect(mergeStates(newer, old).routines[0].futureField).toBeUndefined()
})
test('explicit top-level deletion still wins', () => {
  expect(mergeStates({ _ts: 20, edited: { futureSetting: 20 } }, { _ts: 10, futureSetting: 42 }).futureSetting).toBeUndefined()
})
