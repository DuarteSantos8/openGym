import { describe, it, expect } from 'vitest'
import {
  rirOf, toScale, displayScale, avgRir, effortSummary, hasEffort, effortWeeks,
  effortHistogram, isHardSet, HARD_RIR, MIN_RATED,
  effortColor, EFFORT_BANDS, EFFORT_PRESETS
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

describe('EFFORT_BANDS / EFFORT_PRESETS', () => {
  it('runs hardest-first and covers the whole scale with no gap', () => {
    // presets are the quick-pick buttons, top of the scale (0 RIR = failure) first
    expect(EFFORT_PRESETS.map(p => p.rir)).toEqual([0, 0.5, 1, 2, 3, 4])
    // only the last bucket is the collapsed "4+" tail
    expect(EFFORT_PRESETS.map(p => p.tail)).toEqual([false, false, false, false, false, true])
    // the bands are contiguous: each band's ceiling is below the next band's floor, and the
    // last reaches infinity so no rating is ever left without a colour
    expect(EFFORT_BANDS[EFFORT_BANDS.length - 1].max).toBe(Infinity)
    for (let i = 1; i < EFFORT_BANDS.length; i++) {
      expect(EFFORT_BANDS[i].rir).toBeGreaterThan(EFFORT_BANDS[i - 1].max)
    }
  })

  it('every preset carries a colour and a human description', () => {
    for (const p of EFFORT_PRESETS) {
      expect(p.color).toMatch(/^var\(--/)
      expect(typeof p.feel).toBe('string')
      expect(p.feel.length).toBeGreaterThan(0)
    }
  })
})

describe('effortColor', () => {
  it('gives each preset value its own band colour', () => {
    // hardest to easiest — the colours the picker shows on its buttons
    expect(effortColor(0)).toBe('var(--purple)')
    expect(effortColor(0.5)).toBe('var(--red)')
    expect(effortColor(1)).toBe('var(--orange)')
    expect(effortColor(2)).toBe('var(--yellow)')
    expect(effortColor(3)).toBe('var(--green)')
    expect(effortColor(4)).toBe('var(--acc-2)')
  })

  it('colours a typed in-between value by the band it falls in, never leaving it blank', () => {
    // a half-step belongs to the harder band below it — the band ceilings are inclusive, so
    // 1.5 (between "one left" and "two left") reads as the tougher of the two, its band 1 colour
    expect(effortColor(1.5)).toBe(effortColor(1))   // orange, not yellow
    expect(effortColor(2.5)).toBe(effortColor(2))   // yellow, not green
    // 0.25 sits between failure (0) and the half-rep band (0.5); by the same inclusive-ceiling
    // rule it reads as the harder one — the failure colour, never uncoloured
    expect(effortColor(0.25)).toBe(effortColor(0))
  })

  it('collapses everything past the top bucket into one colour', () => {
    // nobody reliably tells 5 from 7 reps in reserve — they are all "easy"
    expect(effortColor(4)).toBe(effortColor(7))
    expect(effortColor(4)).toBe(effortColor(10))
  })

  it('is null for an unrated set — colour means a rating, empty has none', () => {
    expect(effortColor(null)).toBe(null)
    expect(effortColor(undefined)).toBe(null)
  })

  it('reads the same colour whether the set was logged as RIR or RPE', () => {
    // the picker colours by internal RIR (via rirOf), so 0 RIR and 10 RPE match, 2 and 8 match
    expect(effortColor(rirOf({ rir: 0 }))).toBe(effortColor(rirOf({ rpe: 10 })))
    expect(effortColor(rirOf({ rir: 2 }))).toBe(effortColor(rirOf({ rpe: 8 })))
    expect(effortColor(rirOf({ rir: 0.5 }))).toBe(effortColor(rirOf({ rpe: 9.5 })))
  })
})

describe('picker preset labels', () => {
  // The picker labels each preset with its value on the active scale — the RIR presets shown
  // to an RPE profile read as 10, 9.5, 9, 8, 7, 6. This is what toScale computes per button.
  it('labels presets on the RIR scale unchanged', () => {
    expect(EFFORT_PRESETS.map(p => toScale('rir', p.rir))).toEqual([0, 0.5, 1, 2, 3, 4])
  })

  it('labels the same presets as their RPE mirror for an RPE profile', () => {
    expect(EFFORT_PRESETS.map(p => toScale('rpe', p.rir))).toEqual([10, 9.5, 9, 8, 7, 6])
  })
})
