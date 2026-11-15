import { describe, it, expect, vi } from 'vitest'
import { MONDAY, SUNDAY, SATURDAY, weekStartOf, weekOrder, weekDayOffset, startOfWeek, weekKey, isoOf } from './format.js'
import { streakWeeks } from './history.js'
import { muscleBalanceWindow } from './muscles.js'
import { effortWeeks } from './effort.js'

// 2026-08-19 is a Wednesday. Its Monday-first week runs Mon 17th → Sun 23rd; its Sunday-first
// week runs Sun 16th → Sat 22nd. Every case below is picked so the two disagree — a date that
// lands in the same week either way would pass without testing anything.
const WED = '2026-08-19'

describe('weekStartOf', () => {
  it('defaults to Monday for state written before the setting existed', () => {
    expect(weekStartOf({})).toBe(MONDAY)
    expect(weekStartOf(undefined)).toBe(MONDAY)
    expect(weekStartOf({ weekStart: undefined })).toBe(MONDAY)
  })

  it('0 is Sunday and 6 is Saturday; a junk value is not another week shape', () => {
    expect(weekStartOf({ weekStart: SUNDAY })).toBe(SUNDAY)
    expect(weekStartOf({ weekStart: SATURDAY })).toBe(SATURDAY)
    expect(weekStartOf({ weekStart: 3 })).toBe(MONDAY)
    expect(weekStartOf({ weekStart: '6' })).toBe(MONDAY)
    expect(weekStartOf({ weekStart: null })).toBe(MONDAY)
  })
})

describe('weekOrder', () => {
  it('lists all seven getDay() indices from the chosen start', () => {
    expect(weekOrder(MONDAY)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(weekOrder(SUNDAY)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(weekOrder(SATURDAY)).toEqual([6, 0, 1, 2, 3, 4, 5])
  })
})

describe('weekDayOffset', () => {
  it('is the column a weekday sits in', () => {
    expect(weekDayOffset(1, MONDAY)).toBe(0)    // Monday, Monday-first
    expect(weekDayOffset(0, MONDAY)).toBe(6)    // Sunday closes a Monday-first week
    expect(weekDayOffset(0, SUNDAY)).toBe(0)
    expect(weekDayOffset(1, SUNDAY)).toBe(1)
    expect(weekDayOffset(6, SATURDAY)).toBe(0)
    expect(weekDayOffset(5, SATURDAY)).toBe(6)  // Friday closes a Saturday-first week
  })
})

describe('startOfWeek', () => {
  it('walks back to the chosen first day', () => {
    expect(isoOf(startOfWeek(WED, MONDAY))).toBe('2026-08-17')
    expect(isoOf(startOfWeek(WED, SUNDAY))).toBe('2026-08-16')
    expect(isoOf(startOfWeek(WED, SATURDAY))).toBe('2026-08-15')
  })

  it('leaves a date that already is the first day alone', () => {
    expect(isoOf(startOfWeek('2026-08-17', MONDAY))).toBe('2026-08-17')
    expect(isoOf(startOfWeek('2026-08-16', SUNDAY))).toBe('2026-08-16')
    expect(isoOf(startOfWeek('2026-08-22', SATURDAY))).toBe('2026-08-22')
  })

  it('is noon local, so a DST jump cannot move it to the day before', () => {
    // Europe/Zurich springs forward on 2026-03-29, a Sunday.
    expect(isoOf(startOfWeek('2026-03-29', SUNDAY))).toBe('2026-03-29')
    expect(isoOf(startOfWeek('2026-03-29', MONDAY))).toBe('2026-03-23')
  })
})

describe('weekKey', () => {
  it('is equal for two days in the same week and different across the boundary', () => {
    // Sunday the 16th and Wednesday the 19th: one week Sunday-first, two Monday-first.
    expect(weekKey('2026-08-16', SUNDAY)).toBe(weekKey(WED, SUNDAY))
    expect(weekKey('2026-08-16', MONDAY)).not.toBe(weekKey(WED, MONDAY))
    // Saturday the 22nd starts a new Saturday-first week; Friday the 21st still closes this one.
    expect(weekKey('2026-08-21', SATURDAY)).toBe(weekKey(WED, SATURDAY))
    expect(weekKey('2026-08-22', SATURDAY)).not.toBe(weekKey(WED, SATURDAY))
  })

  it('defaults to Monday when no start is passed', () => {
    expect(weekKey(WED)).toBe(weekKey(WED, MONDAY))
  })

  it('does not collide across years', () => {
    expect(weekKey('2025-08-19', MONDAY)).not.toBe(weekKey('2026-08-19', MONDAY))
  })

  // Home and Stats ask for every workout's week on each render; a date seen once is not parsed again.
  it('remembers a date it has already keyed, and still answers like startOfWeek', () => {
    const spy = vi.spyOn(Date.prototype, 'getDay')
    try {
      const first = weekKey('2031-02-12', SUNDAY)
      const parsed = spy.mock.calls.length
      expect(parsed).toBeGreaterThan(0)
      expect(weekKey('2031-02-12', SUNDAY)).toBe(first)
      expect(spy.mock.calls.length).toBe(parsed)
    } finally { spy.mockRestore() }
    for (let i = 0; i < 800; i += 1) {
      const iso = isoOf(new Date(2024, 0, 1 + i, 12))
      for (const ws of [MONDAY, SUNDAY, SATURDAY]) {
        expect(weekKey(iso, ws)).toBe(isoOf(startOfWeek(iso, ws)))
        expect(weekKey(iso, ws)).toBe(isoOf(startOfWeek(iso, ws)))
      }
    }
  })
})

describe('the week streak counts the profile’s own weeks', () => {
  // Two sessions on the Sunday and the Monday that straddle a Monday-first boundary. To a
  // Monday profile that is a session in each of two consecutive weeks; to a Sunday profile
  // both fall in the same week and there is only one.
  const iso = d => isoOf(new Date(Date.now() - d * 86400000))
  const sundayBack = () => {
    // The most recent Sunday that is not today, so both dates are in the past.
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 7) % 7 || 7))
    return d
  }

  it('splits a Sun/Mon pair into two weeks for a Monday profile, one for a Sunday profile', () => {
    const sun = sundayBack()
    const mon = new Date(sun); mon.setDate(sun.getDate() + 1)
    const workouts = [{ d: isoOf(sun) }, { d: isoOf(mon) }]
    expect(weekKey(isoOf(sun), MONDAY)).not.toBe(weekKey(isoOf(mon), MONDAY))
    expect(weekKey(isoOf(sun), SUNDAY)).toBe(weekKey(isoOf(mon), SUNDAY))
    expect(streakWeeks({ workouts, weekStart: SUNDAY })).toBe(1)
  })

  it('splits a Fri/Sat pair into two weeks for a Saturday profile, one for a Monday profile', () => {
    const sat = sundayBack()
    sat.setDate(sat.getDate() - 1)
    const fri = new Date(sat); fri.setDate(sat.getDate() - 1)
    const workouts = [{ d: isoOf(fri) }, { d: isoOf(sat) }]
    expect(streakWeeks({ workouts, weekStart: SATURDAY })).toBe(2)
    expect(streakWeeks({ workouts, weekStart: MONDAY })).toBe(1)
  })

  it('is zero without workouts whatever the week start', () => {
    expect(streakWeeks({ workouts: [], weekStart: SUNDAY })).toBe(0)
    expect(iso(0)).toBe(isoOf(new Date()))
  })
})

describe('“this week” ranges follow the setting', () => {
  const workouts = [{ d: '2026-08-16' }, { d: WED }]   // Sunday, then Wednesday

  it('muscle balance: the 7-day window is a week, not the last seven days', () => {
    const mon = muscleBalanceWindow(workouts, 7, Date.now(), WED, MONDAY)
    expect(mon.map(w => w.d)).toEqual([WED])
    const sun = muscleBalanceWindow(workouts, 7, Date.now(), WED, SUNDAY)
    expect(sun.map(w => w.d)).toEqual(['2026-08-16', WED])
  })

  it('muscle balance defaults to Monday when no start is passed', () => {
    expect(muscleBalanceWindow(workouts, 7, Date.now(), WED).map(w => w.d)).toEqual([WED])
  })

  it('the effort chart groups and positions its points by the same week', () => {
    // Four rated sets: two on the Sunday, two on the Wednesday. Monday-first that is two
    // points (one per week, each with its two rated sets); Sunday-first it is one point.
    const set = r => ({ done: true, w: 60, r: 8, rir: r })
    const workout = d => ({ d, start: new Date(d + 'T10:00:00').getTime(), entries: [{ id: '0025', sets: [set(2), set(3)] }] })
    const S = { effort: 'rir', workouts: [workout('2026-08-16'), workout(WED)] }

    const mon = effortWeeks({ ...S, weekStart: MONDAY }, 0)
    expect(mon).toHaveLength(2)
    expect(mon.map(p => isoOf(new Date(p.t)))).toEqual(['2026-08-10', '2026-08-17'])

    const sun = effortWeeks({ ...S, weekStart: SUNDAY }, 0)
    expect(sun).toHaveLength(1)
    expect(isoOf(new Date(sun[0].t))).toBe('2026-08-16')
    expect(sun[0].sets).toBe(4)
  })
})
