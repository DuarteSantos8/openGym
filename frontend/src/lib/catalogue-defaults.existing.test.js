import { describe, expect, it } from 'vitest'
import { routineFromSession } from './session-routines.js'
import { modeOf, pickedExerciseConfig } from './history.js'
import { isHold, isOneLimb } from './exercises.js'

// The 1.4.3 catalogue defaults (a plank starts timed #694, a one-arm row per side #736) are for
// exercises picked fresh. What someone already logged or planned keeps its own shape.
describe('catalogue defaults leave existing plans alone', () => {
  const PLANK = '0463'
  const ROW = '0292'

  it('fresh picks get the new defaults', () => {
    expect(isHold(PLANK) && isOneLimb(ROW)).toBe(true)
    expect(pickedExerciseConfig(PLANK)).toMatchObject({ mode: 'time' })
    expect(pickedExerciseConfig(ROW)).toMatchObject({ side: true })
  })

  it('a plank planned as reps before there was a mode still reads as reps', () => {
    expect(modeOf({ id: PLANK, sets: 3, reps: 10, weight: 0 })).toBe('reps')
  })

  it('a session that logged a plank as reps saves as a reps routine', () => {
    const w = { id: 'w', entries: [{ id: PLANK, target: { sets: 3, reps: 10, weight: 0 }, sets: [{ w: 0, r: 12, done: true }] }] }
    const cfg = routineFromSession(w, 'Core').ex[0]
    expect(modeOf(cfg)).toBe('reps')
    expect(cfg).toMatchObject({ reps: 12 })
    expect(cfg.sec).toBeUndefined()
  })

  it('a one-arm row logged as one row a set is not turned per side', () => {
    const w = { id: 'w', entries: [{ id: ROW, target: { mode: 'reps', sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: true }] }] }
    expect(routineFromSession(w, 'Pull').ex[0].side).toBeUndefined()
  })
})
