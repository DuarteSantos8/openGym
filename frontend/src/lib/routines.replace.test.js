import { describe, expect, it } from 'vitest'
import { defaultOccurrence, replaceSlotExercise } from './routines.js'
import { defaultPlanRule, planPhase } from './prescription/index.js'

const BENCH = '0025', PULLUP = '0652', TREADMILL = '3666'
const slot = (exerciseId, over = {}) => ({ occurrenceId: 'o1', exerciseId, rule: { ...defaultPlanRule('linear', { id: 'o1', exerciseId, routineId: 'r', unit: 'kg' }), revision: 3 }, ...over })

describe('replaceSlotExercise', () => {
  it('picking the exercise already in the slot changes nothing', () => {
    const s = slot(BENCH)
    expect(replaceSlotExercise(s, BENCH, { unit: 'kg' }, 'r')).toEqual(s)
  })

  it('the same kind of work keeps the rule, note and superset, on a new occurrence with its own progression line', () => {
    const s = slot(BENCH, { note: 'pause', sg: 'g' })
    const out = replaceSlotExercise(s, '0026', { unit: 'kg' }, 'r')
    expect(out).toMatchObject({ exerciseId: '0026', note: 'pause', sg: 'g' })
    expect(out.occurrenceId).not.toBe('o1')
    expect(out.rule).toMatchObject({ id: out.occurrenceId, exerciseId: '0026', preset: 'linear', revision: 1 })
    expect(planPhase(out.rule).parameters).toEqual(planPhase(s.rule).parameters)
  })

  it('the 1RM the old exercise adopted, and its 1RM preference, stay with it: the new one asks for its own', () => {
    const s = slot(BENCH, { ref: { id: 'b100', exerciseId: BENCH, value: 100, unit: 'kg', source: 'manual', capturedAt: '2026-10-01T00:00:00.000Z' }, refs: 'keep', note: 'pause' })
    const out = replaceSlotExercise(s, '0047', { unit: 'kg' }, 'r')
    expect(out).toMatchObject({ exerciseId: '0047', note: 'pause' })
    expect(out).not.toHaveProperty('ref')
    expect(out).not.toHaveProperty('refs')
  })

  it('an assisted override belongs to the movement: a replacement follows its own, and a catalogue machine counts as one', () => {
    const out = replaceSlotExercise(slot(BENCH, { assisted: true }), '0026', { unit: 'kg' }, 'r')
    expect(out).not.toHaveProperty('assisted')
    // A bench press marked assisted is not the same kind of work as a plain barbell exercise.
    expect(out.rule.preset).toBe('linear')
    expect(replaceSlotExercise(slot(BENCH, { assisted: true }), PULLUP, { unit: 'kg' }, 'r').rule.preset).toBe('bodyweight_ladder')
    // And an assistance machine replaced by a plain lift restarts from that lift's default.
    const MACHINE = '0009'
    expect(planPhase(replaceSlotExercise(slot(MACHINE), BENCH, { unit: 'kg' }, 'r').rule).parameters.reps).toEqual({ min: 5, max: 5 })
  })

  it('between kinds (lifting ↔ cardio) only the note and superset survive; the rule is the new exercise\'s default', () => {
    const out = replaceSlotExercise(slot(BENCH, { note: 'x', sg: 'g' }), TREADMILL, { unit: 'kg' }, 'r')
    expect(out).toMatchObject({ exerciseId: TREADMILL, note: 'x', sg: 'g' })
    expect(out.rule.preset).toBe('autoregulated')
  })
  // v1's rules (#110), which the first v2 cut had narrowed to "same kind or start over".
  it('drops the flags that describe the old movement, so the new exercise follows its own', () => {
    const out = replaceSlotExercise(slot('0293', { side: true, bodyweight: false, assisted: false }), BENCH, { unit: 'kg' }, 'r')
    expect(out).not.toHaveProperty('side')
    expect(out).not.toHaveProperty('bodyweight')
    expect(out).not.toHaveProperty('assisted')
  })

  it('a load that means something else on the new movement goes back to nothing, the sets, reps and rest stay', () => {
    const s = slot(BENCH, { note: 'n' })
    s.rule = defaultPlanRule('linear', { id: 'o1', exerciseId: BENCH, routineId: 'r', unit: 'kg', sets: { min: 4, max: 4 }, reps: { min: 8, max: 8 }, load: { mode: 'absolute', value: 60, unit: 'kg' }, restSeconds: 150 })
    const p = planPhase(replaceSlotExercise(s, PULLUP, { unit: 'kg' }, 'r').rule).parameters
    expect([p.sets.min, p.reps.min, p.restSeconds]).toEqual([4, 8, 150])
    expect(p.load.value > 0).toBe(false)   // 60 kg on a bench is not 60 kg added to a pull-up
  })

  it('between cardio and lifting the new exercise starts from its own defaults, keeping the note, the rest and the superset', () => {
    const s = slot(BENCH, { note: 'n', sg: 'g' })
    s.rule = defaultPlanRule('linear', { id: 'o1', exerciseId: BENCH, routineId: 'r', unit: 'kg', restSeconds: 75 })
    const out = replaceSlotExercise(s, TREADMILL, { unit: 'kg' }, 'r')
    expect(out).toMatchObject({ exerciseId: TREADMILL, note: 'n', sg: 'g', mode: 'cardio', cardio: { sets: 1, min: 20, speed: 5 } })
    expect(planPhase(out.rule).parameters.restSeconds).toBe(75)
  })

  it('a replacement that has been logged opens at its own planned weight, one never logged keeps the slot\'s', () => {
    const p1 = { id: 'p1', ruleSnapshot: defaultPlanRule('linear', { id: 'x', exerciseId: '0047', routineId: 'other', unit: 'kg', load: { mode: 'absolute', value: 40, unit: 'kg' } }) }
    const S = { unit: 'kg', prescriptions: { p1 }, workouts: [{ id: 'w', d: '2026-09-01', exposures: [{ exposureId: 'e', exerciseId: '0047', routineId: 'other', prescriptionId: 'p1', excludedFromProgression: false, performance: { sets: [] } }] }] }
    const s = slot(BENCH)
    s.rule = defaultPlanRule('linear', { id: 'o1', exerciseId: BENCH, routineId: 'r', unit: 'kg', load: { mode: 'absolute', value: 80, unit: 'kg' } })
    expect(planPhase(replaceSlotExercise(s, '0047', S, 'r').rule).parameters.load.value).toBe(40)
    expect(planPhase(replaceSlotExercise(s, '0026', S, 'r').rule).parameters.load.value).toBe(80)
  })
})

describe('defaultOccurrence', () => {
  it('starts a new exercise as v1 did: 3 × 10 with the weight still to enter, no end to its progression, on the profile\'s rest', () => {
    const occ = defaultOccurrence({ unit: 'kg', restSec: 120 }, BENCH, { routineId: 'r' })
    const p = planPhase(occ.rule)
    expect([p.parameters.sets.min, p.parameters.reps.min, p.parameters.load.value || 0]).toEqual([3, 10, 0])
    expect(p.target.mode).toBe('none')
    expect(occ).toMatchObject({ exerciseId: BENCH, restFromProfile: true })
    expect(occ.rule).toMatchObject({ id: occ.occurrenceId, routineId: 'r' })
  })
  it('follows the routine\'s rule, puts a hold on the clock and a cardio exercise on minutes', () => {
    expect(defaultOccurrence({ unit: 'kg' }, BENCH, { prog: 'double' }).rule.preset).toBe('double')
    expect(planPhase(defaultOccurrence({ unit: 'kg' }, '4348').rule).parameters.durationSeconds).toEqual({ min: 45, max: 45 })
    expect(defaultOccurrence({ unit: 'kg' }, TREADMILL)).toMatchObject({ mode: 'cardio', cardio: { sets: 1, min: 20, speed: 5 } })
  })
})
