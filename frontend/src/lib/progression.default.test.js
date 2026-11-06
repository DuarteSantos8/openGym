import { describe, it, expect } from 'vitest'
import { policyFor, profileRule, nextPrescription } from './progression.js'
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

  it('applies to a reps exercise only when neither it nor its routine sets a rule', () => {
    expect(policyFor(cfg, {}, 'reps', 'off')).toBe('off')
    expect(policyFor(cfg, {}, 'reps')).toBe('linear')
    expect(policyFor(cfg, { prog: 'linear' }, 'reps', 'off')).toBe('linear')
    expect(policyFor({ ...cfg, prog: 'double' }, {}, 'reps', 'off')).toBe('double')
    expect(policyFor({ id: LIFT, mode: 'time', sec: 30 }, {}, 'time', 'linear')).toBe('off')
  })

  it('decides the next session: Off keeps the weight, the default still adds a step', () => {
    expect(nextPrescription(clean('off'), cfg, {})).toMatchObject({ kind: 'off' })
    expect(nextPrescription(clean(), cfg, {})).toMatchObject({ kind: 'up', weight: 62.5 })
    expect(nextPrescription(clean('off'), cfg, { prog: 'linear' })).toMatchObject({ kind: 'up', weight: 62.5 })
  })
})
