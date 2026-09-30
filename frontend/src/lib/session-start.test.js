import { describe, expect, it } from 'vitest'
import { buildSessionExposures, missingOneRms, occurrenceFor } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { loggedExposure, ruleOccurrence } from './test-fixtures.js'
import { EXIDX, isAssisted } from './exercises.js'

const ctx = { now: Date.UTC(2026, 8, 24), newId: seed => seed, unit: 'kg' }
const profile = over => ({ unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: {}, ...over })
const percent = ruleOccurrence('0025', { patch: r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'percent_1rm', percent: 70 } }, increment: { type: 'percentage_points', value: 2.5 } }) })

describe('buildSessionExposures', () => {
  it('stores one prescription per occurrence, tracked by occurrence', () => {
    const S = profile()
    const [a, b] = buildSessionExposures(S, { id: 'r1', ex: [ruleOccurrence('0025'), ruleOccurrence('0032', { preset: 'double' })] }, ctx)
    expect(a).toMatchObject({ exerciseId: '0025', occurrenceId: 'occ-0025', trackId: 'occ-0025', routineId: 'r1', excludedFromProgression: false, performance: { sets: [] } })
    expect(S.prescriptions[a.prescriptionId]).toMatchObject({ trackId: 'occ-0025', preset: 'linear', generatedAt: '2026-09-24T00:00:00.000Z' })
    expect(S.prescriptions[b.prescriptionId].preset).toBe('double')
  })

  it('advances from the track state and the newest log', () => {
    const S = profile()
    const routine = { id: 'r1', ex: [ruleOccurrence('0025')] }
    const [first] = buildSessionExposures(S, routine, ctx)
    S.workouts.push({ id: 'w1', exposures: [{ ...first, actual: { sets: 3, reps: 5, load: { value: 20, unit: 'kg' } }, audit: [] }] })
    S.progression['occ-0025'] = { trackId: 'occ-0025', status: 'active', readyToIncrement: true, planRuleRevision: 1, position: 0, lastPrescriptionId: first.prescriptionId }
    const [second] = buildSessionExposures(S, routine, { ...ctx, now: ctx.now + 1 })
    expect(S.prescriptions[second.prescriptionId].parameters.load.resolved).toEqual({ value: 22.5, unit: 'kg' })
  })

  it('records the out-of-plan log the next prescription was derived from', () => {
    const S = profile()
    const routine = { id: 'r1', ex: [ruleOccurrence('0025')] }
    const [first] = buildSessionExposures(S, routine, ctx)
    S.workouts.push({ id: 'w1', exposures: [{ ...first, actual: { sets: 3, reps: 5, load: { value: 250, unit: 'kg' } }, audit: [{ code: 'above_cap' }] }] })
    const [second] = buildSessionExposures(S, routine, { ...ctx, now: ctx.now + 1 })
    expect(S.prescriptions[second.prescriptionId].provenance).toEqual({ derivedFromOutOfPlan: true, sourceLogId: first.exposureId })
  })

  it('embeds the current 1RM and lists exercises whose percent rule has none', () => {
    const S = profile()
    expect(missingOneRms(S, [{ id: 'r1', ex: [percent, ruleOccurrence('0032')] }])).toEqual(['0025'])
    S.oneRepMaxes.o1 = { id: 'o1', exerciseId: '0025', value: 100, unit: 'kg', source: 'manual', capturedAt: '2026-09-01T00:00:00.000Z' }
    expect(missingOneRms(S, [{ id: 'r1', ex: [percent] }])).toEqual([])
    const [x] = buildSessionExposures(S, { id: 'r1', ex: [percent] }, ctx)
    expect(S.prescriptions[x.prescriptionId].parameters.load.resolved).toEqual({ value: 70, unit: 'kg' })
  })
})

describe('occurrenceFor', () => {
  it('builds an occurrence from plain numbers', () => {
    expect(occurrenceFor('0025', { sets: 4, reps: 6, weight: 50 }, { id: 'o1', unit: 'kg' }).rule).toMatchObject({
      preset: 'manual', parameters: { sets: { min: 4, max: 4 }, reps: { min: 6, max: 6 }, load: { mode: 'absolute', value: 50, unit: 'kg' } }
    })
    expect(occurrenceFor('0025', { sets: 3, sec: 45 }, { id: 'o2' }).rule.parameters).toMatchObject({ durationSeconds: { min: 45, max: 45 }, reps: { min: 1, max: 1 } })
  })
})

describe('session semantics through buildSessionExposures', () => {
  const uncapped = (sets, reps, weight) => ruleOccurrence('0025', { patch: r => ({
    ...r, target: { mode: 'none' }, completion: [],
    parameters: { ...r.parameters, sets: { min: sets, max: sets }, reps: { min: reps, max: reps }, load: { mode: 'absolute', value: weight, unit: 'kg' } }
  }) })

  it('opens a routine at its own plan and the weight last lifted elsewhere', () => {
    const S = profile({ workouts: [{ id: 'w0', exposures: [loggedExposure('0025', [{ r: 15, w: 50 }, { r: 15, w: 50 }])] }] })
    const [x] = buildSessionExposures(S, { id: 'r1', ex: [uncapped(3, 10, 20)] }, ctx)
    const p = S.prescriptions[x.prescriptionId]
    expect(p.parameters.load.resolved).toEqual({ value: 50, unit: 'kg' })
    expect(p.prefill).toMatchObject({ sets: 3, reps: 10 })
  })

  it('restarts an edited routine at its new reps, holds the weight and keeps the entry contract', () => {
    const S = profile()
    const r5 = uncapped(3, 5, 100)
    const [first] = buildSessionExposures(S, { id: 'r1', ex: [r5] }, ctx)
    S.workouts.push({ id: 'w1', exposures: [{ ...first, actual: { sets: 3, reps: 5, load: { value: 100, unit: 'kg' } }, audit: [] }] })
    S.progression['occ-0025'] = { trackId: 'occ-0025', status: 'active', readyToIncrement: true, planRuleRevision: 1, position: 0, lastPrescriptionId: first.prescriptionId }
    const [second] = buildSessionExposures({ ...S, startFrom: 'last' }, { id: 'r1', ex: [uncapped(3, 10, 100)] }, { ...ctx, now: ctx.now + 1 })
    const p = S.prescriptions[second.prescriptionId]
    expect(p.parameters.load.resolved).toEqual({ value: 100, unit: 'kg' })
    expect(p.prefill).toMatchObject({ sets: 3, reps: 10 })
    const [entry] = entriesForExposures([second], S.prescriptions)
    expect(entry.planned).toEqual({ sets: 3, reps: 10 })
    expect(entry.carried).toBeUndefined()
  })

  it('marks an entry whose rows open at last session\'s reps', () => {
    const S = profile({ startFrom: 'last' })
    const r = uncapped(3, 10, 60)
    const [first] = buildSessionExposures(S, { id: 'r1', ex: [r] }, ctx)
    S.workouts.push({ id: 'w1', exposures: [{ ...first, actual: { sets: 3, reps: 8, load: { value: 60, unit: 'kg' } }, audit: [] }] })
    S.progression['occ-0025'] = { trackId: 'occ-0025', status: 'active', readyToIncrement: false, planRuleRevision: 1, position: 0, lastPrescriptionId: first.prescriptionId }
    const [second] = buildSessionExposures(S, { id: 'r1', ex: [r] }, { ...ctx, now: ctx.now + 1 })
    const [entry] = entriesForExposures([second], S.prescriptions)
    expect(entry).toMatchObject({ carried: true, planned: { sets: 3, reps: 10 } })
    expect(entry.sets.map(s => s.r)).toEqual([8, 8, 8])
  })
})

describe('warm-up inputs', () => {
  const occ = (exerciseId, warmup) => {
    const o = occurrenceFor(exerciseId, { sets: 3, reps: 5, weight: 100 }, { id: 'o-' + exerciseId, routineId: 'rt' })
    return warmup ? { ...o, warmup } : o
  }
  const run = ex => {
    const profile = { workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {} }
    const [x] = buildSessionExposures(profile, { id: 'rt', ex: [ex] }, { now: 0, newId: s => s })
    return profile.prescriptions[x.prescriptionId]
  }
  it('passes the occurrence recipe and the exercise equipment', () => {
    const id = Object.keys(EXIDX).find(k => EXIDX[k].eq === 'barbell')
    expect(run(occ(id, { mode: 'smart', count: 5 })).warmupRows).toHaveLength(5)
  })
  it('an assisted machine gets no automatic warm-ups', () => {
    const id = Object.keys(EXIDX).find(k => isAssisted(k))
    expect(run(occ(id, { mode: 'smart', count: 3 })).warmupRows).toBeUndefined()
  })
  it('an exposure says how it is logged: the occurrence\'s mode, else the catalogue\'s, and a bare duration is a hold', () => {
    const exposure = ex => buildSessionExposures({ workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {} }, { id: 'rt', ex: [ex] }, { now: 0, newId: s => s })[0]
    const cardio = { ...occ('3220'), mode: 'cardio' }
    expect(exposure(cardio).mode).toBe('cardio')
    expect(exposure({ ...occ('3220') }).mode).toBe('cardio')   // the catalogue knows it is cardio
    expect(exposure(occ('0025')).mode).toBe('reps')
    const hold = occ('0001')
    hold.rule.parameters.durationSeconds = { min: 30, max: 30 }
    expect(exposure(hold).mode).toBe('time')
  })
  it('the occurrence\'s own ramp rest reaches its exposure, and only when it has one', () => {
    const exposure = ex => buildSessionExposures({ workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {} }, { id: 'rt', ex: [ex] }, { now: 0, newId: s => s })[0]
    expect(exposure({ ...occ('0025'), warmupRestSec: 31 }).warmupRestSec).toBe(31)
    expect(exposure(occ('0025'))).not.toHaveProperty('warmupRestSec')
  })
})

// The mid-session settings sheet edits the plan, so it opens at the plan's sets and reps and at
// today's weight — never at a prescription's aim, climb or added set (#275).

// An exercise's ⋯ menu sets `noProg` by hand; a deload or rehab routine freezes it onto its
// exercises. Only the second is rebuilt without a prescription.
