import { describe, it, expect } from 'vitest'
import { routineChangesFromEntry, updateRoutineFromEntry, ownWarmupsChange } from './routines.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'

const BENCH = '0025'
const warm = (w, r, extra = {}) => ({ w, r, done: true, phase: 'warmup', warmup: true, ...extra })
const work = (w = 60, r = 5) => ({ w, r, done: true })
const routineWith = slot => ({ id: 'R', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60, ...slot }] })
const entryWith = sets => [{ id: BENCH, rid: 'R', target: { sets: 3, reps: 5, weight: 60 }, sets }]

describe('keeping a session’s warm-ups in the routine (#525)', () => {
  it('an older ramp-set slot still counts its warm-ups', () => {
    const r = routineWith({ warmupSets: 1 })
    const found = routineChangesFromEntry(r, entryWith([warm(30, 5), warm(45, 5), work()]), 0, 20)
    expect(found.changes).toEqual([{ key: 'warmupSets', from: 1, to: 2 }])
  })
  it('a generated block you left alone offers nothing', () => {
    const r = routineWith({ warmup: 'auto' })
    expect(routineChangesFromEntry(r, entryWith([warm(20, 10, { wb: true }), warm(35, 3, { wp: 60 }), work()]), 0, 20)).toBeNull()
  })
  it('a generated block you changed is offered as your own, and saved as one', () => {
    const r = routineWith({ warmup: 'auto' })
    const entries = entryWith([warm(20, 12, { wb: true, edited: true }), warm(30, 8, { wp: 50 }), warm(40, 5, { edited: true }), work()])
    const found = routineChangesFromEntry(r, entries, 0, 20)
    expect(found.changes[0]).toEqual({ key: 'warmupRows', from: null, to: [{ wb: true, r: 12 }, { wp: 50, r: 8 }, { wp: 67, r: 5 }] })
    updateRoutineFromEntry(r, entries, 0, 20)
    expect(r.ex[0].warmup).toBe('own')
    expect(r.ex[0].warmupRows).toHaveLength(3)
    expect(r.ex[0].warmupSets).toBeUndefined()
    expect(routineChangesFromEntry(r, entries, 0, 20)).toBeNull()
  })
  it('“Keep these warm-ups” keeps them even untouched', () => {
    const slot = { id: BENCH }
    expect(ownWarmupsChange(slot, entryWith([warm(20, 10), warm(40, 5), work()])[0], 20, { force: true })).toEqual([{ wb: true, r: 10 }, { wp: 67, r: 5 }])
  })
})

describe('a shared routine carries its warm-ups', () => {
  it('the choice and the rows travel, junk does not', () => {
    const S = { unit: 'kg', routines: [routineWith({ warmup: 'own', warmupRows: [{ wb: true, r: 10 }, { wp: 140, r: 3 }, { nope: 1 }] })], week: {} }
    const file = buildPlanBundle(S, 'Push')
    const ex = file.routines[0].ex[0]
    expect(ex.warmup).toBe('own')
    expect(ex.warmupRows).toEqual([{ wb: true, r: 10 }, { wp: 95, r: 3 }])
    const back = parsePlan(JSON.stringify(file), 'kg')
    expect(back.routines[0].ex[0].warmupRows).toEqual([{ wb: true, r: 10 }, { wp: 95, r: 3 }])
  })
})
