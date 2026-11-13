import { describe, expect, it } from 'vitest'
import { recordBaseline, recordKindsOf, entryRecords, savedEntryRecords, recordHint, repRecordTable, repsRecordAt, repFactor, liveRecordsOn, recordHintsOn, recordSoundOn } from './set-records.js'
import { sessionPrs, isWeightPr } from './finish-workout.js'
import { estimate1RM } from './onerm.js'

const BENCH = '0025'
const ASSISTED = '0017'
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const wo = (id, d, sets, exId = BENCH) => ({ id, d, start: Date.parse(d + 'T10:00:00'), entries: [{ id: exId, sets }] })
const S0 = (workouts, extra = {}) => ({ workouts, bodyweight: [], exWeights: {}, ...extra })

describe('record baseline', () => {
  it('reads the best load, estimate, set volume and every done work set, warm-ups left out', () => {
    const S = S0([wo('a', '2026-10-01', [set(40, 10, { phase: 'warmup' }), set(80, 5), set(70, 8)])])
    const b = recordBaseline(S, BENCH)
    expect(b.any).toBe(true)
    expect(b.weight).toBe(80)
    expect(b.e1rm).toBe(estimate1RM(80, 5))
    expect(b.volume).toBe(560)
    expect(b.points).toEqual([{ w: 80, r: 5, rir: null }, { w: 70, r: 8, rir: null }])
  })
  it('is empty for an exercise never logged, so the first session sets no trophies', () => {
    const b = recordBaseline(S0([]), BENCH)
    expect(b.any).toBe(false)
    expect(recordKindsOf(set(100, 5), b)).toEqual([])
  })
  it('returns the same object while the history is the same array', () => {
    const S = S0([wo('a', '2026-10-01', [set(80, 5)])])
    expect(recordBaseline(S, BENCH)).toBe(recordBaseline({ ...S }, BENCH))
  })
})

describe('record kinds', () => {
  const S = S0([wo('a', '2026-10-01', [set(80, 5), set(70, 8)])])
  const b = recordBaseline(S, BENCH)
  it('keeps the four kinds apart', () => {
    expect(recordKindsOf(set(82.5, 3), b)).toEqual(['weight'])
    expect(recordKindsOf(set(80, 6), b)).toEqual(['reps', 'e1rm'])
    expect(recordKindsOf(set(70, 9), b)).toEqual(['reps', 'volume'])
    // 75 × 8: at 75 or heavier the record is 5 reps (80 × 5), so 8 is one, and so is 600 kg.
    expect(recordKindsOf(set(75, 8), b)).toEqual(['reps', 'e1rm', 'volume'])
    expect(recordKindsOf(set(60, 8), b)).toEqual([])
  })
  it('reads reps at this weight or heavier', () => {
    expect(repsRecordAt(b, 75)).toBe(5)
    expect(repsRecordAt(b, 70)).toBe(8)
    expect(repsRecordAt(b, 85)).toBeNull()
  })
  it('a load never lifted before is a weight record, not a rep record', () => {
    expect(recordKindsOf(set(90, 1), b)).toEqual(['weight'])
  })
  it('agrees with the finish summary about load PRs', () => {
    const entry = { id: BENCH, sets: [set(82.5, 3)] }
    expect(sessionPrs(S, [entry]).prs).toEqual([BENCH])
    expect(isWeightPr(S, BENCH, 82.5)).toBe(true)
    expect(entryRecords(entry, b)[0]).toContain('weight')
    // Same weight, more reps: the summary's e1RM line, and the set's e1RM trophy.
    const more = { id: BENCH, sets: [set(80, 6)] }
    expect(sessionPrs(S, [more])).toMatchObject({ prs: [], e1prs: [{ id: BENCH }] })
    expect(entryRecords(more, b)[0]).toContain('e1rm')
  })
  it('on an assistance machine less help is the record, and it has no 1RM or volume', () => {
    const A = S0([wo('a', '2026-10-01', [set(30, 6)], ASSISTED)])
    const ab = recordBaseline(A, ASSISTED)
    expect(ab.e1rm).toBe(0)
    expect(recordKindsOf(set(25, 4), ab)).toEqual(['weight'])
    expect(recordKindsOf(set(30, 8), ab)).toEqual(['reps'])
    expect(recordKindsOf(set(35, 5), ab)).toEqual([])
  })
  it('a bodyweight lift has rep records only', () => {
    const P = S0([wo('a', '2026-10-01', [set(0, 10)])])
    const pb = recordBaseline(P, BENCH)
    expect(recordKindsOf(set(0, 11), pb)).toEqual(['reps'])
    expect(recordKindsOf(set(0, 10), pb)).toEqual([])
  })
})

describe('entry records', () => {
  const S = S0([wo('a', '2026-10-01', [set(80, 5)])])
  const b = recordBaseline(S, BENCH)
  it('holds each set against the history and the done sets above it', () => {
    const entry = { id: BENCH, sets: [set(82.5, 5), set(85, 5), set(85, 4), { w: 90, r: 5, done: false }] }
    const rec = entryRecords(entry, b)
    expect(rec[0]).toEqual(['weight', 'e1rm', 'volume'])
    expect(rec[1]).toEqual(['weight', 'e1rm', 'volume'])
    expect(rec[2]).toEqual([])
    expect(rec[3]).toEqual([])
  })
  it('skips warm-ups and counts each side of a per-side row', () => {
    const side = { sides: { L: { w: 80, r: 6, done: true }, R: { w: 80, r: 5, done: true } }, done: true }
    const rec = entryRecords({ id: BENCH, sets: [set(100, 1, { phase: 'warmup' }), side] }, b)
    expect(rec[0]).toEqual([])
    expect(rec[1]).toEqual(['reps', 'e1rm', 'volume'])
  })
  it('marks a saved workout against the workouts before it only', () => {
    const w1 = wo('a', '2026-10-01', [set(80, 5)])
    const w2 = wo('b', '2026-10-08', [set(85, 5)])
    const w3 = wo('c', '2026-10-15', [set(90, 5)])
    const H = S0([w1, w2, w3])
    expect(savedEntryRecords(H, w1, w1.entries[0])[0]).toEqual([])
    expect(savedEntryRecords(H, w2, w2.entries[0])[0]).toContain('weight')
    expect(savedEntryRecords(H, w3, w3.entries[0])[0]).toContain('weight')
  })
})

describe('record hint', () => {
  const S = S0([wo('a', '2026-10-01', [set(100, 5), set(80, 8)])])
  const b = recordBaseline(S, BENCH)
  it('says the share of the best estimate and the reps to a rep record', () => {
    const best = estimate1RM(100, 5)
    const h = recordHint({ w: 80, r: 6 }, b)
    expect(h.pct).toBe(Math.round(estimate1RM(80, 6) / best * 100))
    expect(h.moreReps).toBe(3)
    expect(h.record).toEqual([])
  })
  it('says nothing about reps when the plan already beats them', () => {
    const h = recordHint({ w: 100, r: 6 }, b)
    expect(h.moreReps).toBeNull()
    expect(h.record).toContain('reps')
    expect(h.pct).toBeGreaterThan(100)
  })
  it('is null for the first time and for a row without reps', () => {
    expect(recordHint({ w: 80, r: 6 }, recordBaseline(S0([]), BENCH))).toBeNull()
    expect(recordHint({ w: 80, r: 0 }, b)).toBeNull()
  })
  it('follows the formula the profile chose', () => {
    const e = recordHint({ w: 80, r: 8 }, recordBaseline(S, BENCH, { formula: 'epley' }), 'epley')
    const z = recordHint({ w: 80, r: 8 }, recordBaseline(S, BENCH, { formula: 'brzycki' }), 'brzycki')
    expect(e.pct).toBe(Math.round(estimate1RM(80, 8, 'epley') / estimate1RM(100, 5, 'epley') * 100))
    expect(z.pct).toBe(Math.round(estimate1RM(80, 8, 'brzycki') / estimate1RM(100, 5, 'brzycki') * 100))
  })
})

describe('rep-record table', () => {
  it('lists the heaviest weight for at least N reps with its date, and what the 1RM says is possible', () => {
    const S = S0([wo('a', '2026-10-01', [set(100, 5)]), wo('b', '2026-10-08', [set(80, 10), set(105, 2)])])
    const rows = repRecordTable(S, BENCH)
    expect(rows).toHaveLength(12)
    expect(rows[0]).toMatchObject({ r: 1, best: { w: 105, d: '2026-10-08' } })
    expect(rows[2]).toMatchObject({ r: 3, best: { w: 100, d: '2026-10-01' } })
    expect(rows[5]).toMatchObject({ r: 6, best: { w: 80, d: '2026-10-08' } })
    expect(rows[10].best).toBeNull()
    // Best estimate 100 × 5 Epley = 116.7; 8 reps possible = 116.7 / (1 + 8/30) = 92.1 → 92.
    expect(rows[7].possible).toBe(92)
    expect(rows[0].possible).toBe(Math.round(estimate1RM(100, 5) * 2) / 2)
  })
  it('the factor inverts every formula', () => {
    for (const f of ['epley', 'brzycki', 'lombardi', 'oconner', 'mayhew', 'wathan', 'lander', 'weighted']) {
      const e = estimate1RM(80, 6, f)
      expect(80 * repFactor(6, f)).toBeCloseTo(e, 0)
    }
  })
  it('is empty without loaded rep work', () => {
    expect(repRecordTable(S0([wo('a', '2026-10-01', [set(0, 10)])]), BENCH)).toEqual([])
  })
})

describe('switches', () => {
  it('are on unless switched off', () => {
    expect(liveRecordsOn({})).toBe(true)
    expect(recordHintsOn({})).toBe(true)
    expect(recordSoundOn({})).toBe(true)
    expect(liveRecordsOn({ liveRecords: false })).toBe(false)
    expect(recordHintsOn({ recordHints: false })).toBe(false)
    expect(recordSoundOn({ recordSound: false })).toBe(false)
  })
})
