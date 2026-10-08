import { describe, it, expect } from 'vitest'
import { editPlan, legacyEntriesOf, generatePrescription } from './index.js'
import { loggedExposure, ruleOccurrence } from '../test-fixtures.js'

describe('legacyEntriesOf', () => {
  it('reads each exposure as a v1 entry, flagging warm-ups and keeping effort', () => {
    const w = { exposures: [{ ...loggedExposure('0025', [{ role: 'warmup', r: 5, w: 20 }, { r: 5, w: 60, rir: 2 }, { r: 3, w: 60, rpe: 9, done: false }]), routineId: 'r1' }] }
    expect(legacyEntriesOf(w)).toEqual([{
      id: '0025', rid: 'r1', target: { mode: 'reps' },
      sets: [
        { done: true, w: 20, r: 5, warmup: true },
        { done: true, w: 60, r: 5, rir: 2 },
        { done: false, w: 60, r: 3, rpe: 9 }
      ]
    }])
  })
  it('bodyweight rows read w: 0, cardio duration reads as minutes', () => {
    const w = { exposures: [loggedExposure('0001', [{ r: 12 }]), loggedExposure('cardio-x', [{ sec: 1200 }], { mode: 'cardio' })] }
    const [bw, cardio] = legacyEntriesOf(w)
    expect(bw.sets[0]).toEqual({ done: true, w: 0, r: 12 })
    expect(cardio.sets[0]).toEqual({ done: true, min: 20 })
  })
  it('an entry migrated without a prescription reads back with the target v1 recorded for it', () => {
    const x = { ...loggedExposure('0025', [{ r: 5, w: 60 }]), prescriptionId: null, kind: 'legacy', legacyTarget: { sets: 3, reps: 5, weight: 62.5, mode: 'reps' } }
    expect(legacyEntriesOf({ exposures: [x] })[0].target).toEqual({ sets: 3, reps: 5, weight: 62.5, mode: 'reps' })
    expect(legacyEntriesOf({ exposures: [{ ...x, legacyTarget: undefined }] })[0].target).toEqual({ mode: 'reps' })
  })
  it('a cardio target reads as minutes and speed, the v1 shape', () => {
    const rule = { ...ruleOccurrence('3220', { preset: 'autoregulated' }).rule }
    const p = generatePrescription({ id: 'p', now: '2026-09-24T10:00:00.000Z', trackId: 't', rule: editPlan(rule, { sets: { min: 2, max: 2 }, reps: { min: 1, max: 1 }, durationSeconds: { min: 1500, max: 1500 }, speed: 9.5 }) })
    const x = { ...loggedExposure('3220', [{ sec: 1500 }], { mode: 'cardio' }), prescriptionId: 'p' }
    expect(legacyEntriesOf({ exposures: [x] }, { p })[0].target).toMatchObject({ mode: 'cardio', sets: 2, min: 25, speed: 9.5 })
  })
  it('carries the exercise\'s note and its pin', () => {
    const x = loggedExposure('0025', [{ r: 5, w: 60 }])
    expect(legacyEntriesOf({ exposures: [{ ...x, performance: { ...x.performance, note: 'go narrower', notePin: true } }] })[0]).toMatchObject({ note: 'go narrower', notePin: true })
  })
  it('reads rest-pause bursts back onto the row', () => {
    const [x] = loggedExposure('0025', [{ r: 14, w: 90 }]).performance.sets.map(row => ({ ...row, clusters: [{ r: 8, restSec: 15 }, { r: 6, restSec: 15 }] }))
    expect(legacyEntriesOf({ exposures: [{ exerciseId: '0025', performance: { sets: [x] } }] })[0].sets[0])
      .toEqual({ done: true, w: 90, r: 14, type: 'restpause', clusters: [{ r: 8, restSec: 15 }, { r: 6, restSec: 15 }] })
  })
  it('takes the target from the frozen prescription', () => {
    const { rule } = ruleOccurrence('0025')
    const p = generatePrescription({ id: 'p1', now: '2026-09-26T00:00:00.000Z', trackId: 'occ-0025', rule })
    const w = { exposures: [loggedExposure('0025', [{ r: 5, w: 20 }], { prescriptionId: 'p1' })] }
    expect(legacyEntriesOf(w, { p1: p })[0].target).toEqual({ mode: 'reps', sets: p.rows.length, reps: p.prefill.reps, weight: p.parameters.load.resolved.value })
  })
  it('carries a deleted custom exercise snapshot', () => {
    const snap = { muscleWeights: { chest: 1 } }
    expect(legacyEntriesOf({ exposures: [loggedExposure('gone', [{ r: 5 }], { muscleSnapshot: snap })] })[0].muscleSnapshot).toBe(snap)
  })
  it('returns an unmigrated v1 workout untouched', () => {
    const entries = [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }]
    expect(legacyEntriesOf({ entries })).toBe(entries)
    expect(legacyEntriesOf({})).toEqual([])
  })
})
