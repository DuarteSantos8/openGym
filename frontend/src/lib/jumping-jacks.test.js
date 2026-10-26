import { describe, expect, it } from 'vitest'
import { EXIDX, isCardio } from './exercises.js'
import { defaultConfig, exLine, modeOf, setLabel } from './history.js'
import { modeForEntry } from './workout-model.js'

// Issue #678: these countable movements used to open the running-style min/speed form.
const JACKS = ['3094', '3224', '0501', '7555', '3108', '0264', '0610', '2465']

describe('jumping-jack logging', () => {
  it.each(JACKS)('%s starts with bodyweight sets and reps', id => {
    expect(EXIDX[id]).toBeDefined()
    expect(isCardio(id)).toBe(false)
    const cfg = { id, ...defaultConfig(id), sets: 3, reps: 20 }
    expect(cfg).toMatchObject({ mode: 'reps', bodyweight: true })
  })

  it.each(['0516', '0645'])('gives the same default to drawing alias %s', id => {
    expect(defaultConfig(id)).toMatchObject({ mode: 'reps', bodyweight: true })
  })

  it('still lets a jumping jack be timed', () => {
    expect(defaultConfig('3094', 'time')).toMatchObject({ mode: 'time' })
  })

  it.each(JACKS)('%s keeps an old duration/speed plan and its history in cardio mode', id => {
    // Old defaultConfig did not write mode: 'cardio'. Reclassification must not rewrite a plan.
    const cfg = { id, sets: 1, min: 5, speed: 8 }
    expect(modeOf(cfg)).toBe('cardio')
    expect(exLine(cfg, 'kg')).toBe('1 × 5 min @ 8 km/h')
    const row = { min: 5, speed: 8, done: true }
    expect(modeForEntry({ id, target: cfg, sets: [row] })).toBe('cardio')
    expect(setLabel(id, row, cfg)).toBe('5 min @ 8 km/h')
    expect(setLabel(id, row)).toBe('5 min @ 8 km/h')
  })

  it('honours an explicit mode even when old cardio fields remain', () => {
    expect(modeOf({ id: '3094', mode: 'reps', min: 5, speed: 8 })).toBe('reps')
    expect(modeOf({ id: '3094', mode: 'time', min: 5, speed: 8 })).toBe('time')
  })

  it.each(['2258', '0798'])('keeps walking and cycling (%s) in duration/speed mode', id => {
    expect(isCardio(id)).toBe(true)
    expect(defaultConfig(id)).toEqual({ sets: 1, min: 20, speed: 8 })
  })
})
