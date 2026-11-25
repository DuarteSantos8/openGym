import { describe, expect, it } from 'vitest'
import { pickedExerciseConfig } from './history.js'
import { isHold } from './exercises.js'

// A static stretch whose instructions prescribe a hold (#1537) is picked as a timed hold, not as
// 3 x 10 reps, and one done a side at a time starts per side. A moving drill stays reps.
describe('static stretches start as timed holds', () => {
  it('a one-sided hamstring stretch starts timed and per side', () => {
    const cfg = pickedExerciseConfig('1909')
    expect(cfg).toMatchObject({ mode: 'time', side: true })
    expect(cfg.reps).toBeUndefined()
  })

  it.each(['1908', '1913', '1059', '1406', '0692'])('%s starts timed and per side', id => {
    expect(pickedExerciseConfig(id)).toMatchObject({ mode: 'time', side: true })
  })

  it('child pose starts timed with no side switch', () => {
    const cfg = pickedExerciseConfig('0945')
    expect(cfg).toMatchObject({ mode: 'time' })
    expect(cfg.side).toBeUndefined()
  })

  it('a dynamic rep exercise stays reps and is not per side', () => {
    const cfg = pickedExerciseConfig('0025')
    expect(cfg).toMatchObject({ mode: 'reps', reps: 10 })
    expect(cfg.side).toBeUndefined()
    expect(isHold('0025')).toBe(false)
  })

})
