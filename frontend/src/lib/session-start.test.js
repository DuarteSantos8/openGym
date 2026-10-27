import { describe, expect, it } from 'vitest'
import { advanceProgression, editPlan, generatePrescription, planPhase } from './prescription/index.js'
import { buildSessionExposures, effectiveExerciseId, missingOneRms, occurrenceFor } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { loggedExposure, ruleOccurrence } from './test-fixtures.js'
import { EXIDX, isAssisted } from './exercises.js'

const ctx = { now: Date.UTC(2026, 8, 24), newId: seed => seed, unit: 'kg' }
const profile = over => ({ unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: {}, ...over })
const percent = ruleOccurrence('0025', { options: { load: { mode: 'percent_1rm', percent: 70 }, step: { type: 'percentage_points', value: 2.5 } } })

describe('buildSessionExposures', () => {
  it('A8: migrated inherited rest follows the profile while explicit rest stays fixed', () => {
    const inherited = { ...ruleOccurrence('0025'), restFromProfile: true }
    inherited.rule = editPlan(inherited.rule, { restSeconds: 90 })
    const explicit = ruleOccurrence('0032')
    explicit.rule = editPlan(explicit.rule, { restSeconds: 180 })
    const S = profile({ restSec: 120 })
    const exposures = buildSessionExposures(S, { id: 'r', ex: [inherited, explicit] }, ctx)
    expect(exposures.map(x => S.prescriptions[x.prescriptionId].parameters.restSeconds)).toEqual([120, 180])
    expect(planPhase(inherited.rule).parameters.restSeconds).toBe(90)
  })
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
    const actual = { sets: 3, reps: 5, load: { value: 20, unit: 'kg' } }
    S.workouts.push({ id: 'w1', exposures: [{ ...first, actual, audit: [] }] })
    S.progression['occ-0025'] = advanceProgression({ state: null, prescription: S.prescriptions[first.prescriptionId], log: { id: first.exposureId, actual }, now: '2026-09-24T01:00:00.000Z' })
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
    const { rule } = occurrenceFor('0025', { sets: 4, reps: 6, weight: 50 }, { id: 'o1', unit: 'kg' })
    expect(rule.preset).toBe('autoregulated')
    expect(planPhase(rule).parameters).toMatchObject({ sets: { min: 4, max: 4 }, reps: { min: 6, max: 6 }, load: { mode: 'absolute', value: 50, unit: 'kg' } })
    expect(planPhase(occurrenceFor('0025', { sets: 3, sec: 45 }, { id: 'o2' }).rule).parameters).toMatchObject({ durationSeconds: { min: 45, max: 45 }, reps: { min: 1, max: 1 } })
  })
})

describe('session semantics through buildSessionExposures', () => {
  const uncapped = (sets, reps, weight) => ruleOccurrence('0025', { options: {
    target: { mode: 'none' }, completion: [], sets: { min: sets, max: sets }, reps: { min: reps, max: reps }, load: { mode: 'absolute', value: weight, unit: 'kg' }
  } })

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
    const actual = { sets: 3, reps: 8, load: { value: 60, unit: 'kg' } }
    S.workouts.push({ id: 'w1', exposures: [{ ...first, actual, audit: [] }] })
    S.progression['occ-0025'] = advanceProgression({ state: null, prescription: S.prescriptions[first.prescriptionId], log: { id: first.exposureId, actual }, now: '2026-09-24T01:00:00.000Z' })
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
  it('an assisted machine warms up with more help than its work sets, not less (#581)', () => {
    const id = Object.keys(EXIDX).find(k => isAssisted(k))
    const p = run(occ(id, { mode: 'smart', count: 2 }))
    const work = p.rows[0].load.value
    expect(p.warmupRows).toHaveLength(2)
    expect(p.warmupRows.every(r => r.load.value > work)).toBe(true)
    expect(p.warmupRows[0].load.value).toBeGreaterThan(p.warmupRows[1].load.value)
  })
  it('an exposure says how it is logged: the occurrence\'s mode, else the catalogue\'s, and a bare duration is a hold', () => {
    const exposure = ex => buildSessionExposures({ workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {} }, { id: 'rt', ex: [ex] }, { now: 0, newId: s => s })[0]
    const cardio = { ...occ('3220'), mode: 'cardio' }
    expect(exposure(cardio).mode).toBe('cardio')
    expect(exposure({ ...occ('2331') }).mode).toBe('cardio')   // the catalogue knows it is cardio
    expect(exposure(occ('0025')).mode).toBe('reps')
    const hold = occ('0001')
    hold.rule = editPlan(hold.rule, { durationSeconds: { min: 30, max: 30 } })
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

describe('rung exercises', () => {
  // A pull-up occurrence whose chain starts on the assisted machine, then chin-ups, then a named hold.
  const chain = [{ name: 'Assisted', exerciseId: '0017' }, { name: 'Chin-up', exerciseId: '1326' }, 'Weighted hold']
  const ladder = (rungs = chain) => ruleOccurrence('0652', { preset: 'bodyweight_ladder', options: { rungs, sets: { min: 1, max: 1 }, reps: { min: 1, max: 2 }, completion: [] } })
  // The track's state from a real finish (so its planFingerprint is stamped), moved to `difficulty`.
  const at = (occ, difficulty, over = {}) => {
    const p = generatePrescription({ id: 'p0', now: '2026-09-24T00:00:00.000Z', trackId: occ.occurrenceId, rule: occ.rule })
    const s = advanceProgression({ state: null, prescription: p, log: { id: 'l0', actual: { sets: 1, reps: 1 } }, now: '2026-09-24T01:00:00.000Z' })
    return profile({ progression: { [occ.occurrenceId]: { ...s, values: { ...s.values, difficulty }, ...over } } })
  }

  it('effectiveExerciseId follows the rung, a label-only rung keeping the occurrence', () => {
    const occ = ladder()
    expect([0, 1, 2].map(d => effectiveExerciseId(occ, at(occ, d)))).toEqual(['0017', '1326', '0652'])
  })

  it('starts on rung 0, and a chain of names never changes the exercise', () => {
    expect(effectiveExerciseId(ladder(), profile())).toBe('0017')
    expect(effectiveExerciseId(ladder(['easy', 'hard']), at(ladder(['easy', 'hard']), 1))).toBe('0652')
    expect(effectiveExerciseId(ruleOccurrence('0025'), profile())).toBe('0025')
  })

  it('a plan edit restarts the track, and its exercise, at rung 0', () => {
    const occ = ladder()
    expect(effectiveExerciseId(occ, at(occ, 1, { planFingerprint: 'an older plan' }))).toBe('0017')
  })

  it('a rungs list shortened below the current rung clamps to the last rung', () => {
    const occ = ladder()
    expect(effectiveExerciseId(occ, at(occ, 5))).toBe('0652')
    const two = ladder(chain.slice(0, 2))
    expect(effectiveExerciseId(two, at(two, 5))).toBe('1326')
  })

  it('a rung exercise that no longer exists falls back to the occurrence', () => {
    const occ = ladder([{ name: 'Gone', exerciseId: 'c-deleted' }, 'b'])
    expect(effectiveExerciseId(occ, profile())).toBe('0652')
  })

  it('the session logs the rung exercise on the same track', () => {
    const occ = ladder()
    const S = at(occ, 1)
    const [x] = buildSessionExposures(S, { id: 'r1', ex: [occ] }, ctx)
    expect(x).toMatchObject({ exerciseId: '1326', exerciseNameSnapshot: '1326', trackId: occ.occurrenceId, occurrenceId: occ.occurrenceId })
    expect(S.prescriptions[x.prescriptionId].exerciseId).toBe('0652')
  })

  // Shared by both "Any workout" tests: a logged exposure of `exerciseId` on `trackId`.
  const work = { role: 'work', status: 'completed', prescribed: true, observations: [{ metric: 'repetitions', unit: 'reps', value: 5 }], resistance: { kind: 'external-load', value: 30, unit: 'kg' } }
  const logOf = (exposureId, exerciseId, trackId, prescriptionId, day) => ({ id: 'w-' + exposureId, d: `2026-09-0${day}`, start: Date.UTC(2026, 8, day), exposures: [{ exposureId, exerciseId, trackId, prescriptionId, actual: { sets: 1, reps: 5, load: { value: 30, unit: 'kg' } }, performance: { sets: [work] }, excludedFromProgression: false }] })
  const linearOn = (id, trackId) => generatePrescription({ id: 'p-' + trackId, now: '2026-09-01T00:00:00.000Z', trackId, rule: ruleOccurrence(id, { options: { load: { mode: 'absolute', value: 30, unit: 'kg' } } }).rule })

  it('"Any workout" borrows the rung exercise\'s log from another routine', () => {
    const occ = ladder()
    const other = linearOn('0017', 'occ-other')
    const source = d => {
      const S = Object.assign(at(occ, d), { lastFrom: 'any', workouts: [logOf('other', '0017', 'occ-other', other.id, 1)], prescriptions: { [other.id]: other } })
      const [x] = buildSessionExposures(S, { id: 'r1', ex: [occ] }, ctx)
      return S.prescriptions[x.prescriptionId].provenance.sourceLogId
    }
    expect(source(0)).toBe('other')
    expect(source(1)).toBe(null)
  })

  it('"Any workout" never hands a chain the state of another routine\'s track', () => {
    const occ = ladder()
    const p0 = generatePrescription({ id: 'p0', now: '2026-09-01T00:00:00.000Z', trackId: occ.occurrenceId, rule: occ.rule })
    const s0 = advanceProgression({ state: null, prescription: p0, log: { id: 'own', actual: { sets: 1, reps: 1 } }, now: '2026-09-01T01:00:00.000Z' })
    const other = linearOn('1326', 'occ-other')
    const S = profile({
      lastFrom: 'any',
      workouts: [logOf('own', '0017', occ.occurrenceId, 'p0', 1), logOf('other', '1326', 'occ-other', other.id, 2)],
      prescriptions: { p0, [other.id]: other },
      progression: {
        [occ.occurrenceId]: { ...s0, values: { ...s0.values, difficulty: 1 } },
        'occ-other': advanceProgression({ state: null, prescription: other, log: { id: 'other', actual: { sets: 3, reps: 5, load: { value: 30, unit: 'kg' } } }, now: '2026-09-02T01:00:00.000Z' })
      }
    })
    const [x] = buildSessionExposures(S, { id: 'r1', ex: [occ] }, ctx)
    expect(x.exerciseId).toBe('1326')
    expect(S.prescriptions[x.prescriptionId].values.difficulty).toBe(1)
  })
})
