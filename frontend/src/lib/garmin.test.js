import { describe, it, expect, vi } from 'vitest'
vi.mock('./api.js', () => ({ api: vi.fn() }))
import { readiness, meanBefore, fmtDuration, fmtPace, activityLine, activityType, keyDaysLeft } from './garmin.js'

const week = (restHr, today) => ({
  days: [...['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map(date => ({ date, restHr })),
    { date: '2026-11-10', ...today }],
})

describe('garmin readiness', () => {
  it('two bad signs make an easy day', () => {
    const r = readiness(week(50, { restHr: 57, sleepScore: 52, bbMax: 70 }), '2026-11-10')
    expect(r.level).toBe('easy')
    expect(r.bad).toEqual(['Sleep score 52', 'Resting heart rate 57, usually 50'])
  })
  it('good signs and no bad ones make a day to push', () => {
    expect(readiness(week(50, { sleepScore: 85, bbMax: 90, hrvStatus: 'BALANCED' }), '2026-11-10').level).toBe('push')
  })
  it('one bad sign is a normal day, no data is no answer', () => {
    expect(readiness(week(50, { sleepScore: 85, hrvStatus: 'UNBALANCED' }), '2026-11-10').level).toBe('normal')
    expect(readiness(week(50, {}), '2026-11-10')).toBe(null)
    expect(readiness(null, '2026-11-10')).toBe(null)
  })
  it('falls back to sleep time without a score', () => {
    expect(readiness({ days: [{ date: '2026-11-10', sleepSec: 5 * 3600, bbMax: 30 }] }, '2026-11-10').level).toBe('easy')
  })
  it('averages only the days before', () => {
    expect(meanBefore(week(50, { restHr: 70 }), 'restHr', '2026-11-10')).toBe(50)
  })
})

describe('garmin formatting', () => {
  it('durations, paces and lines', () => {
    expect(fmtDuration(27000)).toBe('7 h 30 min')
    expect(fmtDuration(300)).toBe('5 min')
    expect(fmtPace(1000 / 312)).toBe('5:12 /km')
    expect(fmtPace(0)).toBe('')
    expect(activityLine({ type: 'running', dur: 1560, dist: 5000, speed: 5000 / 1560, hr: 151.4 })).toBe('26 min · 5.00 km · 5:12 /km · 151 bpm')
    expect(activityLine({ type: 'strength_training', dur: 3600, sets: 18 })).toBe('1 h 00 min · 18 sets')
    expect(activityType('trail_running')).toBe('Trail running')
    expect(keyDaysLeft({ keyExp: 10 * 86400e3 }, 0)).toBe(10)
    expect(keyDaysLeft({}, 0)).toBe(null)
  })
})
