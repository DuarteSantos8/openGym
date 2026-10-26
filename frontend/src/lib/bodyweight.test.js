import { describe, expect, it } from 'vitest'
import { weeklyWeights, weighInAt, logWeighIn } from './bodyweight.js'

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

// A weigh-in logged for an earlier day is typed today, so its `t` is not on its day.
describe('weighInAt', () => {
  const at = iso => new Date(iso).getTime()

  it('keeps the time a weigh-in was typed on its own day', () => {
    expect(weighInAt({ d: '2026-09-09', w: 80, t: at('2026-09-09T07:30:00') })).toBe(at('2026-09-09T07:30:00'))
  })

  it('puts a weigh-in typed on a later day at noon of the day it is for', () => {
    expect(weighInAt({ d: '2026-03-02', w: 84, t: at('2026-09-09T07:30:00') })).toBe(at('2026-03-02T12:00:00'))
  })

  it('puts one with no time at noon of its day', () => {
    expect(weighInAt({ d: '2026-03-02', w: 84 })).toBe(at('2026-03-02T12:00:00'))
  })
})

// The Apple Watch's weigh-in goes through here: one per day, the later one a correction.
describe('logWeighIn', () => {
  const at = iso => new Date(iso).getTime()

  it('adds a weigh-in on the day it was made, rounded to 0.1, and keeps the list in date order', () => {
    const S = { bodyweight: [{ d: '2026-10-20', w: 80 }, { d: '2026-10-10', w: 82 }] }
    expect(logWeighIn(S, '81.26', at('2026-10-15T07:00:00'))).toBe(true)
    expect(S.bodyweight.map(b => [b.d, b.w])).toEqual([['2026-10-10', 82], ['2026-10-15', 81.3], ['2026-10-20', 80]])
    expect(S.bodyweight[1].t).toBe(at('2026-10-15T07:00:00'))
  })

  it('replaces that day\'s weigh-in, dropping where the old one came from', () => {
    const S = { bodyweight: [{ d: '2026-10-15', w: 82, t: 1, src: 'health' }] }
    logWeighIn(S, 81, at('2026-10-15T21:00:00'))
    expect(S.bodyweight).toEqual([{ d: '2026-10-15', w: 81, t: at('2026-10-15T21:00:00') }])
  })

  it('starts the list on a profile that has none', () => {
    const S = {}
    expect(logWeighIn(S, 70, at('2026-10-15T07:00:00'))).toBe(true)
    expect(S.bodyweight).toHaveLength(1)
  })

  it('refuses a weight that is not a positive number, and changes nothing', () => {
    for (const w of [0, -5, 'abc', null, undefined, NaN, 0.04]) {
      const S = { bodyweight: [{ d: '2026-10-15', w: 82 }] }
      expect(logWeighIn(S, w, at('2026-10-15T07:00:00')), String(w)).toBe(false)
      expect(S.bodyweight).toEqual([{ d: '2026-10-15', w: 82 }])
    }
  })
})
