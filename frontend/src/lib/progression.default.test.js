import { describe, it, expect } from 'vitest'
import { profileRule } from './prescription/vocabulary.js'
import { migratedFixture, startMigratedFixture } from './test-fixtures.js'
import { EXDB, isAssisted } from './exercises.js'

// A plainly loaded lift, as in progression.test.js.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const clean = progDefault => ({
  unit: 'kg', ...(progDefault ? { progDefault } : {}),
  workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { sets: 3, reps: 5, weight: 60 }, sets: [5, 5, 5].map(r => ({ w: 60, r, done: true })) }] }],
})
const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60 }

describe('the profile’s default progression rule', () => {
  it('is linear when the profile has none, or an unknown one', () => {
    expect(profileRule({})).toBe('linear')
    expect(profileRule(null)).toBe('linear')
    expect(profileRule({ progDefault: 'time' })).toBe('linear')
    expect(profileRule({ progDefault: 'off' })).toBe('off')
    expect(profileRule({ progDefault: 'double' })).toBe('double')
  })

  it('applies only when neither an exercise nor its routine specifies a rule', () => {
    const preset = (state, exercise, routine = {}) => migratedFixture({ ...state, routines: [{ id: 'r', ...routine, ex: [exercise] }] }).routines[0].ex[0].rule.preset
    expect(preset(clean('off'), cfg)).toBe('autoregulated')
    expect(preset(clean(), cfg)).toBe('linear')
    expect(preset(clean('off'), cfg, { prog: 'linear' })).toBe('linear')
    expect(preset(clean('off'), { ...cfg, prog: 'double' })).toBe('double')
    expect(preset(clean(), { id: LIFT, mode: 'time', sec: 30 })).toBe('autoregulated')
  })

  it('decides the next session: Off keeps the weight, the default still adds a step', () => {
    const next = (S, routine = {}) => startMigratedFixture(S, { id: 'r', ...routine, ex: [cfg] }).entries[0]
    expect(next(clean('off')).target.weight).toBe(60)
    expect(next(clean()).target.weight).toBe(62.5)
    expect(next(clean('off'), { prog: 'linear' }).target.weight).toBe(62.5)
  })
})
