import { describe, it, expect } from 'vitest'
import { loadOfWorkouts, loadOfRoutine, loadOfWeeklyPlan, sessionLoad, setCoefficientOf } from './muscles.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { workoutVolume, setsDone } from './history.js'

const bench = { id: '0025', sets: 3, reps: 10, weight: 40, prog: 'off' }
const state = routine => ({ unit: 'kg', exWeights: {}, workouts: [], routines: [routine], week: { 1: routine.id }, dayPlan: {} })

describe('set coefficients (#771)', () => {
  it('defaults old or invalid values to one, preserving zero and fractional overrides', () => {
    for (const setCoefficient of [undefined, null, -1, NaN, Infinity, '0.3', true]) {
      expect(setCoefficientOf({ setCoefficient })).toBe(1)
    }
    expect(setCoefficientOf({}, { setCoefficient: 0.3 })).toBe(0.3)
    expect(setCoefficientOf({ setCoefficient: 0 }, { setCoefficient: 0.3 })).toBe(0)
    expect(setCoefficientOf({ setCoefficient: 1 }, { setCoefficient: 0.3 })).toBe(1)
  })

  it('weights the weekly plan and freezes the exercise coefficient at session start', () => {
    const routine = { id: 'r', ex: [{ ...bench, setCoefficient: 0.3 }] }
    const st = state(routine)
    expect(loadOfRoutine(routine).chest).toBeCloseTo(0.9)
    expect(loadOfWeeklyPlan(st).chest).toBeCloseTo(0.9)
    const entries = buildSessionEntries(st, routine)
    expect(sessionLoad(entries).planned.chest).toBeCloseTo(0.9)
    expect(sessionLoad(entries).done).toEqual({})
    routine.ex[0].setCoefficient = 2
    expect(sessionLoad(entries).planned.chest).toBeCloseTo(0.9)
  })

  it('keeps set overrides through finish and JSON export, counting only completed work', () => {
    const routine = { id: 'r', ex: [{ ...bench, setCoefficient: 0.3 }] }
    const entries = buildSessionEntries(state(routine), routine)
    entries[0].sets = [
      { w: 40, r: 10, done: true },
      { w: 40, r: 10, done: true, setCoefficient: 1 },
      { w: 40, r: 10, done: true, setCoefficient: 0 },
      { w: 40, r: 10, done: false, setCoefficient: 5 },
      { w: 20, r: 5, done: true, phase: 'warmup', setCoefficient: 5 },
    ]
    const saved = JSON.parse(JSON.stringify(buildCompletedWorkout({ id: 'w', d: '2026-10-26', start: 1000, entries }, { end: 2000 })))
    expect(loadOfWorkouts([saved]).chest).toBeCloseTo(1.3)
    expect(loadOfWorkouts([saved]).triceps).toBeCloseTo(1.3 * 0.4)
    expect(sessionLoad(entries).done.chest).toBeCloseTo(1.3)
    expect(loadOfWorkouts([saved], s => s.setCoefficient === 1).chest).toBe(1)
    // This is a muscle-volume estimate, not a change to logged work or tonnage.
    expect(setsDone(saved)).toBe(4)
    expect(workoutVolume(saved)).toBe(1200)
  })

  it('preserves historical totals and allows a coefficient greater than one', () => {
    const workout = { entries: [{ id: bench.id, sets: [{ done: true }, { done: true }] }] }
    expect(loadOfWorkouts([workout]).chest).toBe(2)
    workout.entries[0].target = { setCoefficient: 1.5 }
    expect(loadOfWorkouts([workout]).chest).toBe(3)
  })
})
