import { afterEach, describe, expect, it } from 'vitest'
import { streakInfo, streakWeeks, streakCelebration, STREAK_BADGES, FREEZE_MAX } from './streak.js'
import { isoOf } from './format.js'

// 2026-10-28 is a Wednesday. Its Monday week starts 2026-10-26, its Sunday week 2026-10-25.
const TODAY = '2026-10-28'
const day = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
// One workout on the Wednesday `weeksAgo` weeks back, for each of them.
const weeks = (...weeksAgo) => weeksAgo.map(n => ({ id: 'w' + n, d: day(TODAY, -7 * n) }))
const S = (workouts, over = {}) => ({ workouts, weekStart: 1, ...over })

describe('streakInfo: the run', () => {
  it('is all zero without workouts', () => {
    expect(streakInfo(S([]), TODAY)).toMatchObject({ current: 0, best: 0, freezes: 0, thisWeekDone: false, badges: [], next: 4 })
  })

  it('counts this week once trained, and leaves an open week alone', () => {
    expect(streakInfo(S(weeks(0, 1, 2)), TODAY)).toMatchObject({ current: 3, thisWeekDone: true })
    // nothing yet this week: still three from the weeks before, not broken
    expect(streakInfo(S(weeks(1, 2, 3)), TODAY)).toMatchObject({ current: 3, thisWeekDone: false })
  })

  it('breaks on a missed week without a freeze, and remembers the best run', () => {
    // 3 weeks, a gap, then 2 weeks: no freeze was earned (needs 4)
    const info = streakInfo(S(weeks(0, 1, 3, 4, 5)), TODAY)
    expect(info).toMatchObject({ current: 2, best: 3, freezes: 0, frozen: [] })
  })

  it('ignores workouts in the future and ones without a usable date', () => {
    const ws = [...weeks(0, 1), { d: day(TODAY, 30) }, { d: 'garbage' }, { d: null }, null]
    expect(streakInfo(S(ws), TODAY).current).toBe(2)
  })

  it('streakWeeks is the current run', () => {
    expect(streakWeeks(S(weeks(0, 1, 2, 3, 4)), TODAY)).toBe(5)
  })
})

describe('streakInfo: freezes', () => {
  it('earns one freeze per 4 trained weeks, at most 2 banked', () => {
    expect(streakInfo(S(weeks(0, 1, 2)), TODAY).freezes).toBe(0)
    expect(streakInfo(S(weeks(0, 1, 2, 3)), TODAY)).toMatchObject({ freezes: 1, toNextFreeze: 4 })
    expect(streakInfo(S(weeks(0, 1, 2, 3, 4, 5)), TODAY)).toMatchObject({ freezes: 1, toNextFreeze: 2 })
    const twelve = weeks(...Array.from({ length: 12 }, (_, i) => i))
    expect(streakInfo(S(twelve), TODAY)).toMatchObject({ freezes: FREEZE_MAX, toNextFreeze: 0 })
  })

  it('uses a freeze for a missed week: the streak carries on, the week shows frozen', () => {
    // weeks 6..3 trained (a freeze), week 2 missed, weeks 1 and 0 trained
    const info = streakInfo(S(weeks(0, 1, 3, 4, 5, 6)), TODAY)
    expect(info.current).toBe(6)
    expect(info.freezes).toBe(0)
    expect(info.frozen).toEqual([day('2026-10-26', -14)])
  })

  it('covers two missed weeks with two freezes, and breaks on the third', () => {
    const eight = Array.from({ length: 8 }, (_, i) => i + 3)   // weeks 10..3
    expect(streakInfo(S(weeks(0, ...eight)), TODAY)).toMatchObject({ current: 9, freezes: 0 })
    const far = Array.from({ length: 8 }, (_, i) => i + 4)     // weeks 11..4, then 3 missed
    expect(streakInfo(S(weeks(0, ...far)), TODAY)).toMatchObject({ current: 1, best: 8, freezes: 0, frozen: [] })
  })

  it('does not spend a freeze on the week that is still open', () => {
    const info = streakInfo(S(weeks(1, 2, 3, 4)), TODAY)
    expect(info).toMatchObject({ current: 4, freezes: 1, frozen: [], thisWeekDone: false })
  })
})

describe('streakInfo: badges', () => {
  it('reaches 4, 12, 26, 52 and 104 by the best run', () => {
    expect(STREAK_BADGES).toEqual([4, 12, 26, 52, 104])
    const run = n => weeks(...Array.from({ length: n }, (_, i) => i))
    expect(streakInfo(S(run(3)), TODAY)).toMatchObject({ badges: [], next: 4 })
    expect(streakInfo(S(run(12)), TODAY)).toMatchObject({ badges: [4, 12], next: 26 })
    expect(streakInfo(S(run(104)), TODAY)).toMatchObject({ badges: [4, 12, 26, 52, 104], next: null })
  })

  it('keeps a badge after the run broke', () => {
    const old = Array.from({ length: 5 }, (_, i) => i + 10)  // weeks 14..10, long gap since
    expect(streakInfo(S(weeks(0, ...old)), TODAY)).toMatchObject({ current: 1, best: 5, badges: [4] })
  })
})

describe('streakInfo: week boundaries', () => {
  // A Sunday and the Monday after it: two weeks to a Monday profile, one to a Sunday profile.
  const sun = '2026-10-25', mon = '2026-10-26'
  it('splits a Sunday and a Monday for a Monday-first profile', () => {
    expect(streakInfo(S([{ d: sun }, { d: mon }]), TODAY)).toMatchObject({ current: 2, weekKey: '2026-10-26' })
  })
  it('keeps them in one week for a Sunday-first profile', () => {
    expect(streakInfo(S([{ d: sun }, { d: mon }], { weekStart: 0 }), TODAY)).toMatchObject({ current: 1, weekKey: '2026-10-25' })
  })
  it('a Saturday workout is last week for Sunday-first and this week for Monday-first', () => {
    const sat = '2026-10-31'
    expect(streakInfo(S([{ d: day(sat, -7) }]), sat)).toMatchObject({ current: 1, thisWeekDone: false })
    expect(streakInfo(S([{ d: '2026-10-24' }], { weekStart: 0 }), '2026-10-25')).toMatchObject({ current: 1, thisWeekDone: false })
    expect(streakInfo(S([{ d: '2026-10-24' }]), '2026-10-25')).toMatchObject({ current: 1, thisWeekDone: true })
  })
})

describe('streakInfo: time zones', () => {
  const tz = process.env.TZ
  afterEach(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })
  // Across the European (25 Oct) and US (1 Nov) DST changes: the same calendar dates, the same weeks.
  const ws = weeks(0, 1, 2, 4, 5, 6, 7)
  for (const zone of ['UTC', 'Europe/Zurich', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata']) {
    it(`gives the same streak in ${zone}`, () => {
      process.env.TZ = zone
      expect(streakInfo(S(ws), TODAY)).toMatchObject({ current: 7, freezes: 0, frozen: ['2026-10-05'] })
      expect(streakInfo(S(ws, { weekStart: 0 }), '2026-11-08')).toMatchObject({ current: 0 })
    })
  }
})

describe('streakCelebration', () => {
  const info = (n, thisWeek = true) => streakInfo(S(weeks(...Array.from({ length: n }, (_, i) => i + (thisWeek ? 0 : 1)))), TODAY)
  it('welcomes a profile that never saw one with its top badge so far, once', () => {
    const c = streakCelebration(S([]), info(13), { done: 1, planned: 1 })
    expect(c).toEqual({ kind: 'badge', weeks: 12, seen: { badge: 12, wk: '2026-10-26' } })
    expect(streakCelebration({ streakSeen: c.seen }, info(13), { done: 1, planned: 1 })).toBeNull()
    expect(streakCelebration({}, streakInfo(S([]), TODAY), {})).toBeNull()
  })
  it('celebrates a new badge once, and marks the week seen with it', () => {
    const c = streakCelebration({ streakSeen: { badge: 4, wk: null } }, info(12), { done: 3, planned: 3 })
    expect(c).toEqual({ kind: 'badge', weeks: 12, seen: { badge: 12, wk: '2026-10-26' } })
    expect(streakCelebration({ streakSeen: c.seen }, info(12), { done: 3, planned: 3 })).toBeNull()
  })
  it('celebrates the week once its plan is all trained', () => {
    const i = info(2)
    expect(streakCelebration({ streakSeen: { badge: 0 } }, i, { done: 1, planned: 3 })).toBeNull()
    expect(streakCelebration({ streakSeen: { badge: 0 } }, i, { done: 3, planned: 3 })).toMatchObject({ kind: 'week', weeks: 2 })
    // without a plan, the first workout of the week is the week done
    expect(streakCelebration({ streakSeen: { badge: 0 } }, i, { done: 1, planned: 0 })).toMatchObject({ kind: 'week' })
    expect(streakCelebration({ streakSeen: { badge: 0, wk: '2026-10-26' } }, i, { done: 3, planned: 3 })).toBeNull()
  })
  it('says nothing for a week not trained yet', () => {
    expect(streakCelebration({ streakSeen: { badge: 0 } }, info(3, false), { done: 0, planned: 3 })).toBeNull()
  })
})
