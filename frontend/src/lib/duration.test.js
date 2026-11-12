import { describe, expect, it } from 'vitest'
import { REST_MAX, REST_PAUSE_MIN, REST_PAUSE_MAX, clampDuration, splitDuration, joinDuration, fmtDuration, durationText, fmtRest,
  wheelStepOf, secRows, secAt, secRow, secPage, snapDuration } from './duration.js'

describe('the seconds wheel step', () => {
  it('is 5 only when the profile says 5; anything else is 1', () => {
    expect(wheelStepOf({ wheelStep: 5 })).toBe(5)
    for (const S of [{}, { wheelStep: 1 }, { wheelStep: '5' }, { wheelStep: 10 }, { wheelStep: null }, null, undefined]) expect(wheelStepOf(S)).toBe(1)
  })

  it('has 60 rows at 1 s and 12 at 5 s, each row its seconds', () => {
    expect(secRows(1)).toBe(60)
    expect(secRows(5)).toBe(12)
    expect(Array.from({ length: secRows(5) }, (_, i) => secAt(i, 5))).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    expect(secAt(37, 1)).toBe(37)
  })

  it('puts seconds off the grid on the row below', () => {
    expect(secRow(6, 5)).toBe(1)
    expect(secRow(5, 5)).toBe(1)
    expect(secRow(4, 5)).toBe(0)
    expect(secRow(59, 5)).toBe(11)
    expect(secRow(37, 1)).toBe(37)
  })

  it('pages by about 10 seconds', () => {
    expect(secPage(1)).toBe(10)
    expect(secPage(5)).toBe(2)
    // The sheet's read-out opens on the grid, so it says what the wheel shows and Done saves.
    expect(snapDuration(66, 5)).toBe(65)
    expect(snapDuration(66, 1)).toBe(66)
    expect(snapDuration(60, 5)).toBe(60)
    expect(snapDuration(4, 5)).toBe(0)
    expect(snapDuration(66)).toBe(66)
  })
})

describe('durations for the rest wheels', () => {
  it('has the ranges the wheels offer: rest 0 to 15:00, a rest-pause burst 5 s to 5:00', () => {
    expect(REST_MAX).toBe(900)
    expect([REST_PAUSE_MIN, REST_PAUSE_MAX]).toEqual([5, 300])
  })

  it('clamps to whole seconds in range, and reads junk as the minimum', () => {
    expect(clampDuration(105)).toBe(105)
    expect(clampDuration(1000)).toBe(900)
    expect(clampDuration(-4)).toBe(0)
    expect(clampDuration(89.6)).toBe(90)
    expect(clampDuration('75')).toBe(75)
    expect(clampDuration(undefined)).toBe(0)
    expect(clampDuration(null, 5, 300)).toBe(5)
    expect(clampDuration(2, 5, 300)).toBe(5)
  })

  it('splits and joins minutes and seconds, joining clamped', () => {
    expect(splitDuration(105)).toEqual({ m: 1, s: 45 })
    expect(splitDuration(0)).toEqual({ m: 0, s: 0 })
    expect(splitDuration(900)).toEqual({ m: 15, s: 0 })
    expect(joinDuration(2, 15)).toBe(135)
    expect(joinDuration(15, 30)).toBe(900)          // 15:30 on a 15:00 wheel
    expect(joinDuration(0, 3, 5, 300)).toBe(5)      // under the burst minimum
    expect(joinDuration(6, 0, 5, 300)).toBe(300)
  })

  it('formats any value, not only the old 60/90/120/150/180 list', () => {
    expect(fmtDuration(45)).toBe('45s')
    expect(fmtDuration(60)).toBe('1:00')
    expect(fmtDuration(105)).toBe('1:45')
    expect(fmtDuration(605)).toBe('10:05')
    expect(fmtDuration(0)).toBe('0s')
    expect(fmtDuration(0, { off: 'Off' })).toBe('Off')
    expect(fmtRest(0)).toBe('Off')
    expect(fmtRest(undefined)).toBe('Off')
    expect(fmtRest(135)).toBe('2:15')
  })

  it('reads out a duration for a screen reader', () => {
    expect(durationText(90)).toBe('1 minute 30 seconds')
    expect(durationText(61)).toBe('1 minute 1 second')
    expect(durationText(120)).toBe('2 minutes')
    expect(durationText(45)).toBe('45 seconds')
    expect(durationText(0)).toBe('0 seconds')
    expect(durationText(0, { off: 'Off' })).toBe('Off')
  })
})
