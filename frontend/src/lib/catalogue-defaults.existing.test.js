import { describe, expect, it } from 'vitest'
import { routineFromSession } from './session-routines.js'
import { modeOf, pickedExerciseConfig } from './history.js'
import { isHold, isOneLimb } from './exercises.js'
import { loggedExposure } from './test-fixtures.js'
import { planPhase } from './prescription/index.js'

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
    const w = { id: 'w', exposures: [loggedExposure(PLANK, [{ r: 12, w: 0 }])] }
    const cfg = routineFromSession(w, 'Core').ex[0]
    const p = planPhase(cfg.rule).parameters
    expect(p.reps.min).toBe(12)
    expect(p.durationSeconds).toBeFalsy()
  })

  it('a one-arm row logged as one row a set is not turned per side', () => {
    const w = { id: 'w', exposures: [loggedExposure(ROW, [{ r: 10, w: 20 }])] }
    expect(routineFromSession(w, 'Pull').ex[0].side).toBeUndefined()
  })
})
