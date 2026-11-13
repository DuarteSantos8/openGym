import { test, expect } from 'vitest'
import { mergeStates } from './sync-merge.js'
import { stampPut } from '../../../api/sync-stamps.js'
import { stateJson } from './state-json.js'
const old = () => ({ unit: 'kg', _ts: 10, futureSetting: { answer: 42 }, routines: [{ id: 'r', name: 'Push', ex: [], futureField: 'kept' }] })
test('unstamped API writers preserve unknown top-level and known-collection entry fields', () => {
  const next = { unit: 'kg', _ts: 20, routines: [{ id: 'r', name: 'Pull', ex: [] }] }
  stampPut(old(), next, { overRead: true, now: 30 })
  expect(next.futureSetting).toEqual({ answer: 42 })
  expect(next.routines[0].futureField).toBe('kept')
})
test('stamped API writers currently own their omissions for arbitrary unknown fields', () => {
  const next = { unit: 'kg', _ts: 20, routines: [{ id: 'r', name: 'Pull', ex: [] }] }
  stampPut(old(), next, { stamped: true, now: 30 })
  expect(next.futureSetting).toBeUndefined()
  expect(next.routines[0].futureField).toBeUndefined()
})
test('a stamped unknown top-level edit survives current client conflict merging', () => {
  const remote = old(); remote.edited = { futureSetting: 10 }
  expect(mergeStates({ unit: 'kg', _ts: 20, routines: [] }, remote).futureSetting).toEqual({ answer: 42 })
})
test('legacy serialized JSON is byte-for-byte stable on an untouched load/save', () => {
  const text = JSON.stringify(old())
  expect(stateJson(JSON.parse(text))).toBe(text)
})
