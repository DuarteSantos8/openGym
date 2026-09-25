import { describe, it, expect } from 'vitest'
import { legacyEntriesOf, generatePrescription } from './index.js'
import { loggedExposure, ruleOccurrence } from '../test-fixtures.js'

describe('legacyEntriesOf', () => {
  it('reads each exposure as a v1 entry, flagging warm-ups and keeping effort', () => {
    const w = { exposures: [{ ...loggedExposure('0025', [{ role: 'warmup', r: 5, w: 20 }, { r: 5, w: 60, rir: 2 }, { r: 3, w: 60, rpe: 9, done: false }]), routineId: 'r1' }] }
    expect(legacyEntriesOf(w)).toEqual([{
      id: '0025', rid: 'r1', target: null,
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
