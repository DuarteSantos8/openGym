import { describe, expect, it } from 'vitest'
import { defaultPlanRule, planOptions, planPhase, supports, validatePlanRule } from '../../../../api/engine/rules.js'
import { generatePrescription } from '../../../../api/engine/generate.js'
import { advanceProgression } from '../../../../api/engine/advance.js'
import { auditExecution, summarizeActual } from '../../../../api/engine/audit.js'
import { planFingerprint } from '../../../../api/engine/context.js'

// Pyramid sets (v1.3.10): a rep target per set, the pyramid_reps template, "max" for as many as you can.
const pyramid = (setReps = [12, 8, 6, 'max', 12], setRest, options = {}) => defaultPlanRule('pyramid_reps', {
  id: 'r1', exerciseId: 'ex1', unit: 'kg', setReps, ...(setRest ? { setRest } : {}), sets: { min: setReps.length, max: setReps.length }, reps: { min: 12, max: 12 }, ...options
})
const gen = (rule, extra = {}) => generatePrescription({ id: 'p1', now: '2026-10-07T10:00:00.000Z', trackId: 't1', rule, ...extra })
const logOf = reps => ({
  id: 'l1', actual: { sets: reps.length, reps: Math.min(...reps), load: null }, audit: [],
  performance: { sets: reps.map(r => ({ role: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: r }], resistance: { kind: 'bodyweight' } })) }
})
const withPhase = (r, patch) => ({ ...r, program: { ...r.program, phases: [{ ...planPhase(r), ...patch(planPhase(r)) }] } })

describe('pyramid sets as groups', () => {
  it('starts a fresh pyramid_reps rule from a valid 12 · 10 · 8 · 6', () => {
    const fresh = defaultPlanRule('pyramid_reps', { id: 'r1', exerciseId: 'ex1' })
    expect(validatePlanRule(fresh)).toEqual({ ok: true, errors: [] })
    expect(planOptions(fresh).setReps).toEqual([12, 10, 8, 6])
    expect(planPhase(fresh).parameters.sets).toEqual({ min: 4, max: 4 })
  })
  it('accepts whole targets and "max", and a rest per set', () => {
    expect(validatePlanRule(pyramid()).ok).toBe(true)
    const rested = pyramid([12, 10, 8, 6], [60, 60, 90, 0])
    expect(validatePlanRule(rested).ok).toBe(true)
    expect(planPhase(rested).groups.map(g => g.restSeconds)).toEqual([60, 60, 90, undefined])
  })
  it('refuses a target of no reps, a fractional one, a bad rest and timed work', () => {
    expect(validatePlanRule(pyramid([12, 0])).errors[0]).toMatch(/at least one rep/)
    expect(validatePlanRule(pyramid([12, 1.5])).ok).toBe(false)
    expect(validatePlanRule(withPhase(pyramid(), ph => ({ groups: ph.groups.map(g => ({ ...g, restSeconds: -5 })) }))).errors[0]).toMatch(/restSeconds/)
    expect(validatePlanRule(pyramid(undefined, undefined, { durationSeconds: { min: 30, max: 30 } })).errors.join()).toMatch(/not timed work/)
  })
  it('takes no drop-set or rest-pause: the pyramid already shapes every set', () => {
    expect(supports(pyramid(undefined, undefined, { load: { mode: 'absolute', value: 40, unit: 'kg' } }))).toMatchObject({ warmup: true, dropset: false, restpause: false })
  })
})

describe('generatePrescription: pyramid rows', () => {
  it('has a row per target, a Max row opening at 0 on a first session', () => {
    const p = gen(pyramid())
    expect(p.rows.map(r => r.reps.min)).toEqual([12, 8, 6, 0, 12])
    expect(p.rows.map(r => !!r.max)).toEqual([false, false, false, true, false])
    expect(planOptions(p.ruleSnapshot).setReps).toEqual([12, 8, 6, 'max', 12])
    expect(p.parameters.sets).toEqual({ min: 5, max: 5 })
  })
  it('opens a Max row at what that same set managed last time', () => {
    const first = gen(pyramid())
    const log = logOf([12, 8, 6, 15, 11])
    const state = advanceProgression({ state: null, prescription: first, log, now: '2026-10-07T11:00:00.000Z' })
    const next = gen(pyramid(), { id: 'p2', lastPrescription: first, lastLog: log, state })
    expect(next.rows[3]).toMatchObject({ max: true, reps: { min: 15, max: 15 } })
    expect(next.rows.map(r => r.reps.min)).toEqual([12, 8, 6, 15, 12])
  })
  it('changes the plan fingerprint when the targets change, not when a rest does', () => {
    expect(planFingerprint(pyramid())).not.toBe(planFingerprint(pyramid([12, 10, 8, 6])))
    expect(planFingerprint(pyramid([12, 10], [60, 60]))).toBe(planFingerprint(pyramid([12, 10], [90, 90])))
  })
})

describe('auditing a pyramid', () => {
  const p = gen(pyramid())
  it('says nothing about a Max set, whatever it reached', () => {
    expect(auditExecution(p, { row: 3, reps: 2 })).toEqual([])
    expect(auditExecution(p, { row: 3, reps: 40 })).toEqual([])
    expect(auditExecution(p, { row: 1, reps: 5 })[0]).toMatchObject({ code: 'below_range', field: 'reps' })
  })
  it('leaves a Max set out of the reps that decide the session', () => {
    const performed = [12, 8, 6, 2, 12].map((reps, row) => ({ row, reps, load: null }))
    expect(summarizeActual(p, performed)).toMatchObject({ sets: 5, reps: 6 })
  })
})
