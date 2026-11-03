// A machine's own weight stack (issue #688): the weights a LifeFitness fly really has (5, 11.3,
// 18.1 …), listed on the exercise. Progression, deloads, the Epley target, warm-ups, drops and the
// + and − buttons land on them, the same way the dumbbell inventory (#376) works for dumbbells.
import { describe, expect, it } from 'vitest'
import {
  stackOf, withStack, canHaveStack, ownedWeightsFor, ownedKindFor, stackFromStep, cleanWeights,
} from './dumbbells.js'
import { nextPrescription } from './progression.js'
import { buildPlannedEntry } from './session-start.js'
import { dropGrid } from './plates.js'
import { nextDropWeight } from './workout-model.js'
import { mergeStates, STAMPED_MAPS } from './sync-merge.js'
import { STAMPED_MAPS as API_STAMPED_MAPS } from '../../../api/sync-stamps.js'
import { EXIDX } from './exercises.js'

const FLY = '0596'       // lever seated fly
const PUSHDOWN = '0201'  // cable pushdown
const DIP = '0009'       // assisted chest dip (a leverage machine, but help, not load)
const CURL = '0294'      // dumbbell curl
const SQUAT = '0043'     // barbell
// The odd steps from the issue: no increment fits them.
const STACK = [5, 11.3, 18.1, 24.9, 31.7, 38.5, 45.3]

const state = (workouts = [], extra = {}) => ({
  unit: 'kg', workouts, routines: [], exWeights: {},
  stackWeights: { [FLY]: { unit: 'kg', weights: STACK, _ts: 1 } }, ...extra,
})
const session = (d, id, w, reps, target = {}) => ({
  id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(),
  entries: [{ id, target: { sets: 2, reps: 8, mode: 'reps', ...target }, sets: reps.map(r => ({ w, r, done: true })) }],
})
const cfg = (id, extra = {}) => ({ id, sets: 2, reps: 8, weight: 0, mode: 'reps', inc: 2.5, ...extra })

describe('the stack', () => {
  it('the exercises used here are what the test assumes', () => {
    expect(EXIDX[FLY].eq).toBe('leverage machine')
    expect(EXIDX[PUSHDOWN].eq).toBe('cable')
    expect(EXIDX[DIP].n).toMatch(/assisted/)
    expect(EXIDX[CURL].eq).toBe('dumbbell')
  })

  it('is offered on machines, cables and your own exercises, not on bars, bells or assistance', () => {
    expect(canHaveStack(FLY)).toBe(true)
    expect(canHaveStack(PUSHDOWN)).toBe(true)
    expect(canHaveStack({ id: 'c1', n: 'My hip thrust machine', custom: true, eq: 'custom' })).toBe(true)
    expect(canHaveStack(DIP)).toBe(false)
    expect(canHaveStack(CURL)).toBe(false)
    expect(canHaveStack(SQUAT)).toBe(false)
  })

  it('is kept per exercise in the unit it was entered in, sorted and stamped', () => {
    const next = withStack({ unit: 'kg' }, FLY, [18.1, 5, 11.3, 5, -2], 7)
    expect(next[FLY]).toEqual({ unit: 'kg', weights: [5, 11.3, 18.1], _ts: 7 })
    expect(stackOf({ unit: 'kg', stackWeights: next }, FLY)).toEqual([5, 11.3, 18.1])
    // A cleared list is a stamped entry, so the clear wins a sync against the older list.
    const cleared = withStack({ unit: 'kg', stackWeights: next }, FLY, [], 8)
    expect(cleared[FLY]).toEqual({ _ts: 8 })
    expect(stackOf({ unit: 'kg', stackWeights: cleared }, FLY)).toEqual([])
  })

  it('a profile switched to lb reads the kg stack converted, so the plates on the machine stay what they are', () => {
    const S = { unit: 'lb', stackWeights: { [FLY]: { unit: 'kg', weights: [5, 11.3], _ts: 1 } } }
    expect(stackOf(S, FLY)).toEqual([11, 24.9])
  })

  it('builds an even stack from a first weight, a step and a count, for the quick fill', () => {
    expect(stackFromStep(5, 6.8, 4)).toEqual([5, 11.8, 18.6, 25.4])
    expect(stackFromStep(0, 5, 3)).toEqual([5, 10, 15])
    expect(stackFromStep(5, 0, 3)).toEqual([])
    expect(cleanWeights(stackFromStep(2.5, 2.5, 200)).length).toBe(100)
  })

  it('is what ownedWeightsFor answers for that exercise, and nothing else changes', () => {
    const S = state()
    expect(ownedWeightsFor(S, cfg(FLY))).toEqual(STACK)
    expect(ownedKindFor(S, cfg(FLY))).toBe('stack')
    expect(ownedWeightsFor(S, cfg(PUSHDOWN))).toBe(null)
    expect(ownedKindFor(S, cfg(PUSHDOWN))).toBe(null)
    // A stray list on an assistance machine is never used: there the stack is help, not load.
    const dip = state([], { stackWeights: { [DIP]: { unit: 'kg', weights: STACK, _ts: 1 } } })
    expect(ownedWeightsFor(dip, cfg(DIP))).toBe(null)
  })

  it('wins over the dumbbell rack on the exercise it was set on', () => {
    const S = state([], { dumbbells: { kg: { weights: [2, 4, 6], _ts: 1 } }, stackWeights: { [CURL]: { unit: 'kg', weights: [7, 9], _ts: 1 } } })
    expect(ownedWeightsFor(S, cfg(CURL))).toEqual([7, 9])
    expect(ownedKindFor(S, cfg(CURL))).toBe('stack')
  })
})

describe('progression over the stack', () => {
  it('raises to the next weight on the stack, not by the increment', () => {
    const S = state([session('2026-10-01', FLY, 18.1, [8, 8])])
    const p = nextPrescription(S, cfg(FLY), null)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(24.9)
  })

  it('without a list, the increment decides as before', () => {
    const S = state([session('2026-10-01', FLY, 18.1, [8, 8])], { stackWeights: {} })
    expect(nextPrescription(S, cfg(FLY), null).weight).toBe(20.6)
  })

  it('holds at the heaviest plate of the stack and says it is the stack, not a dumbbell', () => {
    const S = state([session('2026-10-01', FLY, 45.3, [8, 8])])
    const p = nextPrescription(S, cfg(FLY), null)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(45.3)
    expect(p.why[0]).toMatch(/whole stack/)
    expect(p.why[0]).not.toMatch(/dumbbell/)
  })

  it('the Epley deload after three stalls lands on the stack', () => {
    const S = state(['2026-10-01', '2026-10-03', '2026-10-05'].map(d => session(d, FLY, 31.7, [8, 5])))
    const p = nextPrescription(S, cfg(FLY), null)
    expect(p.kind).toBe('deload')
    expect(STACK).toContain(p.weight)
    expect(p.weight).toBeLessThan(31.7)
  })
})

describe('warm-ups and drops over the stack', () => {
  it('ramps the warm-up onto a weight the stack has', () => {
    const S = state([session('2026-10-01', FLY, 31.7, [8, 6])])
    const built = buildPlannedEntry(S, cfg(FLY, { warmupSets: 1 }), null)
    const warm = built.sets.find(s => s.phase === 'warmup')
    expect(built.sets.at(-1).w).toBe(31.7)
    expect(STACK).toContain(warm.w)
  })

  it('drops onto the stack', () => {
    const grid = dropGrid(state(), cfg(FLY))
    expect(STACK).toContain(nextDropWeight(31.7, 20, grid))
  })
})

describe('sync and backups', () => {
  it('is a stamped map on both sides of the sync, kept per exercise', () => {
    expect(STAMPED_MAPS).toContain('stackWeights')
    expect(API_STAMPED_MAPS).toContain('stackWeights')
    const a = { ...state(), _ts: 10, stackWeights: { [FLY]: { unit: 'kg', weights: [5, 10], _ts: 10 } } }
    const b = { ...state(), _ts: 20, stackWeights: { [FLY]: { unit: 'kg', weights: [7], _ts: 5 }, [PUSHDOWN]: { unit: 'kg', weights: [4.5, 9], _ts: 4 } } }
    const merged = mergeStates(a, b)
    expect(merged.stackWeights[FLY]).toEqual({ unit: 'kg', weights: [5, 10], _ts: 10 })
    expect(merged.stackWeights[PUSHDOWN]).toEqual({ unit: 'kg', weights: [4.5, 9], _ts: 4 })
  })

  it('a backup from before stacks, or a broken entry, reads as no stack', () => {
    expect(stackOf({ unit: 'kg' }, FLY)).toEqual([])
    expect(stackOf({ unit: 'kg', stackWeights: { [FLY]: 'junk' } }, FLY)).toEqual([])
    expect(stackOf({ unit: 'kg', stackWeights: { [FLY]: { weights: 'x' } } }, FLY)).toEqual([])
    expect(ownedWeightsFor({ unit: 'kg', stackWeights: null }, cfg(FLY))).toBe(null)
  })
})
