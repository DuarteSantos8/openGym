import { describe, it, expect } from 'vitest'
import { effortModeOf, cleanEffort, effortWord, autoEffort, setWorkoutEffort, AUTO_MIN_SETS } from './workout-effort.js'

const W = (sets, extra = {}) => ({
  id: 'w1', d: '2026-11-01', start: Date.parse('2026-11-01T10:00:00Z'), end: Date.parse('2026-11-01T11:00:00Z'),
  entries: [{ id: '0025', sets: sets.map(s => ({ w: 60, r: 8, done: true, ...s })) }],
  ...extra,
})

describe('effortModeOf', () => {
  it('asks unless the profile says otherwise', () => {
    expect(effortModeOf({})).toBe('ask')
    expect(effortModeOf(null)).toBe('ask')
    expect(effortModeOf({ workoutEffort: 'auto' })).toBe('auto')
    expect(effortModeOf({ workoutEffort: 'never' })).toBe('never')
    expect(effortModeOf({ workoutEffort: 'sometimes' })).toBe('ask')
  })
})

describe('cleanEffort', () => {
  it('keeps whole numbers from 1 to 10', () => {
    expect(cleanEffort(1)).toBe(1)
    expect(cleanEffort(10)).toBe(10)
    expect(cleanEffort(6.6)).toBe(7)
    expect(cleanEffort('8')).toBe(8)
  })
  it('turns everything else into null', () => {
    for (const v of [0, 11, -3, null, undefined, '', 'hard', NaN]) expect(cleanEffort(v)).toBe(null)
  })
})

describe('effortWord', () => {
  it('uses Apple Fitness’s bands', () => {
    expect([1, 3, 4, 6, 7, 8, 9, 10].map(effortWord)).toEqual(['Easy', 'Easy', 'Moderate', 'Moderate', 'Hard', 'Hard', 'All out', 'All out'])
    expect(effortWord(null)).toBe(null)
  })
})

describe('autoEffort', () => {
  it('averages the logged effort of the work sets on the RPE scale', () => {
    // RIR 2, 1, 0 → RPE 8, 9, 10 → 9
    const w = W([{ rir: 2 }, { rir: 1 }, { rir: 0 }])
    expect(autoEffort({ workouts: [w] }, w)).toBe(9)
    // RPE straight
    const r = W([{ rpe: 7 }, { rpe: 7 }, { rpe: 8 }])
    expect(autoEffort({ workouts: [r] }, r)).toBe(7)
  })

  it('leaves warm-ups and unticked sets out', () => {
    const w = W([{ rir: 6, warmup: true }, { rir: 1, done: false }, { rir: 2 }, { rir: 2 }, { rir: 2 }])
    expect(autoEffort({ workouts: [w] }, w)).toBe(8)
  })

  it('estimates the sets nobody rated, against the workout’s own best', () => {
    // No rating at all: the top set is the anchor, so it reads close to failure.
    const w = W([{ w: 100, r: 5 }, { w: 100, r: 5 }, { w: 100, r: 5 }])
    const v = autoEffort({ workouts: [w] }, w)
    expect(v).toBeGreaterThanOrEqual(8)
    expect(v).toBeLessThanOrEqual(10)
  })

  it('works for a workout not yet in the history (the one being finished)', () => {
    const w = W([{ rir: 3 }, { rir: 3 }, { rir: 3 }])
    expect(autoEffort({ workouts: [] }, w)).toBe(7)
  })

  it('gives none with too few sets to go by', () => {
    const w = W(Array.from({ length: AUTO_MIN_SETS - 1 }, () => ({ rir: 1 })))
    expect(autoEffort({ workouts: [w] }, w)).toBe(null)
    expect(autoEffort({ workouts: [] }, null)).toBe(null)
    expect(autoEffort({ workouts: [] }, { id: 'x', entries: [] })).toBe(null)
  })
})

describe('setWorkoutEffort', () => {
  it('puts the score and who gave it on the saved workout, stamped', () => {
    const s = { workouts: [W([])] }
    let stamped = null
    const w = setWorkoutEffort(s, 'w1', 7, 'watch', x => { stamped = x })
    expect(w).toBe(s.workouts[0])
    expect(w).toMatchObject({ effort: 7, effortBy: 'watch' })
    expect(stamped).toBe(w)
    setWorkoutEffort(s, 'w1', 4, 'anything')
    expect(s.workouts[0]).toMatchObject({ effort: 4, effortBy: 'phone' })
  })

  it('takes the score away again', () => {
    const s = { workouts: [W([], { effort: 5, effortBy: 'auto' })] }
    setWorkoutEffort(s, 'w1', null, 'phone')
    expect(s.workouts[0].effort).toBeUndefined()
    expect(s.workouts[0].effortBy).toBeUndefined()
  })

  it('does nothing for a workout that is not there', () => {
    expect(setWorkoutEffort({ workouts: [] }, 'nope', 5, 'phone')).toBe(null)
  })
})
