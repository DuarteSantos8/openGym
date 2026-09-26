// Issue #232: an assistance machine carries part of your body weight, so LESS load is the
// harder set, the record, and what progression should aim for. The reporter's case: 30 kg of
// assistance, then 20 kg — the 20 is the new best, and the next session should ask for less.
import { describe, it, expect } from 'vitest'
import { isAssisted, betterWeight, beatsWeight, EXIDX } from './exercises.js'
import { bestWeightFor, bestWeightForEntry } from './history.js'
import { bestSetOf, e1rmSeries, is1RMRecord } from './onerm.js'

const ASSISTED = '0017'          // assisted pull-up, leverage machine
const PLAIN = '0025'             // barbell bench press
const set = (w, r, done = true) => ({ w, r, done })
const workout = (d, id, sets) => ({ d, start: Date.parse(d + 'T10:00:00Z'), entries: [{ id, target: { mode: 'reps', sets: 1, reps: 8, weight: sets[0].w }, sets }] })

describe('which exercises count as assisted', () => {
  it('takes the leverage machine whose name says assisted, and nothing else', () => {
    expect(isAssisted(ASSISTED)).toBe(true)
    expect(EXIDX[ASSISTED].eq).toBe('leverage machine')
    expect(isAssisted(PLAIN)).toBe(false)
    // a partner holding your legs, a medicine ball, a band, your own body — ordinary load
    for (const id of ['0011', '1708', '0014', '0970', '0697']) expect(isAssisted(id), id).toBe(false)
  })

  it('lets an exercise or a routine config say so outright', () => {
    expect(isAssisted({ id: PLAIN, assisted: true })).toBe(true)
    expect(isAssisted({ id: ASSISTED, assisted: false })).toBe(false)
    expect(isAssisted({ id: PLAIN, target: { assisted: true } })).toBe(true)
    expect(isAssisted({ n: 'My gym’s assisted dip', eq: 'leverage machine' })).toBe(true)
  })

  it('folds and compares loads the right way round', () => {
    expect(betterWeight(ASSISTED, 30, 20)).toBe(20)
    expect(betterWeight(PLAIN, 30, 20)).toBe(30)
    expect(beatsWeight(ASSISTED, 20, 30)).toBe(true)
    expect(beatsWeight(ASSISTED, 40, 30)).toBe(false)
    expect(beatsWeight(ASSISTED, 30, 0)).toBe(true)   // nothing logged yet
    expect(beatsWeight(ASSISTED, 0, 30)).toBe(false)  // no load logged is not a record
  })
})

describe('the record is the lightest assistance', () => {
  const S = { unit: 'kg', workouts: ['2026-09-01', '2026-09-08'].map((d, index) => ({ d, exposures: [{ exerciseId: ASSISTED, kind: 'legacy', performance: { sets: [{ status: 'completed', observations: [{ metric: 'repetitions', value: 8 }], resistance: { kind: 'external-load', value: index ? 20 : 30 }, segments: [] }] } }] })) }

  it('reports the smallest load as the best, across history and within a session', () => {
    expect(bestWeightFor(S, ASSISTED)).toBe(20)
    expect(bestWeightForEntry({ id: ASSISTED, sets: [set(30, 8), set(20, 8)] })).toBe(20)
    expect(bestWeightForEntry({ id: PLAIN, sets: [set(30, 8), set(20, 8)] })).toBe(30)
  })

  it('ignores an unlogged load instead of calling 0 the best', () => {
    expect(bestWeightForEntry({ id: ASSISTED, sets: [set(0, 8), set(25, 8)] })).toBe(25)
  })
})

describe('no one-rep max for an assistance machine', () => {
  it('leaves it out of the estimate, the curve and the record check', () => {
    const exposure = id => ({ exerciseId: id, performance: { sets: [{ setId: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: 8 }], resistance: { kind: 'external-load', value: 30 }, segments: [] }] } })
    const entry = exposure(ASSISTED)
    expect(bestSetOf(entry)).toBe(null)
    const S = { unit: 'kg', workouts: [workout('2026-09-01', ASSISTED, [set(30, 8)])] }
    expect(e1rmSeries(S, ASSISTED)).toEqual([])
    expect(is1RMRecord(S, ASSISTED, entry)).toBe(null)
    // the ordinary lift still gets one
    expect(bestSetOf({ exerciseId: PLAIN, performance: { sets: [{ setId: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 100 }, segments: [] }] } })).not.toBe(null)
  })
})

describe('a sync does not hand the help back', () => {
  it('keeps the smaller assistance and the larger ordinary load', async () => {
    const { mergeStates } = await import('./sync-merge.js')
    const phone = { _ts: 2000, exWeights: { [ASSISTED]: { w: 20, d: '2026-09-08' }, [PLAIN]: { w: 100, d: '2026-09-08' } } }
    const server = { _ts: 1000, exWeights: { [ASSISTED]: { w: 30, d: '2026-09-01' }, [PLAIN]: { w: 90, d: '2026-09-01' } } }
    expect(mergeStates(phone, server).exWeights[ASSISTED].w).toBe(20)
    expect(mergeStates(phone, server).exWeights[PLAIN].w).toBe(100)
    // and the other way round, so it does not depend on which copy is newer
    expect(mergeStates(server, phone).exWeights[ASSISTED].w).toBe(20)
    expect(mergeStates(server, phone).exWeights[PLAIN].w).toBe(100)
  })
})
