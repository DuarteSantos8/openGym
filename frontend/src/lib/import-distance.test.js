import { describe, it, expect } from 'vitest'
import { parseWorkoutCSV } from './import-csv.js'

// A short distance row with a duration and no reps is a capped distance set ({ sec, m }),
// not cardio — the carry case the distance mode exists for.
const HEADER = 'Date,Exercise,Category,Weight (kg),Reps,Distance,Distance Unit,Seconds\n'

describe('distance rows in a CSV import', () => {
  it('maps a metres row with seconds into a distance-mode set', () => {
    const r = parseWorkoutCSV(HEADER + '2026-04-01,Sandbag carry,,,,400,m,600\n')
    expect(r.workouts).toHaveLength(1)
    const set = r.workouts[0].entries[0].sets[0]
    expect(set).toEqual({ sec: 600, m: 400, done: true })
  })

  it('converts imperial distance rows to metres', () => {
    const r = parseWorkoutCSV(HEADER + '2026-04-01,Sandbag carry,,,,437.4,yd,600\n')
    const set = r.workouts[0].entries[0].sets[0]
    expect(set.m).toBe(400)             // 437.4 yd ≈ 400.0 m
    expect(set.sec).toBe(600)
  })

  it('leaves a long row (treadmill-style) in cardio, not distance', () => {
    const r = parseWorkoutCSV('Date,Exercise,Reps,Distance,Distance Unit,Time\n2026-04-01,Treadmill run,,5,km,30:00\n')
    const set = r.workouts[0].entries[0].sets[0]
    expect(set.min).toBe(30)
    expect(set.speed).toBe(10)
    expect(set.m).toBeUndefined()
  })

  it('leaves a distance row and a normal set in the same workout in their own modes', () => {
    const r = parseWorkoutCSV(HEADER + [
      '2026-04-01,Sandbag carry,,,,400,m,600',
      '2026-04-01,Bench Press,,60,8,,,',
    ].join('\n') + '\n')
    const entries = r.workouts[0].entries
    const carry = entries.map(e => e.sets[0]).find(s => s.m != null)
    const bench = entries.map(e => e.sets[0]).find(s => s.r)
    expect(carry).toEqual({ sec: 600, m: 400, done: true })
    expect(bench.w).toBe(60)
    expect(bench.r).toBe(8)
  })
})
