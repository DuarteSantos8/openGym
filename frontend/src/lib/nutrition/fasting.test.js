import { describe, expect, it } from 'vitest'
import { fastingStats, hitGoal, lastFinished, lengthOf, progressOf, recentDays, validGoal } from './fasting.js'

const H = 3600 * 1000
// A local noon, so day boundaries are nowhere near and the tests hold in any time zone.
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime()
const at = (daysAgo, hour) => new Date(2026, 9, 14 - daysAgo, hour, 0, 0).getTime()
const iso = ms => new Date(ms).toISOString()
const done = (id, startMs, endMs, goal = 16) => ({ id, start_at: iso(startMs), end_at: iso(endMs), goal_hours: goal })
// A fast of `hours` that ended at 10:00 `daysAgo` days ago.
const ending = (id, daysAgo, hours, goal = 16) => done(id, at(daysAgo, 10) - hours * H, at(daysAgo, 10), goal)

describe('progressOf', () => {
  it('reads time fasted, time left and where the goal falls', () => {
    const fast = { id: 1, start_at: iso(NOW - 4 * H), end_at: null, goal_hours: 16 }
    const p = progressOf(fast, NOW)
    expect(p.elapsedMs).toBe(4 * H)
    expect(p.remainingMs).toBe(12 * H)
    expect(p.pct).toBe(25)
    expect(p.reached).toBe(false)
    expect(p.targetAt).toBe(NOW + 12 * H)
  })

  it('has reached the goal from the goal on, and stops the bar at full', () => {
    const p = progressOf({ id: 1, start_at: iso(NOW - 20 * H), end_at: null, goal_hours: 16 }, NOW)
    expect(p.reached).toBe(true)
    expect(p.remainingMs).toBe(0)
    expect(p.pct).toBe(100)
    expect(p.elapsedMs).toBe(20 * H)
  })

  it('never goes negative when the clock is behind the start', () => {
    const p = progressOf({ id: 1, start_at: iso(NOW + H), end_at: null, goal_hours: 16 }, NOW)
    expect(p.elapsedMs).toBe(0)
  })
})

describe('validGoal', () => {
  it('takes 1 to 168 hours', () => {
    expect([0, 0.5, 1, 16, 168, 169, NaN].map(validGoal)).toEqual([false, false, true, true, true, false, false])
  })
})

describe('lengths and goals', () => {
  it('measures a finished fast and whether it reached its goal', () => {
    const f = done(1, NOW - 17 * H, NOW)
    expect(lengthOf(f)).toBe(17 * H)
    expect(hitGoal(f)).toBe(true)
    expect(hitGoal(done(2, NOW - 15 * H, NOW))).toBe(false)
  })

  it('finds the last fast by when it ended', () => {
    const a = done(1, at(3, 20), at(2, 12))
    const b = done(2, at(1, 20), at(0, 12))
    expect(lastFinished([b, a]).id).toBe(2)
    expect(lastFinished([])).toBeNull()
  })
})

describe('fastingStats', () => {
  it('averages and finds the longest', () => {
    const s = fastingStats([ending(1, 1, 14), ending(2, 0, 18)], null, NOW)
    expect(s.count).toBe(2)
    expect(s.avgHours).toBe(16)
    expect(s.longestHours).toBe(18)
  })

  it('counts a streak of days that ended with the goal reached, and breaks it on a miss', () => {
    const history = [
      ending(1, 0, 18), // today
      ending(2, 1, 17), // yesterday
      ending(3, 2, 10), // two days ago: missed
      ending(4, 3, 17),
      ending(5, 4, 17),
      ending(6, 5, 17),
    ]
    const s = fastingStats(history, null, NOW)
    expect(s.currentStreak).toBe(2)
    expect(s.longestStreak).toBe(3)
  })

  it('counts a running fast that has reached its goal toward today', () => {
    const active = { id: 9, start_at: iso(NOW - 17 * H), end_at: null, goal_hours: 16 }
    expect(fastingStats([], active, NOW).currentStreak).toBe(1)
    expect(fastingStats([], { ...active, start_at: iso(NOW - 5 * H) }, NOW).currentStreak).toBe(0)
  })

  it('is all zeros with nothing to count', () => {
    expect(fastingStats([], null, NOW)).toEqual({ count: 0, avgHours: 0, longestHours: 0, currentStreak: 0, longestStreak: 0 })
  })
})

describe('recentDays', () => {
  it('lays out the last days oldest first, with the longest fast ending on each', () => {
    const days = recentDays([ending(1, 1, 17), ending(2, 1, 5)], null, NOW, 3)
    expect(days.map(d => Math.round(d.hours))).toEqual([0, 17, 0])
  })

  it('shows a running fast on today with what it has so far', () => {
    const days = recentDays([], { id: 9, start_at: iso(NOW - 6 * H), end_at: null, goal_hours: 16 }, NOW, 2)
    expect(days.at(-1).hours).toBe(6)
  })
})
