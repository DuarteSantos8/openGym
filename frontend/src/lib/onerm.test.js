import { describe, it, expect } from 'vitest'
import { estimate1RM, bestSetOf, e1rmSeries, best1RM, is1RMRecord, REP_CAP, WEIGHTED_REP_CAP, FORMULAS, calculate1RMAccuracy } from './onerm.js'

describe('estimate1RM', () => {
  it('returns the load unchanged for a single rep', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(62.5, 1)).toBe(62.5)
  })

  it('matches Epley by hand across the usual rep ranges', () => {
    expect(estimate1RM(100, 5)).toBe(116.7)   // 100 · (1 + 5/30)
    expect(estimate1RM(100, 10)).toBe(133.3)
    expect(estimate1RM(80, 8)).toBe(101.3)
    expect(estimate1RM(60, 3)).toBe(66)
  })

  it('rounds to one decimal', () => {
    expect(estimate1RM(101.25, 7)).toBe(124.9)
    expect(Number.isInteger(estimate1RM(100, 3) * 10)).toBe(true)
  })

  it('refuses reps beyond the cap rather than guessing', () => {
    expect(estimate1RM(100, REP_CAP)).not.toBeNull()
    expect(estimate1RM(100, REP_CAP + 1)).toBeNull()
    expect(estimate1RM(60, 30)).toBeNull()
  })

  it('rejects invalid, zero and negative input', () => {
    expect(estimate1RM(0, 5)).toBeNull()
    expect(estimate1RM(-100, 5)).toBeNull()
    expect(estimate1RM(100, 0)).toBeNull()
    expect(estimate1RM(100, -3)).toBeNull()
    expect(estimate1RM(undefined, 5)).toBeNull()
    expect(estimate1RM(100, undefined)).toBeNull()
    expect(estimate1RM(NaN, 5)).toBeNull()
    expect(estimate1RM(Infinity, 5)).toBeNull()
    expect(estimate1RM('', '')).toBeNull()
  })

  it('accepts numeric strings, the shape number inputs arrive in', () => {
    expect(estimate1RM('100', '5')).toBe(116.7)
  })

  it('offers the other documented formulas and agrees with them at low reps', () => {
    expect(estimate1RM(100, 5, 'brzycki')).toBe(112.5)
    expect(estimate1RM(100, 5, 'lombardi')).toBe(117.5)
    expect(Object.keys(FORMULAS)).toContain('epley')
  })

  it('keeps the formulas within a few percent up to 8 reps, and diverges most at the cap', () => {
    const spread = r => Math.max(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
      - Math.min(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
    expect(spread(1)).toBe(0)                       // one rep is measured, not estimated
    for (let r = 2; r <= 8; r++) expect(spread(r)).toBeLessThan(10)
    const upTo = []
    for (let r = 1; r < REP_CAP; r++) upTo.push(spread(r))
    expect(spread(REP_CAP)).toBeGreaterThan(Math.max(...upTo))   // why REP_CAP exists
  })

  it('falls back to the default for an unknown formula name', () => {
    expect(estimate1RM(100, 5, 'nope')).toBe(estimate1RM(100, 5))
  })
})

describe('new formulas (oconner, mayhew, wathan, lander)', () => {
  it('O\'Conner matches hand calculation at r=5', () => {
    // w * (1 + r/40) = 100 * (1 + 5/40) = 112.5
    expect(estimate1RM(100, 5, 'oconner')).toBe(112.5)
  })

  it('Mayhew matches hand calculation at r=5', () => {
    // (100*100) / (52.2 + 41.9*exp(-0.055*5)) ≈ 119.0
    const expected = (100 * 100) / (52.2 + 41.9 * Math.exp(-0.055 * 5))
    expect(estimate1RM(100, 5, 'mayhew')).toBe(Math.round(expected * 10) / 10)
  })

  it('Wathan matches hand calculation at r=5', () => {
    const expected = (100 * 100) / (48.8 + 53.8 * Math.exp(-0.075 * 5))
    expect(estimate1RM(100, 5, 'wathan')).toBe(Math.round(expected * 10) / 10)
  })

  it('Lander matches hand calculation at r=5', () => {
    // (100*100) / (101.3 - 2.67123*5) = 10000 / 87.94 ≈ 113.7
    const expected = (100 * 100) / (101.3 - 2.67123 * 5)
    expect(estimate1RM(100, 5, 'lander')).toBe(Math.round(expected * 10) / 10)
  })

  it('all seven formulas are present in FORMULAS', () => {
    expect(Object.keys(FORMULAS)).toEqual(
      expect.arrayContaining(['epley', 'brzycki', 'lombardi', 'oconner', 'mayhew', 'wathan', 'lander']),
    )
  })
})

describe('weighted formula', () => {
  it('returns a finite estimate between the min and max of individual formulas', () => {
    const est = estimate1RM(100, 5, 'weighted')
    const vals = Object.keys(FORMULAS).map(f => estimate1RM(100, 5, f))
    expect(est).toBeGreaterThan(Math.min(...vals) - 0.1)
    expect(est).toBeLessThan(Math.max(...vals) + 0.1)
  })

  it('returns exactly w for a single rep', () => {
    expect(estimate1RM(100, 1, 'weighted')).toBe(100)
  })

  it('returns null when effective reps exceed WEIGHTED_REP_CAP', () => {
    expect(estimate1RM(100, WEIGHTED_REP_CAP, 'weighted')).not.toBeNull()
    expect(estimate1RM(100, WEIGHTED_REP_CAP + 1, 'weighted')).toBeNull()
  })

  it('accepts reps above REP_CAP but within WEIGHTED_REP_CAP', () => {
    expect(estimate1RM(100, 13, 'weighted')).not.toBeNull()
    expect(estimate1RM(100, 13, 'epley')).toBeNull()
  })

  it('rounds to one decimal', () => {
    const est = estimate1RM(100, 8, 'weighted')
    expect(Number.isInteger(est * 10)).toBe(true)
  })
})

describe('RIR handling', () => {
  it('exactly 1 rep with RIR 0 returns the weight unchanged', () => {
    expect(estimate1RM(100, 1, 'weighted', 0)).toBe(100)
    expect(estimate1RM(80, 1, 'epley', 0)).toBe(80)
  })

  it('weighted with RIR computes effective reps for the formula ensemble', () => {
    // 5 reps with RIR 2 → effectiveReps 7. Every formula is increasing in reps,
    // and more reps to failure pushes the frozen %1RM estimate up.
    const withRir = estimate1RM(100, 5, 'weighted', 2)
    const withoutRir = estimate1RM(100, 5, 'weighted')
    expect(withRir).toBeGreaterThan(withoutRir)
  })

  it('RIR map estimate alone (e.g. RIR 2, 5 reps) ≈ weight / 0.892', () => {
    // effectiveReps = 7 → RIR_PCT[6] = 81.1 → 100/0.811 ≈ 123.3
    const est = estimate1RM(100, 5, 'weighted', 2)
    expect(est).toBeGreaterThan(110)
    expect(est).toBeLessThan(140)
  })

  it('returns null when effective reps exceed WEIGHTED_REP_CAP', () => {
    // 13 reps + RIR 3 = 16 > 15
    expect(estimate1RM(100, 13, 'weighted', 3)).toBeNull()
  })

  it('ignores negative or non-numeric RIR', () => {
    expect(estimate1RM(100, 5, 'weighted', -1)).toBe(estimate1RM(100, 5, 'weighted'))
    expect(estimate1RM(100, 5, 'weighted', 'abc')).toBe(estimate1RM(100, 5, 'weighted'))
  })

  it('individual formulas ignore the RIR parameter', () => {
    expect(estimate1RM(100, 5, 'epley', 2)).toBe(estimate1RM(100, 5, 'epley'))
  })
})

describe('calculate1RMAccuracy', () => {
  it('returns 1 for a single rep to failure', () => {
    expect(calculate1RMAccuracy(1, 0)).toBe(1)
  })

  it('returns 0 for reps beyond WEIGHTED_REP_CAP', () => {
    expect(calculate1RMAccuracy(WEIGHTED_REP_CAP + 1)).toBe(0)
  })

  it('returns 0 for non-positive or non-finite input', () => {
    expect(calculate1RMAccuracy(0)).toBe(0)
    expect(calculate1RMAccuracy(-1)).toBe(0)
    expect(calculate1RMAccuracy(NaN)).toBe(0)
  })

  it('decreases accuracy as reps increase', () => {
    const a3 = calculate1RMAccuracy(3)
    const a8 = calculate1RMAccuracy(8)
    const a13 = calculate1RMAccuracy(13)
    expect(a3).toBeGreaterThan(a8)
    expect(a8).toBeGreaterThan(a13)
  })

  it('penalises RIR presence by ~8%', () => {
    const noRir = calculate1RMAccuracy(5)
    const withRir = calculate1RMAccuracy(5, 2)
    // 2-decimal rounding on the final product hides the exact ratio; allow a tolerance
    expect(withRir).toBeCloseTo(noRir * 0.92, 1)
  })

  it('RIR 0 does not penalise (to failure)', () => {
    expect(calculate1RMAccuracy(5, 0)).toBe(calculate1RMAccuracy(5))
  })

  it('returns a value between 0 and 1', () => {
    for (let r = 1; r <= WEIGHTED_REP_CAP; r++) {
      const acc = calculate1RMAccuracy(r)
      expect(acc).toBeGreaterThanOrEqual(0)
      expect(acc).toBeLessThanOrEqual(1)
    }
  })

  it('spread factor applies only to the weighted formula', () => {
    const weightedAcc = calculate1RMAccuracy(8, null, 'weighted')
    const epleyAcc = calculate1RMAccuracy(8, null, 'epley')
    // weighted should be ≤ epley because it adds the spread penalty
    expect(weightedAcc).toBeLessThanOrEqual(epleyAcc)
  })
})

describe('bestSetOf', () => {
  it('picks the highest estimate, not the heaviest set', () => {
    const entry = { id: 'x', sets: [
      { w: 100, r: 5, done: true },   // 116.7
      { w: 110, r: 3, done: true },   // 121.0
      { w: 120, r: 1, done: true }    // 120.0
    ] }
    expect(bestSetOf(entry)).toEqual({ est: 121, w: 110, r: 3 })
  })

  it('ignores sets that were never checked off', () => {
    const entry = { id: 'x', sets: [{ w: 100, r: 5, done: true }, { w: 200, r: 5, done: false }] }
    expect(bestSetOf(entry).w).toBe(100)
  })

  it('ignores topW, which carries no rep count', () => {
    const entry = { id: 'x', topW: 200, sets: [{ w: 100, r: 5, done: true }] }
    expect(bestSetOf(entry).est).toBe(116.7)
  })

  it('returns null for cardio and timed entries', () => {
    expect(bestSetOf({ id: 'c', sets: [{ min: 20, speed: 9, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 0, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 20, done: true }] })).toBeNull()
  })

  it('survives a missing or empty entry', () => {
    expect(bestSetOf(null)).toBeNull()
    expect(bestSetOf({ sets: [] })).toBeNull()
  })
})

const S = {
  workouts: [
    { d: '2026-01-01', start: 1, entries: [{ id: 'bench', sets: [{ w: 80, r: 5, done: true }] }] },
    { d: '2026-01-08', start: 2, entries: [{ id: 'squat', sets: [{ w: 100, r: 5, done: true }] }] },
    { d: '2026-01-15', start: 3, entries: [{ id: 'bench', sets: [{ w: 90, r: 5, done: true }, { w: 90, r: 3, done: false }] }] },
    { d: '2026-01-22', start: 4, entries: [{ id: 'bench', sets: [{ w: 85, r: 5, done: true }] }] },
    { d: '2026-01-29', start: 5, entries: [{ id: 'run', sets: [{ min: 30, speed: 10, done: true }] }] }
  ]
}

describe('e1rmSeries / best1RM', () => {
  it('yields one chronological point per workout that produced an estimate', () => {
    const pts = e1rmSeries(S, 'bench')
    expect(pts.map(p => p.d)).toEqual(['2026-01-01', '2026-01-15', '2026-01-22'])
    expect(pts.map(p => p.y)).toEqual([93.3, 105, 99.2])
  })

  it('reports the all-time best with the set behind it', () => {
    expect(best1RM(S, 'bench')).toEqual({ est: 105, w: 90, r: 5, d: '2026-01-15', t: 3 })
  })

  it('has nothing to say about cardio or an unknown exercise', () => {
    expect(e1rmSeries(S, 'run')).toEqual([])
    expect(best1RM(S, 'run')).toBeNull()
    expect(best1RM(S, 'nope')).toBeNull()
    expect(best1RM({ workouts: [] }, 'bench')).toBeNull()
    expect(best1RM({}, 'bench')).toBeNull()
  })

  it('takes the strongest duplicate occurrence once per dated workout', () => {
    const workouts = [{ d: '2026-02-01', start: 1, entries: [
      { id: 'bench', sets: [{ w: 60, r: 5, done: true }] },
      { id: 'bench', sets: [{ w: 100, r: 5, done: true }] },
    ] }]
    expect(e1rmSeries({ workouts }, 'bench')).toEqual([{ t: 1, d: '2026-02-01', y: 116.7, w: 100, r: 5 }])
    expect(best1RM({ workouts }, 'bench')).toMatchObject({ est: 116.7, w: 100, r: 5, d: '2026-02-01' })
  })

  it('estimates each completed per-side limb and leaves timed/cardio rows out', () => {
    const sides = { id: 'bench', target: { mode: 'reps', side: true }, sets: [{ w: 100, r: 10, done: false,
      sides: { L: { w: 100, r: 5, done: true }, R: { w: 90, r: 5, done: false } } }] }
    expect(bestSetOf(sides)).toEqual({ est: 116.7, w: 100, r: 5 })
    expect(e1rmSeries({ workouts: [{ start: 1, d: '2026-02-01', entries: [sides] }] }, 'bench'))
      .toEqual([{ t: 1, d: '2026-02-01', y: 116.7, w: 100, r: 5 }])
    expect(e1rmSeries({ workouts: [{ start: 1, d: '2026-02-01', entries: [
      { id: 'hold', target: { mode: 'time' }, sets: [{ sec: 60, w: 200, r: 5, done: true }] },
      { id: 'run', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 9, r: 5, done: true }] },
    ] }] }, 'hold')).toEqual([])
  })
})

describe('is1RMRecord', () => {
  it('flags a session that beats every previous estimate', () => {
    const rec = is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 95, r: 5, done: true }] })
    expect(rec).toEqual({ est: 110.8, w: 95, r: 5, prev: 105 })
  })

  it('stays quiet when the session does not beat the record', () => {
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 90, r: 5, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 80, r: 5, done: true }] })).toBeNull()
  })

  it('counts the first ever estimate as a record', () => {
    const rec = is1RMRecord(S, 'deadlift', { id: 'deadlift', sets: [{ w: 140, r: 3, done: true }] })
    expect(rec.prev).toBe(0)
    expect(rec.est).toBe(154)
  })

  it('says nothing for a timed or unfinished entry', () => {
    expect(is1RMRecord(S, 'plank', { id: 'plank', sets: [{ sec: 90, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 200, r: 5, done: false }] })).toBeNull()
  })
})


describe('drop-sets, rest-pause sets and 1RM', () => {
  it('estimates only from the main/activation weight×reps, ignoring lighter drops', () => {
    const entry = { id: 'x', sets: [
      { type: 'dropset', w: 100, r: 5, done: true, drops: [{ w: 80, r: 5 }, { w: 60, r: 5 }] },
    ] }
    expect(bestSetOf(entry)).toEqual(bestSetOf({ id: 'x', sets: [{ w: 100, r: 5, done: true }] }))
  })

  it('estimates only from the row\'s own w/r, ignoring rest-pause bursts', () => {
    const entry = { id: 'x', sets: [
      { type: 'restpause', w: 60, r: 8, done: true, clusters: [{ r: 4, restSec: 15 }, { r: 3, restSec: 15 }] },
    ] }
    expect(bestSetOf(entry)).toEqual(bestSetOf({ id: 'x', sets: [{ w: 60, r: 8, done: true }] }))
  })

  it('refuses to estimate a planned rest-pause row once its total reps exceed REP_CAP, same as any other high-rep set', () => {
    const entry = { id: 'x', sets: [
      { type: 'restpause', w: 60, r: 20, done: true, clusters: [{ r: 10, restSec: 15 }, { r: 5, restSec: 15 }, { r: 3, restSec: 15 }, { r: 1, restSec: 15 }, { r: 1, restSec: 15 }] },
    ] }
    expect(bestSetOf(entry)).toBeNull()
  })
})

describe('warm-up sets and 1RM', () => {
  const ENTRY = { id: 'warm-test', sets: [
    { w: 20, r: 8, done: true, warmup: true },
    { w: 80, r: 5, done: true },
  ] }

  it('does not let a ticked-off warm-up set set or raise the estimated 1RM', () => {
    const working = { id: 'warm-test', sets: [{ w: 80, r: 5, done: true }] }
    expect(bestSetOf(ENTRY)).toEqual(bestSetOf(working))
    expect(best1RM({ workouts: [{ entries: [ENTRY] }] }, 'warm-test')).toEqual(
      best1RM({ workouts: [{ entries: [working] }] }, 'warm-test'),
    )
  })
})
