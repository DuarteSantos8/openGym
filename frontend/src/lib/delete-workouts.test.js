import { describe, it, expect } from 'vitest'
import { workoutsToDelete, deleteWorkoutsOnly, restoreWorkouts } from './delete-workouts.js'
import { stampDeletions } from './sync-merge.js'

const base = () => ({
  workouts: [{ id: 'b', d: '2026-10-05', start: 2 }, { id: 'a', d: '2026-10-01', start: 1 }, { d: '2026-11-01', start: 3 }],
  routines: [{ id: 'R', name: 'Push', ex: [] }], bodyweight: [{ d: '2026-10-01', w: 80 }], measurements: [{ d: '2026-10-01', waist: 80 }],
  exWeights: { '0025': 60 }, recoverySessions: { r: { d: '2026-10-02', kind: 'sauna', min: 10, _ts: 1 } }, restSec: 90,
})

describe('delete workouts only', () => {
  it('lists the workouts oldest first, or only those before a day', () => {
    expect(workoutsToDelete(base()).map(w => w.d)).toEqual(['2026-10-01', '2026-10-05', '2026-11-01'])
    expect(workoutsToDelete(base(), { before: '2026-10-05' }).map(w => w.id)).toEqual(['a'])
  })
  it('takes the workouts and nothing else', () => {
    const S = base()
    const removed = deleteWorkoutsOnly(S)
    expect(removed).toHaveLength(3)
    expect(S.workouts).toEqual([])
    const keep = base(); delete keep.workouts
    for (const k of Object.keys(keep)) expect(S[k]).toEqual(keep[k])
  })
  it('records each removal for the sync, and Undo marks them added back', () => {
    const prev = base(), S = structuredClone(prev)
    const removed = deleteWorkoutsOnly(S, { before: '2026-10-06' })
    expect(S.workouts.map(w => w.d)).toEqual(['2026-11-01'])
    stampDeletions(prev, S, 100)
    expect(Object.keys(S.deleted.workouts).sort()).toEqual(['a', 'b'])
    const after = structuredClone(S)
    expect(restoreWorkouts(after, removed)).toBe(2)
    expect(after.workouts.map(w => w.d)).toEqual(['2026-10-01', '2026-10-05', '2026-11-01'])
    stampDeletions(S, after, 200)
    expect(after.deleted.workouts).toEqual({ a: -200, b: -200 })
    expect(restoreWorkouts(after, removed)).toBe(0)
  })
})
