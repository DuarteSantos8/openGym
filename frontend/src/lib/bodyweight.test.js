import { describe, expect, it } from 'vitest'
import { weeklyWeights, weighInMs } from './bodyweight.js'

// Discord 'Weight': every weigh-in, week by week, with the week's mean.
describe('weeklyWeights', () => {
  // 2026-09-07 is a Monday, 2026-09-13 the Sunday after it.
  const log = [
    { d: '2026-09-01', w: 81 },
    { d: '2026-09-03', w: 80 },
    { d: '2026-09-07', w: 80.5 },
    { d: '2026-09-09', w: 79.5 },
    { d: '2026-09-13', w: 79 },
  ]

  it('groups by the profile\'s week, newest week and newest weigh-in first, with means and changes', () => {
    const weeks = weeklyWeights(log, 1)
    expect(weeks.map(w => w.key)).toEqual(['2026-09-07', '2026-08-31'])
    expect(weeks[0]).toMatchObject({ n: 3, avg: 79.66666666666667 })
    expect(weeks[0].entries.map(b => b.d)).toEqual(['2026-09-13', '2026-09-09', '2026-09-07'])
    expect(weeks[1]).toMatchObject({ n: 2, avg: 80.5, delta: null })
    expect(weeks[0].delta).toBeCloseTo(-0.8333, 3)
  })

  it('moves the boundary with a Sunday week start', () => {
    const weeks = weeklyWeights(log, 0)
    expect(weeks.map(w => [w.key, w.n])).toEqual([['2026-09-13', 1], ['2026-09-06', 2], ['2026-08-30', 2]])
  })

  it('compares with the last week that has weigh-ins, not the calendar week before', () => {
    const weeks = weeklyWeights([{ d: '2026-08-03', w: 82 }, { d: '2026-09-07', w: 80 }], 1)
    expect(weeks[0].delta).toBe(-2)
  })

  it('does not rely on the stored order and skips entries it cannot place', () => {
    const weeks = weeklyWeights([{ d: '2026-09-09', w: 79 }, { d: '2026-09-07', w: 81 }, { w: 70 }, { d: '2026-09-08', w: 0 }, null], 1)
    expect(weeks).toHaveLength(1)
    expect(weeks[0]).toMatchObject({ n: 2, avg: 80 })
    expect(weeks[0].entries.map(b => b.d)).toEqual(['2026-09-09', '2026-09-07'])
    expect(weeklyWeights(undefined, 1)).toEqual([])
  })
})

// The ms a weigh-in belongs at on the timeline: noon of its own date. `t` is the entry's change
// stamp (sync-merge re-stamps it on every write, an import stamps a whole history at once —
// issue #632), so a reader that places a weigh-in by `t` piles imported entries on today.
describe('weighInMs', () => {
  it("is noon of the weigh-in's own date, whatever the change stamp says", () => {
    expect(weighInMs({ d: '2021-01-05', w: 90, t: Date.now() })).toBe(new Date('2021-01-05T12:00:00').getTime())
    expect(weighInMs({ d: '2022-12-01', w: 76.3 })).toBe(new Date('2022-12-01T12:00:00').getTime())
  })

  it('falls back to the record time only when there is no usable date', () => {
    expect(weighInMs({ w: 90, t: 123456 })).toBe(123456)
    expect(weighInMs({ d: 'not a date', w: 90, t: 123456 })).toBe(123456)
    expect(weighInMs(null)).toBeUndefined()
  })
})
