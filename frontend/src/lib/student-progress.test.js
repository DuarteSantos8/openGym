import { describe, it, expect } from 'vitest'
import { studentProgress } from './student-progress.js'

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
