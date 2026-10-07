import { describe, expect, it } from 'vitest'
import { REST_MAX, REST_PAUSE_MIN, REST_PAUSE_MAX, clampDuration, splitDuration, joinDuration, fmtDuration, durationText, fmtRest } from './duration.js'

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
