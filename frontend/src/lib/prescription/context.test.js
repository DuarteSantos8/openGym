import { describe, expect, it } from 'vitest'
import { defaultPlanRule } from '../../../../api/engine/rules.js'
import { generatePrescription, ruleOfPrescription } from '../../../../api/engine/generate.js'
import { planFingerprint, replayProgression, resolveProgressionContext } from '../../../../api/engine/context.js'
import { advanceProgression } from '../../../../api/engine/advance.js'

const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
// Linear with no terminal target, so no load is capped.
const plan = (sets, reps, weight = 60) => {
  const r = defaultPlanRule('linear', { id: 'rule1', exerciseId: 'ex1', routineId: 'A', unit: 'kg' })
  return { ...r, target: { mode: 'none' }, completion: [], parameters: { ...r.parameters, sets: { min: sets, max: sets }, reps: { min: reps, max: reps }, load: { mode: 'absolute', value: weight, unit: 'kg' } } }
}
const gen = (id, trackId, rule) => generatePrescription({ id, now: NOW, trackId, rule })
const work = w => ({ role: 'work', status: 'completed', observations: [{ metric: 'repetitions', unit: 'reps', value: 10 }], resistance: { kind: 'external-load', value: w, unit: 'kg' } })
const logged = (p, { trackId = 'occA', exposureId = 'x1', load = 60, excluded = false } = {}) => ({
  exposureId, exerciseId: 'ex1', trackId, prescriptionId: p?.id ?? null, excludedFromProgression: excluded || !p,
  ...(p ? { actual: { sets: 3, reps: 10, load: kg(load) } } : {}),
  performance: { sets: [work(load)] }
})
const resolve = (rule, workouts, prescriptions, progression = {}) =>
  resolveProgressionContext({ trackId: 'occA', exerciseId: 'ex1', rule, workouts, prescriptions, progression })

describe('planFingerprint', () => {
  it('changes with sets or reps, not with weight', () => {
    expect(planFingerprint(plan(3, 10, 60))).toBe(planFingerprint(plan(3, 10, 80)))
    expect(planFingerprint(plan(3, 10))).not.toBe(planFingerprint(plan(3, 12)))
    expect(planFingerprint(plan(3, 10))).not.toBe(planFingerprint(plan(4, 10)))
  })

  it('is stamped on every prescription, and a rule rebuilt from it has the same one', () => {
    const p = gen('p1', 'occA', plan(3, 10))
    expect(p.planFingerprint).toBe(planFingerprint(plan(3, 10)))
    expect(planFingerprint(ruleOfPrescription(p, 'A'))).toBe(p.planFingerprint)
  })

  it('keeps the rule\'s fingerprint for a hold whose window slid', () => {
    const r = defaultPlanRule('hold_seconds', { id: 'rule2', exerciseId: 'ex1', routineId: 'A', unit: 'kg' })
    const first = gen('h1', 'occA', r)
    const state = { status: 'active', readyToIncrement: false, planRuleRevision: 1, position: 2 }
    const slid = generatePrescription({ id: 'h2', now: NOW, trackId: 'occA', rule: r, state, lastPrescription: first, lastLog: { id: 'l1', actual: { sets: 3, reps: 1, durationSeconds: 30 }, audit: [] } })
    expect(slid.parameters.durationSeconds.min).toBeGreaterThan(r.parameters.durationSeconds.min)
    expect(planFingerprint(ruleOfPrescription(slid, 'A'))).toBe(slid.planFingerprint)
  })

  it('records the fingerprint it is given, including none', () => {
    expect(generatePrescription({ id: 'p1', now: NOW, trackId: 'occA', rule: plan(3, 10), fingerprint: null }).planFingerprint).toBe(null)
    expect(generatePrescription({ id: 'p1', now: NOW, trackId: 'occA', rule: plan(3, 10), fingerprint: 'x' }).planFingerprint).toBe('x')
  })
})

describe('resolveProgressionContext', () => {
  it('reads the occurrence\'s own last log before a newer one from another routine', () => {
    const r = plan(3, 10)
    const pA = gen('pA', 'occA', r), pB = gen('pB', 'occB', r)
    const workouts = [{ exposures: [logged(pA, { exposureId: 'xA' })] }, { exposures: [logged(pB, { trackId: 'occB', exposureId: 'xB', load: 80 })] }]
    const ctx = resolve(r, workouts, { pA, pB })
    expect(ctx).toMatchObject({ source: 'slot', reset: null, lastPrescription: pA, heldLoad: kg(60) })
    expect(ctx.baseline.exposureId).toBe('xA')
  })

  it('falls back to another routine\'s log and progresses from it when its plan was the same', () => {
    const r = plan(3, 10)
    const pB = gen('pB', 'occB', r)
    const stateB = { trackId: 'occB', status: 'active', readyToIncrement: true, planRuleRevision: 1, position: 0, lastPrescriptionId: 'pB' }
    const ctx = resolve(r, [{ exposures: [logged(pB, { trackId: 'occB', load: 80 })] }], { pB }, { occB: stateB })
    expect(ctx).toMatchObject({ source: 'exercise', reset: null, state: stateB, lastPrescription: pB, heldLoad: kg(80) })
  })

  it('restarts from the plan when the fallback log was built from a different plan', () => {
    const pB = gen('pB', 'occB', plan(3, 15))
    const ctx = resolve(plan(3, 10), [{ exposures: [logged(pB, { trackId: 'occB' })] }], { pB }, { occB: { status: 'active' } })
    expect(ctx).toMatchObject({ source: 'exercise', reset: 'plan_changed', state: null })
  })

  it('treats imported or legacy history as a first time in this routine, holding what was lifted', () => {
    const ctx = resolve(plan(3, 10), [{ exposures: [logged(null, { trackId: null, load: 72.5 })] }], {})
    expect(ctx).toMatchObject({ source: 'exercise', reset: 'first_in_routine', lastPrescription: null, heldLoad: kg(72.5) })
  })

  it('resets its own track after the plan\'s reps were edited', () => {
    const pA = gen('pA', 'occA', plan(3, 5))
    const ctx = resolve(plan(3, 10), [{ exposures: [logged(pA)] }], { pA }, { occA: { status: 'active', readyToIncrement: true, lastPrescriptionId: 'pA' } })
    expect(ctx).toMatchObject({ source: 'slot', reset: 'plan_changed', state: null, lastPrescription: pA })
  })

  it('skips an excluded log on its own track', () => {
    const r = plan(3, 10)
    const p1 = gen('p1', 'occA', r), p2 = gen('p2', 'occA', r)
    const workouts = [{ exposures: [logged(p1, { exposureId: 'counted' })] }, { exposures: [logged(p2, { exposureId: 'deload', excluded: true, load: 30 })] }]
    expect(resolve(r, workouts, { p1, p2 }).baseline.exposureId).toBe('counted')
  })

  it('never resets its own track from an unstamped prescription', () => {
    const r = plan(3, 10)
    const { planFingerprint: _, ...unstamped } = gen('pA', 'occA', plan(3, 5))
    const ctx = resolve(r, [{ exposures: [logged(unstamped)] }], { pA: unstamped })
    expect(ctx).toMatchObject({ source: 'slot', reset: null })
  })

  // #284: the track's state came from a later log than the baseline (a day logged into the past
  // reads only what came before it), or the baseline never advanced its track (a session logged
  // late). Either way the state is the baseline's own advance.
  it('re-derives the state from the baseline when the track\'s state is not that log\'s', () => {
    const r = plan(3, 10)
    const p1 = gen('p1', 'occA', r), p2 = gen('p2', 'occA', r)
    const later = { trackId: 'occA', lastCompletedLogId: 'x2', lastPrescriptionId: 'p2', readyToIncrement: false, status: 'active', position: 0 }
    const ctx = resolve(r, [{ exposures: [logged(p1)] }], { p1, p2 }, { occA: later })
    expect(ctx.lastPrescription).toBe(p1)
    expect(ctx.state).toMatchObject({ lastCompletedLogId: 'x1', lastPrescriptionId: 'p1', readyToIncrement: true })
    expect(resolve(r, [{ exposures: [logged(p1)] }], { p1 }).state).toMatchObject({ lastCompletedLogId: 'x1', readyToIncrement: true })
    // A state that is the baseline's own is used as it is.
    const own = { ...later, lastCompletedLogId: 'x1', lastPrescriptionId: 'p1' }
    expect(resolve(r, [{ exposures: [logged(p1)] }], { p1, p2 }, { occA: own }).state).toBe(own)
  })

  it('has no baseline for an exercise never logged', () => {
    expect(resolve(plan(3, 10), [], {})).toMatchObject({ baseline: null, source: null, reset: null, state: null, lastPrescription: null, heldLoad: null })
  })
})

describe('replayProgression', () => {
  it('lands where the live finishes left a 5/3/1 track, a completed cycle included', () => {
    const rule = defaultPlanRule('five_three_one', { id: 'w', exerciseId: 'ex1', routineId: 'A', unit: 'kg' })
    const oneRm = { value: 100, unit: 'kg', capturedAt: NOW }
    const prescriptions = {}, workouts = []
    let state = null, last = null
    for (let k = 0; k < 5; k++) {
      const p = generatePrescription({ id: 'p' + k, now: NOW, trackId: 't', rule, state, lastPrescription: last, oneRm })
      const actual = { sets: p.rows.length, reps: p.rows.at(-1).reps.min, load: p.rows.at(-1).load }
      prescriptions[p.id] = p
      workouts.push({ exposures: [{ exposureId: 'x' + k, trackId: 't', prescriptionId: p.id, actual, excludedFromProgression: false }] })
      state = advanceProgression({ state, prescription: p, log: { id: 'x' + k, actual }, now: null })
      last = p
    }
    expect(state.cyclesCompleted).toBe(1)
    expect(replayProgression({ workouts, trackId: 't', prescriptions })).toEqual(state)
    // Up to a log: what the track was after it, not after the ones that followed.
    expect(replayProgression({ workouts, trackId: 't', prescriptions, upTo: workouts[1].exposures[0] })).toMatchObject({ lastCompletedLogId: 'x1', cyclesCompleted: 0, position: 2 })
    expect(replayProgression({ workouts, trackId: 'other', prescriptions })).toBeNull()
  })
})
