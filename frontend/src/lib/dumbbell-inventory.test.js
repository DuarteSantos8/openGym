// The dumbbells you own (issue #376): a per-unit list that progression, deloads, warm-ups, drops
// and the stepper of dumbbell lifts snap to. Without one, everything stays on the increment.
import { describe, expect, it } from 'vitest'
import {
  presetWeights, cleanWeights, dumbbellsOf, ownsDumbbells, withDumbbells, ownedWeightsFor,
  ownedUp, ownedDown, ownedFloor, stepOwned, ownedDeload, ownedAround, withDbLoad,
} from './dumbbells.js'
import { startMigratedFixture } from './test-fixtures.js'
import { dropGrid } from './plates.js'
import { nextDropWeight } from './workout-model.js'
import { mergeStates } from './sync-merge.js'
import { EXIDX } from './exercises.js'

const CURL = '0294'      // dumbbell biceps curl
const BENCH = '0289'     // dumbbell bench press
const ROW = '0292'       // dumbbell one arm bent-over row
const KB = '0517'        // kettlebell
const SQUAT = '0043'     // barbell
// The adjustable set from the issue: irregular steps no increment fits.
const RACK = [3, 6, 8, 9, 11, 13, 15, 17, 18, 19, 21, 24]

const state = (workouts = [], extra = {}) => ({ unit: 'kg', workouts, routines: [], exWeights: {}, dumbbells: { kg: { weights: RACK, _ts: 1 } }, ...extra })
const session = (d, id, w, reps, target = {}) => ({
  id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(),
  entries: [{ id, target: { sets: 2, reps: 8, mode: 'reps', ...target }, sets: reps.map(r => ({ w, r, done: true })) }],
})
const cfg = (id, extra = {}) => ({ id, sets: 2, reps: 8, weight: 0, mode: 'reps', inc: 2, ...extra })

describe('the inventory', () => {
  it('the exercises used here are what the test assumes', () => {
    expect(EXIDX[CURL].eq).toBe('dumbbell')
    expect(EXIDX[BENCH].eq).toBe('dumbbell')
    expect(EXIDX[ROW].n).toMatch(/one arm/)
    expect(EXIDX[KB].eq).toBe('kettlebell')
    expect(EXIDX[SQUAT].eq).toBe('barbell')
  })

  it('offers the usual racks as quick fills', () => {
    const kg = presetWeights('kg')
    expect(kg[0]).toBe(2)
    expect(kg.at(-1)).toBe(50)
    expect(kg).toHaveLength(25)
    const lb = presetWeights('lb')
    expect([lb[0], lb[1], lb.at(-1)]).toEqual([5, 10, 100])
  })

  it('is kept per unit, sorted, without doubles or junk, and stamped', () => {
    expect(cleanWeights([9, '3', 9, -1, 0, 'x', 6.5])).toEqual([3, 6.5, 9])
    const S = { unit: 'kg', dumbbells: { lb: { weights: [5, 10], _ts: 1 } } }
    const next = withDumbbells(S, [21, 3, 9], 7)
    expect(next.kg).toEqual({ weights: [3, 9, 21], _ts: 7 })
    expect(next.lb).toEqual({ weights: [5, 10], _ts: 1 })
    expect(dumbbellsOf({ ...S, dumbbells: next })).toEqual([3, 9, 21])
    // An empty list is no inventory again, stamped so the clear wins a sync too.
    const cleared = withDumbbells({ ...S, dumbbells: next }, [], 8)
    expect(cleared.kg).toEqual({ weights: [], _ts: 8 })
    expect(ownsDumbbells({ unit: 'kg', dumbbells: cleared })).toBe(false)
    // A profile switched to lb sees its lb list, not a conversion of the kg one.
    expect(dumbbellsOf({ unit: 'lb', dumbbells: next })).toEqual([5, 10])
  })

  it('applies to loaded dumbbell lifts only', () => {
    const S = state()
    expect(ownedWeightsFor(S, { id: CURL })).toEqual(RACK)
    expect(ownedWeightsFor(state([], { dumbbells: {} }), { id: CURL })).toBe(null)
    expect(ownedWeightsFor(S, { id: SQUAT })).toBe(null)
    expect(ownedWeightsFor(S, { id: KB })).toBe(null)
    expect(ownedWeightsFor(S, { id: CURL, bodyweight: true })).toBe(null)
  })

  it('moves in pairs when two bells are logged together', () => {
    const S = state([], { dbLoad: withDbLoad({}, BENCH, 'total', 1) })
    expect(ownedWeightsFor(S, { id: BENCH })).toEqual(RACK.map(w => w * 2))
    expect(ownedWeightsFor(S, { id: BENCH, dbLoad: 'each' })).toEqual(RACK)
    // One arm holds one bell, whatever the meaning.
    expect(ownedWeightsFor(S, { id: ROW, dbLoad: 'total' })).toEqual(RACK)
  })
})

describe('walking the list', () => {
  it('finds the neighbours, from on and off the list', () => {
    expect(ownedUp(RACK, 21)).toBe(24)
    expect(ownedUp(RACK, 10)).toBe(11)
    expect(ownedUp(RACK, 9, 2)).toBe(13)
    expect(ownedUp(RACK, 24)).toBe(null)
    expect(ownedDown(RACK, 9)).toBe(8)
    expect(ownedDown(RACK, 3)).toBe(null)
    expect(ownedFloor(RACK, 10.5)).toBe(9)
    expect(ownedFloor(RACK, 1)).toBe(3)
  })

  it('steps like a stepper and stops at either end', () => {
    expect(stepOwned(RACK, 6, 1)).toBe(8)
    expect(stepOwned(RACK, 6, -1)).toBe(3)
    expect(stepOwned(RACK, 24, 1)).toBe(24)
    expect(stepOwned(RACK, 3, -1)).toBe(3)
    expect(stepOwned(RACK, 10, 1)).toBe(11)
    expect(stepOwned(RACK, 10, -1)).toBe(9)
  })

  it('deloads to the owned bell nearest the target, below the current one', () => {
    expect(ownedDeload(RACK, 21, 0.9)).toBe(19)
    expect(ownedDeload(RACK, 3, 0.9)).toBe(3)
    expect(ownedAround(10, RACK, 21, true)).toEqual([9, 11])
    expect(ownedAround(22, RACK, 21, true)).toEqual([19])
  })
})


describe('warm-ups and drops over owned dumbbells', () => {
  it('ramps the warm-up onto the heaviest bell under the rung', () => {
    const S = state([session('2026-10-01', CURL, 21, [8, 6])])
    const built = startMigratedFixture(S, { ex: [cfg(CURL, { warmupSets: 1 })] }).entries[0]
    const warm = built.sets.find(s => s.phase === 'warmup')
    expect(built.sets.at(-1).w).toBe(21)
    expect(warm.w).toBe(17)
  })

  it('drops onto a bell you own', () => {
    const grid = dropGrid(state(), cfg(CURL))
    expect(nextDropWeight(21, 20, grid)).toBe(15)
    // A barbell keeps its own rule.
    expect(typeof dropGrid(state(), cfg(SQUAT))).not.toBe('function')
  })
})

describe('sync', () => {
  it('keeps the list of a unit last edited on either device, whole', () => {
    const a = { ...state(), _ts: 10, dumbbells: { kg: { weights: [3, 6], _ts: 10 } } }
    const b = { ...state(), _ts: 20, dumbbells: { kg: { weights: [9, 11], _ts: 5 }, lb: { weights: [10], _ts: 4 } } }
    const merged = mergeStates(a, b)
    expect(merged.dumbbells.kg).toEqual({ weights: [3, 6], _ts: 10 })
    expect(merged.dumbbells.lb).toEqual({ weights: [10], _ts: 4 })
  })
})
