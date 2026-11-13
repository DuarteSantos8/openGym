import { describe, expect, it } from 'vitest'
import { applyResultSet, placeResult } from './assign.js'

const active = (cur, ...ids) => ({ cur, entries: ids.map(id => ({ id, sets: [] })) })

describe('placeResult', () => {
  it('the exercise you are on: no question', () => {
    expect(placeResult(active(1, 'a', '2138'), '2138')).toEqual({ kind: 'current', idx: 1 })
  })
  it('the session has it further down: asked', () => {
    expect(placeResult(active(0, 'a', '2138'), '2138')).toEqual({ kind: 'inWorkout', idx: 1 })
  })
  it('not in the session: offered', () => {
    expect(placeResult(active(0, 'a'), '2138')).toEqual({ kind: 'notInWorkout' })
  })
  it('no session, no exercise', () => {
    expect(placeResult(null, '2138')).toEqual({ kind: 'none' })
    expect(placeResult(active(0, 'a'), null)).toEqual({ kind: 'none' })
  })
})

describe('applyResultSet', () => {
  const set = { min: 30, speed: 25, done: true, lf: 'g' }
  it('fills the planned set waiting to be done', () => {
    const e = { sets: [{ min: 20, speed: 20, done: true }, { min: 30, speed: 22 }, { min: 30, speed: 22 }] }
    expect(applyResultSet(e, set)).toBe(1)
    expect(e.sets[1]).toEqual(set)
    expect(e.sets).toHaveLength(3)
  })
  it('skips an open warm-up set', () => {
    const e = { sets: [{ min: 5, phase: 'warmup' }, { min: 30 }] }
    expect(applyResultSet(e, set)).toBe(1)
  })
  it('all done: added after them', () => {
    const e = { sets: [{ min: 20, done: true }] }
    expect(applyResultSet(e, set)).toBe(1)
    expect(e.sets).toHaveLength(2)
  })
  it('an entry without sets gets one; no entry is -1', () => {
    const e = {}
    expect(applyResultSet(e, set)).toBe(0)
    expect(applyResultSet(null, set)).toBe(-1)
  })
})
