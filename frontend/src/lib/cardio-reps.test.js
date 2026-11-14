import { describe, expect, it } from 'vitest'
import { EXIDX, isCardio } from './exercises.js'
import { defaultConfig, modeOf } from './history.js'

// Issue #717, the rest of the family #678 started with: burpees, star jumps, tuck jumps and the
// other jacks are counted, not run, so they start as sets x reps. Running, walking, rowing and high
// knees stay cardio.
const COUNTED = ['1160', '2794', '1201', '0683', '3113', '0780', '5105', '3223', '0797', '3220', '0504', '1570', '3700']

describe('counted bodyweight cardio', () => {
  it.each(COUNTED)('%s starts with sets and reps', id => {
    expect(EXIDX[id]).toBeDefined()
    expect(isCardio(id)).toBe(false)
    expect(defaultConfig(id)).toMatchObject({ sets: 3, reps: 10, mode: 'reps' })
  })

  it('keeps an old burpee plan in its duration/speed form', () => {
    expect(modeOf({ id: '1160', sets: 1, min: 5, speed: 8 })).toBe('cardio')
  })

  it('files the knee-to-chest push-up under chest, not cardio', () => {
    expect(EXIDX['0654'].bp).toBe('chest')
    expect(defaultConfig('0654')).toMatchObject({ mode: 'reps', bodyweight: true })
  })

  // #796: skipping rope is counted too (Double unders, anyone?). Switch it to Time or Cardio in
  // its settings if minutes are your thing.
  const ROPE = ['2612', '4829', '6100', '5038', '3678', '3676', '3885', '3677', '3675']
  it.each(ROPE)('jump rope %s starts with sets and reps', id => {
    expect(EXIDX[id]).toBeDefined()
    expect(isCardio(id)).toBe(false)
    expect(defaultConfig(id)).toMatchObject({ sets: 3, reps: 10, mode: 'reps' })
  })

  it.each(['0685', '3556', '1161'])('leaves %s in cardio', id => {
    expect(isCardio(id)).toBe(true)
    expect(defaultConfig(id)).toEqual({ sets: 1, min: 20, speed: 8 })
  })
})
