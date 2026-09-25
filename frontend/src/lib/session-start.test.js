import { describe, expect, it } from 'vitest'
import { buildSessionExposures, lastLogFor, missingOneRms, occurrenceFor } from './session-start.js'
import { ruleOccurrence } from './test-fixtures.js'
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
    expect(lastLogFor(S, 'occ-0025').exposureId).toBe(first.exposureId)
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
})
