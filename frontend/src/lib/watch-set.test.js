import { describe, expect, it } from 'vitest'
import { currentSetFor } from './watch-set.js'
import { EXIDX } from './exercises.js'
import { exerciseNameFor } from './i18n-core.js'

const SQUAT = '3593'
const DB_BENCH = '0289'
const row = (over = {}) => ({ w: 100, r: 5, done: false, ...over })
const ex = (id, sets, over = {}) => ({ id, target: { sets: sets.length, reps: 5 }, sets, ...over })
const state = (active, over = {}) => ({ unit: 'kg', active: { id: 'w1', cur: 0, ...active }, ...over })
const name = id => exerciseNameFor(EXIDX[id])

describe('currentSetFor', () => {
  it('is null without a live workout or with nothing open', () => {
    expect(currentSetFor({})).toBeNull()
    expect(currentSetFor({ active: null })).toBeNull()
    expect(currentSetFor(state({ entries: [ex(SQUAT, [row({ done: true })])] }))).toBeNull()
    expect(currentSetFor(state({ backfill: true, entries: [ex(SQUAT, [row()])] }))).toBeNull()
    expect(currentSetFor(state({ editingWorkoutId: 'x', entries: [ex(SQUAT, [row()])] }))).toBeNull()
  })

  it('is the first open set of the marked exercise', () => {
    const S = state({ entries: [ex(SQUAT, [row({ done: true }), row({ w: 102.5 }), row()]), ex(DB_BENCH, [row({ w: 30, r: 10 })])] })
    expect(currentSetFor(S)).toEqual({
      id: 'w1', entryId: SQUAT, name: name(SQUAT), idx: 0, i: 1, setNo: 2, setCount: 3, warmup: false,
      mode: 'reps', w: 102.5, r: 5, unit: 'kg', each: false, inc: 5, nextName: name(DB_BENCH),
    })
  })

  it('counts work sets apart from the warm-up', () => {
    const S = state({ entries: [ex(SQUAT, [row({ warmup: true, done: true }), row({ warmup: true }), row(), row()])] })
    expect(currentSetFor(S)).toMatchObject({ i: 1, setNo: 2, setCount: 2, warmup: true, nextName: null })
    S.active.entries[0].sets[1].done = true
    expect(currentSetFor(S)).toMatchObject({ i: 2, setNo: 1, setCount: 2, warmup: false })
  })

  it('moves on to the next unfinished exercise once the marked one is done', () => {
    const S = state({ entries: [ex(SQUAT, [row({ done: true })]), ex(DB_BENCH, [row({ w: 30, r: 10, done: true }), row({ w: 30, r: 10 })])] })
    expect(currentSetFor(S)).toMatchObject({ entryId: DB_BENCH, idx: 1, i: 1, setNo: 2, w: 30, r: 10, nextName: null })
  })

  it('stays in the superset before the next unit', () => {
    const S = state({ cur: 0, entries: [ex(SQUAT, [row({ done: true })], { sg: 'a' }), ex(DB_BENCH, [row()], { sg: 'a' }), ex(SQUAT, [row()])] })
    expect(currentSetFor(S)).toMatchObject({ idx: 1, entryId: DB_BENCH })
  })

  it('reads a dumbbell load per hand and the unit and step of the profile', () => {
    const S = state({ entries: [ex(DB_BENCH, [row({ w: 22 })], { target: { sets: 1, reps: 10, dbLoad: 'each', inc: 1 } })] }, { unit: 'lb' })
    expect(currentSetFor(S)).toMatchObject({ each: true, unit: 'lb', inc: 1, w: 22 })
  })

  it('names the mode of a set the watch cannot log', () => {
    const S = state({ entries: [ex('plank-x', [{ sec: 30, done: false }], { n: 'Plank', target: { mode: 'time', sec: 30 } })] })
    expect(currentSetFor(S)).toMatchObject({ mode: 'time', name: 'Plank', w: 0, r: 0 })
  })
})
