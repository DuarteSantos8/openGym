import { describe, it, expect } from 'vitest'
import { effortModeOf, cleanEffort, effortWord, autoEffort, setWorkoutEffort, AUTO_MIN_SETS, SESSION_OFFSET } from './workout-effort.js'

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
    expect([1, 3, 4, 6, 7, 8, 9, 10].map(effortWord)).toEqual(['Easy', 'Easy', 'Moderate', 'Moderate', 'Hard effort', 'Hard effort', 'All out', 'All out'])
    expect(effortWord(null)).toBe(null)
  })
})

describe('autoEffort', () => {
  it('averages the logged effort of the work sets on the RPE scale, less the session offset', () => {
    // RIR 2, 1, 0 → RPE 8, 9, 10 → 9, less 1.5 → 7.5, a half: the easier word
    const w = W([{ rir: 2 }, { rir: 1 }, { rir: 0 }])
    expect(autoEffort({ workouts: [w] }, w)).toBe(7)
    // RPE straight: 7.33 less 1.5 → 6
    const r = W([{ rpe: 7 }, { rpe: 7 }, { rpe: 8 }])
    expect(autoEffort({ workouts: [r] }, r)).toBe(6)
  })

  it('reads a session the way people rate one: RIR 2 Moderate, RIR 1 Hard, RIR 3 below', () => {
    expect(SESSION_OFFSET).toBe(1.5)
    const at = rir => { const w = W([{ rir }, { rir }, { rir }]); return autoEffort({ workouts: [w] }, w) }
    expect(at(0)).toBe(8)
    expect(at(1)).toBe(7)
    expect(effortWord(at(1))).toBe('Hard effort')
    expect(at(2)).toBe(6)
    expect(effortWord(at(2))).toBe('Moderate')
    expect(at(3)).toBe(5)
  })

  it('takes no offset off cardio, which is rated like a whole session already', () => {
    const w = { id: 'c1', d: '2026-11-01', entries: [{ id: '1161', sets: [{ sec: 600, rpe: 7, done: true }, { sec: 600, rpe: 7, done: true }, { sec: 600, rpe: 7, done: true }] }] }
    expect(autoEffort({ workouts: [w] }, w)).toBe(7)
  })

  it('leaves warm-ups and unticked sets out', () => {
    const w = W([{ rir: 6, warmup: true }, { rir: 1, done: false }, { rir: 2 }, { rir: 2 }, { rir: 2 }])
    expect(autoEffort({ workouts: [w] }, w)).toBe(6)
  })

  it('estimates the sets nobody rated, against the workout’s own best', () => {
    // No rating at all: the top set is the anchor, so it reads close to failure (less the offset).
    const w = W([{ w: 100, r: 5 }, { w: 100, r: 5 }, { w: 100, r: 5 }])
    const v = autoEffort({ workouts: [w] }, w)
    expect(v).toBeGreaterThanOrEqual(7)
    expect(v).toBeLessThanOrEqual(9)
  })

  it('works for a workout not yet in the history (the one being finished)', () => {
    const w = W([{ rir: 3 }, { rir: 3 }, { rir: 3 }])
    expect(autoEffort({ workouts: [] }, w)).toBe(5)
  })

  it('reads a per-side set a side at a time, not from both sides\' reps added up', () => {
    const side = (w, r) => ({ w, r, done: true })
    const row = (w, r) => ({ sides: { L: side(w, r), R: side(w, r) }, w, r: r * 2, done: true })
    const past = { id: 'p', d: '2026-10-25', start: Date.parse('2026-10-25T10:00:00Z'), end: Date.parse('2026-10-25T11:00:00Z'),
      entries: [{ id: '0025', sets: [row(60, 12)] }] }
    const now = { id: 'w1', d: '2026-11-01', start: Date.parse('2026-11-01T10:00:00Z'), end: Date.parse('2026-11-01T11:00:00Z'),
      entries: [{ id: '0025', sets: [row(60, 8), row(60, 8), row(60, 8)] }] }
    // 60 × 8 a side against a best of 60 × 12 a side: about four in reserve, a moderate-to-easy
    // session, where 16 reps against 12 read as all out.
    expect(autoEffort({ workouts: [past, now] }, now)).toBeLessThanOrEqual(5)
  })

  it('takes the harder side of a per-side set', () => {
    const w = W([])
    w.entries[0].sets = [0, 1, 2].map(() => ({ sides: { L: { w: 60, r: 8, done: true, rir: 3 }, R: { w: 60, r: 8, done: true, rir: 1 } }, w: 60, r: 16, done: true, rir: 1 }))
    // RIR 1 (the harder side) → 9 less 1.5 → 7.5, a half: 7.
    expect(autoEffort({ workouts: [w] }, w)).toBe(7)
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
