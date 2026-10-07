/* The same CSV imported on two devices before they synced made every session (and every custom
   exercise) twice: random ids each time, and the merge unites by id. Import ids now come from what
   is imported. (QA 2026-10-06, also in v1.3.9.) */
import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV, mergeImport } from './import-csv.js'
import { mergeStates } from './sync-merge.js'

const CSV = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2026-09-01 18:00:00,Push,1h,Bench Press (Barbell),1,80,5,0,0,,,',
  '2026-09-01 18:00:00,Push,1h,Grip Trainer Deluxe,1,30,10,0,0,,,',
  '2026-09-03 18:00:00,Pull,1h,Deadlift (Barbell),1,140,5,0,0,,,',
].join('\n')
const base = () => ({ _ts: 1, workouts: [], customEx: [], bodyweight: [], exWeights: {}, routines: [] })

describe('the same import on two devices', () => {
  it('merges into one copy of each session and custom exercise', () => {
    const A = base(), B = base()
    mergeImport(A, parseWorkoutCSV(CSV, { unit: 'kg' })); A._ts = 10
    mergeImport(B, parseWorkoutCSV(CSV, { unit: 'kg' })); B._ts = 20
    expect(A.workouts).toHaveLength(2)
    const M = mergeStates(A, B)
    expect(M.workouts).toHaveLength(2)
    expect(M.customEx).toHaveLength(A.customEx.length)
  })
  it('different sessions still get different ids', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg' })
    expect(new Set(p.workouts.map(w => w.id)).size).toBe(2)
  })
})
