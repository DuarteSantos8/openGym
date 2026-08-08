import { describe, it, expect } from 'vitest'
import {
  rirOf, toScale, displayScale, avgRir, effortSummary, hasEffort, effortWeeks,
  effortHistogram, isHardSet, HARD_RIR, MIN_RATED
} from './effort.js'
import { isoOf } from './format.js'

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d }
// One workout on a day, with the sets given. Everything here is a finished set unless a set
// says otherwise, because that is what the stats read.
const W = (n, sets) => {
  const d = daysAgo(n)
  return { id: 'w' + n, d: isoOf(d), start: +d, entries: [{ id: '0025', sets: sets.map(s => ({ w: 60, r: 8, done: true, ...s })) }] }
}
const S = (...workouts) => ({ workouts })

describe('rirOf', () => {
  it('reads RIR straight and RPE as its mirror — RPE 8 is RIR 2', () => {
    expect(rirOf({ rir: 2 })).toBe(2)
    expect(rirOf({ rpe: 8 })).toBe(2)
    expect(rirOf({ rpe: 9.5 })).toBe(0.5)
  })

  it('keeps a rated 0 and rejects everything that only looks like one', () => {
    expect(rirOf({ rir: 0 })).toBe(0)        // taken to failure — a rating, not "empty"
    expect(rirOf({ rpe: 10 })).toBe(0)
    expect(rirOf({})).toBe(null)
    expect(rirOf({ rir: null })).toBe(null)
    expect(rirOf(null)).toBe(null)
  })

  it('prefers the scale the set itself was logged on when a file wrote both', () => {
    expect(rirOf({ rir: 3, rpe: 9 })).toBe(3)
  })
})

describe('toScale', () => {
  it('converts back to whichever scale is on screen', () => {
    expect(toScale('rir', 2)).toBe(2)
    expect(toScale('rpe', 2)).toBe(8)
    expect(toScale('rpe', 0)).toBe(10)
    expect(toScale('rir', null)).toBe(null)
  })

  it('does not let the round trip produce float dust', () => {
    expect(toScale('rpe', 10 - 7.5)).toBe(7.5)
  })
})

describe('displayScale', () => {
  it('follows the profile setting when it has one', () => {
    expect(displayScale({ effort: 'rpe', workouts: [] })).toBe('rpe')
    expect(displayScale({ effort: 'rir', workouts: [] })).toBe('rir')
  })

  it('shows an unrated profile the scale its imported history is written in', () => {
    // Effort off, but a file brought RPE with it: labelling that history "RIR" would show a
    // number the profile has never entered and mean the opposite of what it says.
    expect(displayScale({ effort: 'none', ...S(W(3, [{ rpe: 8 }, { rpe: 9 }])) })).toBe('rpe')
    expect(displayScale({ effort: 'none', ...S(W(3, [{ rir: 2 }])) })).toBe('rir')
    expect(displayScale({ effort: 'none', workouts: [] })).toBe('rir')
  })
})

describe('avgRir', () => {
  it('averages the rated sets and ignores the rest', () => {
    expect(avgRir([{ rir: 1 }, { rir: 3 }])).toBe(2)
    expect(avgRir([{ rir: 1 }, {}, { rpe: 7 }])).toBe(2)   // RPE 7 = RIR 3
  })

  it('is null rather than 0 when nothing was rated', () => {
    expect(avgRir([{}, { rir: null }])).toBe(null)
    expect(avgRir([])).toBe(null)
    expect(avgRir(null)).toBe(null)
  })
})

describe('effortSummary', () => {
  const st = S(
    W(2, [{ rir: 1 }, { rir: 3 }, { rir: 2 }]),
    W(4, [{ rir: 0 }, { rpe: 6 }, {}]),          // RPE 6 = RIR 4, one set unrated
    W(40, [{ rir: 5 }, { rir: 5 }])
  )

  it('counts rated sets against every finished set, not against itself', () => {
    const r = effortSummary(st, 0)
    expect(r.done).toBe(8)
    expect(r.rated).toBe(7)
  })

  it('leaves unrated sets out of the average instead of reading them as failure', () => {
    const r = effortSummary(S(W(2, [{ rir: 4 }, {}, {}, {}, {}, {}])), 0)
    expect(r.rated).toBe(1)
    expect(r.avg).toBe(null)        // one rating is not an average
  })

  it('waits for a real sample before reporting a number', () => {
    const few = S(W(2, new Array(MIN_RATED - 1).fill({ rir: 2 })))
    expect(effortSummary(few, 0).avg).toBe(null)
    const enough = S(W(2, new Array(MIN_RATED).fill({ rir: 2 })))
    expect(effortSummary(enough, 0).avg).toBe(2)
  })

  it('counts the sets taken close to failure', () => {
    const r = effortSummary(st, 0)
    expect(r.hard).toBe(4)                       // 1, 3, 2, 0 — the 4 and the two 5s are not
    expect(r.hardPct).toBeCloseTo(4 / 7)
  })

  it('honours the window', () => {
    const r = effortSummary(st, 7)
    expect(r.rated).toBe(5)                      // the 40-day-old session is out
    expect(effortSummary(st, 3).rated).toBe(3)
  })

  it('survives a profile with no training at all', () => {
    expect(effortSummary({ workouts: [] }, 30)).toEqual({ done: 0, rated: 0, hard: 0, avg: null, hardPct: null })
  })

  it('uses phase as authoritative while retaining legacy boolean warm-up fallback', () => {
    const summary = effortSummary(S(W(1, [
      { rir: 0, phase: 'warmup' },
      { rir: 1, phase: 'work', warmup: true },
      { rir: 2 }, { rir: 2 }, { rir: 2 }, { rir: 2 },
    ])), 0)
    expect(summary.done).toBe(5)
    expect(summary.rated).toBe(5)
    expect(summary.hard).toBe(5)
  })
})

describe('hasEffort', () => {
  it('decides whether the effort UI exists at all', () => {
    expect(hasEffort(S(W(2, [{ rir: 0 }])))).toBe(true)
    expect(hasEffort(S(W(2, [{ rpe: 8 }])))).toBe(true)
    expect(hasEffort(S(W(2, [{}, { rir: null }])))).toBe(false)
    expect(hasEffort({ workouts: [] })).toBe(false)
  })

  it('ignores sets that were never finished', () => {
    expect(hasEffort(S(W(2, [{ rir: 2, done: false }])))).toBe(false)
  })
})

describe('effortWeeks', () => {
  it('averages per calendar week and carries the week volume alongside', () => {
    const pts = effortWeeks(S(W(1, [{ rir: 1 }, { rir: 3 }, {}])), 0)
    expect(pts).toHaveLength(1)
    expect(pts[0].rir).toBe(2)
    expect(pts[0].n).toBe(2)        // rated
    expect(pts[0].sets).toBe(3)     // trained
  })

  it('drops a week that rests on a single tap', () => {
    expect(effortWeeks(S(W(1, [{ rir: 1 }])), 0)).toEqual([])
  })

  it('comes back oldest first, whatever order the workouts arrived in', () => {
    const pts = effortWeeks(S(W(2, [{ rir: 1 }, { rir: 1 }]), W(30, [{ rir: 3 }, { rir: 3 }])), 0)
    expect(pts.map(p => p.rir)).toEqual([3, 1])
    expect(pts[0].t).toBeLessThan(pts[1].t)
  })
})

describe('effortHistogram', () => {
  it('bins by whole steps and collapses the far end into a tail', () => {
    const h = effortHistogram(S(W(2, [{ rir: 0 }, { rir: 1.5 }, { rir: 4 }, { rir: 7 }])), 0)
    expect(h.map(b => b.n)).toEqual([1, 1, 0, 0, 2])
    expect(h[4].tail).toBe(true)
    expect(h[0].pct).toBe(0.25)
  })

  it('is all zeroes, not NaN, when nothing is rated', () => {
    const h = effortHistogram(S(W(2, [{}])), 0)
    expect(h.every(b => b.n === 0 && b.pct === 0)).toBe(true)
  })
})

describe('isHardSet', () => {
  it('draws the line at the effort that actually drives adaptation', () => {
    expect(isHardSet({ rir: HARD_RIR })).toBe(true)
    expect(isHardSet({ rir: HARD_RIR + 0.5 })).toBe(false)
    expect(isHardSet({ rpe: 10 })).toBe(true)
    expect(isHardSet({})).toBe(false)          // unrated is not hard, and not easy either
  })
})
