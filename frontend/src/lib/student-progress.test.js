import { describe, it, expect } from 'vitest'
import { studentProgress, studentPerformance } from './student-progress.js'

const now = Date.parse('2026-11-02T12:00:00Z')
const w = (d, vol, prs) => ({ id: d, d, vol, ...(prs ? { prs } : {}), entries: [{ id: 'e', sets: [{ w: 10, r: 5, done: true }] }] })

describe('studentProgress', () => {
  it('compares the last 30 days with the 30 before', () => {
    const p = studentProgress({ workouts: [w('2026-10-30', 1000, ['a']), w('2026-10-10', 500), w('2026-09-20', 800), w('2026-08-01', 99)] }, now)
    expect(p.last30).toEqual({ count: 2, volume: 1500, prs: 1 })
    expect(p.prev30).toEqual({ count: 1, volume: 800, prs: 0 })
    expect(p.lastWorkout).toBe('2026-10-30')
  })
  it('reads the weight and body-fat change, oldest to newest, whatever the order', () => {
    const p = studentProgress({
      bodyweight: [{ d: '2026-10-01', w: 78.5 }, { d: '2026-08-01', w: 82 }],
      measurements: [{ d: '2026-10-01', bodyFat: 18 }, { d: '2026-08-01', bodyFat: 21.5 }, { d: '2026-09-01', waist: 80 }]
    }, now)
    expect(p.weight).toMatchObject({ first: 82, last: 78.5, delta: -3.5 })
    expect(p.bodyFat).toMatchObject({ first: 21.5, last: 18, delta: -3.5, n: 2 })
  })
  it('has no change to show for one reading or none, and skips malformed rows', () => {
    const p = studentProgress({ bodyweight: [null, { d: 'x', w: 1 }, { d: '2026-10-01', w: 80 }], workouts: [null, { d: '2026-10-30' }] }, now)
    expect(p.weight).toMatchObject({ last: 80, delta: null })
    expect(p.bodyFat).toBeNull()
    expect(p.last30.count).toBe(0)
    expect(studentProgress(undefined, now).lastWorkout).toBeNull()
  })
})

const lift = (d, wgt, reps, id = '0001') => ({ id: d + id, d, vol: wgt * reps, entries: [{ id, sets: [{ w: wgt, r: reps, done: true }] }] })

describe('archived workouts', () => {
  it('stay out of the progress numbers', () => {
    const p = studentProgress({ workouts: [w('2026-10-30', 1000), { ...w('2026-10-29', 500), archived: true }] }, now)
    expect(p.last30.count).toBe(1)
    expect(p.last30.volume).toBe(1000)
  })
})

describe('studentPerformance', () => {
  it('counts sessions and volume per week, newest week last', () => {
    const p = studentPerformance({ workouts: [w('2026-10-31', 100), w('2026-10-30', 200), w('2026-10-20', 50)] }, now)
    expect(p.weeks).toHaveLength(8)
    expect(p.weeks[7]).toEqual({ count: 2, volume: 300 })
    expect(p.weeks[6]).toEqual({ count: 1, volume: 50 })
    expect(p.weeks[0]).toEqual({ count: 0, volume: 0 })
  })
  it('reads adherence against the days the plan schedules, capped at 100', () => {
    const ws = ['2026-10-31', '2026-10-28', '2026-10-24', '2026-10-21', '2026-10-17', '2026-10-14'].map(d => w(d, 10))
    expect(studentPerformance({ workouts: ws, plannedDays: 3 }, now)).toMatchObject({ perWeek: 1.5, planned: 3, adherence: 50 })
    expect(studentPerformance({ workouts: ws, plannedDays: 1 }, now).adherence).toBe(100)
    expect(studentPerformance({ workouts: ws }, now)).toMatchObject({ planned: null, adherence: null })
  })
  it('follows the estimated 1RM of a lift over its sessions', () => {
    const p = studentPerformance({ workouts: [lift('2026-09-20', 60, 8), lift('2026-10-25', 70, 8), lift('2026-10-01', 65, 8), lift('2026-10-02', 40, 10, '0002')] }, now)
    expect(p.strength).toHaveLength(1)
    expect(p.strength[0]).toMatchObject({ id: '0001', n: 3 })
    expect(p.strength[0].last).toBeGreaterThan(p.strength[0].first)
    expect(p.strength[0].delta).toBeGreaterThan(0)
  })
  it('leaves archived workouts out and says how many there are', () => {
    const p = studentPerformance({ workouts: [w('2026-10-31', 100), { ...w('2026-10-30', 200), archived: true }] }, now)
    expect(p.weeks[7].count).toBe(1)
    expect(p.archived).toBe(1)
  })
  it('copes with a record that has no workouts', () => {
    expect(studentPerformance({}, now)).toMatchObject({ perWeek: 0, adherence: null, strength: [], archived: 0 })
  })
})
