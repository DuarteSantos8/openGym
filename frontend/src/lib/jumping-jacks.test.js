import { describe, expect, it } from 'vitest'
import { EXIDX, isCardio } from './exercises.js'
import { buildSets, defaultConfig, exLine, modeOf, setLabel } from './history.js'
import { modeForEntry } from './workout-model.js'
import { repeatSessionEntries } from './session-repeat.js'

// Issue #678: these countable movements used to open the running-style min/speed form.
const JACKS = ['3094', '3224', '0501', '7555', '3108', '0264', '0610', '2465']
const empty = { workouts: [] }

describe('jumping-jack logging', () => {
  it.each(JACKS)('%s starts with bodyweight sets and reps', id => {
    expect(EXIDX[id]).toBeDefined()
    expect(isCardio(id)).toBe(false)
    const cfg = { id, ...defaultConfig(id), sets: 3, reps: 20 }
    expect(cfg).toMatchObject({ mode: 'reps', bodyweight: true })
    expect(buildSets(empty, cfg)).toEqual(Array.from({ length: 3 }, () => ({ w: 0, r: 20, done: false })))
  })

  it.each(['0516', '0645'])('gives the same default to drawing alias %s', id => {
    expect(defaultConfig(id)).toMatchObject({ mode: 'reps', bodyweight: true })
  })

  it('still lets a jumping jack be timed', () => {
    const cfg = { id: '3094', ...defaultConfig('3094', 'time'), sets: 1, sec: 30 }
    expect(buildSets(empty, cfg)).toEqual([{ sec: 30, w: 0, done: false }])
  })

  it.each(JACKS)('%s keeps an old duration/speed plan and its history in cardio mode', id => {
    // Old defaultConfig did not write mode: 'cardio'. Reclassification must not rewrite a plan.
    const cfg = { id, sets: 1, min: 5, speed: 8 }
    expect(modeOf(cfg)).toBe('cardio')
    expect(buildSets(empty, cfg)).toEqual([{ min: 5, speed: 8, done: false }])
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

  it.each([undefined, { sets: 1, min: 5, speed: 8 }])('can repeat an old cardio workout with target %j', target => {
    const session = { id: 'old', d: '2026-09-01', entries: [{
      id: '3094', target, sets: [{ min: 5, speed: 8, done: true }]
    }] }
    const before = structuredClone(session)
    const { entries } = repeatSessionEntries({ ...empty, unit: 'kg' }, session)
    expect(modeOf(entries[0].target)).toBe('cardio')
    expect(entries[0].sets).toEqual([{ min: 5, speed: 8, done: false }])
    expect(session).toEqual(before)
  })

  it('starts a new rep plan from its target after a previous cardio session', () => {
    const state = { workouts: [{ d: '2026-09-01', entries: [{
      id: '3094', sets: [{ min: 5, speed: 8, done: true }]
    }] }] }
    const cfg = { id: '3094', ...defaultConfig('3094'), sets: 1, reps: 20 }
    expect(buildSets(state, cfg)).toEqual([{ w: 0, r: 20, done: false }])
  })

  it.each(['2258', '0798'])('keeps walking and cycling (%s) in duration/speed mode', id => {
    expect(isCardio(id)).toBe(true)
    expect(defaultConfig(id)).toEqual({ sets: 1, min: 20, speed: 8 })
  })
})
