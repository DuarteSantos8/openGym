// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  yearStats, wrappedYears, workoutsOfYear, seasonYear, homeCardYear, notificationPlan, withYear, wrappedOf,
  comparisonFor, personalityOf, longestStreak, biggestPr, bodyChange, daypartOf, wrappedNow, NOW_KEY, NOTIFY_HOUR,
} from './wrapped.js'
import { LB_KG } from './units.js'

const BENCH = '0025'      // barbell bench press (chest)
const SQUAT = '0043'      // barbell full squat (quads)
const DEAD = '0032'       // barbell deadlift
const ASSISTED = '0017'   // assisted pull-up, leverage machine
const CARDIO = '3531'     // a cardio exercise

const set = (w, r, done = true) => ({ w, r, done })
// A workout on `d` starting at `hh:mm` local, `min` minutes long, with [id, sets] entries.
function W(d, hhmm, min, entries, extra = {}) {
  const start = new Date(d + 'T' + hhmm + ':00').getTime()
  return { id: d + hhmm, d, start, end: start + min * 60000, name: 'Session', entries: entries.map(([id, sets]) => ({ id, target: { mode: 'reps' }, sets })), ...extra }
}
const S = (workouts, over = {}) => ({ unit: 'kg', weekStart: 1, workouts, bodyweight: [], ...over })

const was = process.env.TZ
afterEach(() => {
  if (was === undefined) delete process.env.TZ; else process.env.TZ = was
  try { localStorage.removeItem(NOW_KEY) } catch (e) { /* none */ }
})

describe('the year: local calendar days', () => {
  it('counts a workout in the year of its local day, not the UTC one', () => {
    const late = W('2026-12-31', '23:30', 45, [[BENCH, [set(60, 8)]]])
    const ny = W('2027-01-01', '00:15', 45, [[BENCH, [set(60, 8)]]])
    const st = S([late, ny])
    expect(workoutsOfYear(st, 2026).map(w => w.d)).toEqual(['2026-12-31'])
    expect(workoutsOfYear(st, 2027).map(w => w.d)).toEqual(['2027-01-01'])
    expect(wrappedYears(st)).toEqual([2027, 2026])
  })

  it('reads an old workout without a day by its start on this device’s clock', () => {
    // 03:00 UTC on Jan 1 is still Dec 31 in Los Angeles, already Jan 1 in Lisbon.
    const start = Date.parse('2027-01-01T03:00:00Z')
    const w = { id: 'x', start, end: start + 3600000, entries: [{ id: BENCH, sets: [set(50, 5)] }] }
    process.env.TZ = 'America/Los_Angeles'
    expect(workoutsOfYear(S([w]), 2026)).toHaveLength(1)
    process.env.TZ = 'Europe/Lisbon'
    expect(workoutsOfYear(S([w]), 2026)).toHaveLength(0)
    expect(workoutsOfYear(S([w]), 2027)).toHaveLength(1)
  })

  it('takes the time of day from the start, on this device’s clock', () => {
    process.env.TZ = 'Asia/Tokyo'
    const ws = [1, 2, 3, 4, 5].map(n => W(`2026-03-0${n}`, '06:30', 50, [[BENCH, [set(60, 8)]]]))
    expect(yearStats(S(ws), 2026).daypart).toEqual({ part: 'morning', n: 5 })
  })
})

describe('yearStats', () => {
  it('is null for a year without workouts, and skips broken records', () => {
    expect(yearStats(S([]), 2026)).toBeNull()
    expect(yearStats(S([null, { d: 'garbage' }, W('2025-05-05', '10:00', 30, [[BENCH, [set(40, 5)]]])]), 2026)).toBeNull()
  })

  it('adds up workouts, days, time, volume and work sets; warm-ups and unticked sets do not count', () => {
    const ws = [
      W('2026-02-02', '18:00', 60, [[BENCH, [{ w: 40, r: 8, done: true, phase: 'warmup' }, set(60, 8), set(60, 8), set(60, 8, false)]]]),
      W('2026-02-02', '19:30', 30, [[SQUAT, [set(100, 5)]]]),
      W('2026-02-09', '18:00', 90, [[BENCH, [set(62.5, 6)]]]),
    ]
    const st = yearStats(S(ws), 2026)
    expect(st.workouts).toBe(3)
    expect(st.days).toBe(2)
    expect(st.ms).toBe(180 * 60000)
    expect(st.avgMs).toBe(60 * 60000)
    expect(st.sets).toBe(4)
    expect(st.volume).toBe(60 * 8 * 2 + 100 * 5 + 62.5 * 6)
    expect(st.topExercise).toMatchObject({ id: BENCH, sets: 3 })
    expect(st.topMuscle.id).toBe('chest')
  })

  it('leaves the clock out for imports without one (a partial year of old sessions)', () => {
    const imported = ['2026-01-10', '2026-01-17'].map(d => ({ id: d, d, entries: [{ id: BENCH, sets: [set(50, 10)] }] }))
    const st = yearStats(S(imported), 2026)
    expect(st.workouts).toBe(2)
    expect(st.ms).toBe(0)
    expect(st.timed).toBe(0)
    expect(st.daypart).toBeNull()
    expect(st.volume).toBe(1000)
  })

  it('settles ties the same way every time', () => {
    // Same sets: the one with more volume. Same everything: by id.
    const tie = yearStats(S([W('2026-04-01', '10:00', 40, [[SQUAT, [set(100, 5)]], [BENCH, [set(60, 5)]]])]), 2026)
    expect(tie.topExercise.id).toBe(SQUAT)
    const exact = yearStats(S([W('2026-04-01', '10:00', 40, [[SQUAT, [set(60, 5)]], [BENCH, [set(60, 5)]]])]), 2026)
    expect(exact.topExercise.id).toBe(BENCH)
    // One Sunday, one Monday: the profile's own week decides.
    const days = [W('2026-04-05', '10:00', 40, [[BENCH, [set(60, 5)]]]), W('2026-04-06', '10:00', 40, [[BENCH, [set(60, 5)]]])]
    expect(yearStats(S(days, { weekStart: 1 }), 2026).favDay.day).toBe(1)
    expect(yearStats(S(days, { weekStart: 0 }), 2026).favDay.day).toBe(0)
    // Two months with one workout each: the heavier one; equal: the earlier one.
    const months = [W('2026-03-10', '10:00', 40, [[BENCH, [set(60, 5)]]]), W('2026-07-10', '10:00', 40, [[BENCH, [set(80, 5)]]])]
    expect(yearStats(S(months), 2026).bestMonth.month).toBe(6)
    const even = [W('2026-03-10', '10:00', 40, [[BENCH, [set(60, 5)]]]), W('2026-07-10', '10:00', 40, [[BENCH, [set(60, 5)]]])]
    expect(yearStats(S(even), 2026).bestMonth.month).toBe(2)
    // Morning and evening once each: morning first.
    const parts = [W('2026-03-10', '07:00', 40, [[BENCH, [set(60, 5)]]]), W('2026-03-11', '19:00', 40, [[BENCH, [set(60, 5)]]])]
    expect(yearStats(S(parts), 2026).daypart.part).toBe('morning')
  })

  it('keeps totals in the profile’s unit and the comparison in kg', () => {
    const ws = [W('2026-05-01', '10:00', 60, [[BENCH, [set(200, 10)]]])]
    const kg = yearStats(S(ws), 2026)
    const lb = yearStats(S(ws, { unit: 'lb' }), 2026)
    expect(kg.unit).toBe('kg')
    expect(kg.volumeKg).toBe(2000)
    expect(lb.unit).toBe('lb')
    expect(lb.volume).toBe(2000)
    expect(lb.volumeKg).toBeCloseTo(2000 * LB_KG)
  })

  it('reads the day parts the way the cards name them', () => {
    expect([4, 5, 10, 11, 13, 14, 16, 17, 20, 21, 23].map(daypartOf)).toEqual(['night', 'morning', 'morning', 'midday', 'midday', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night'])
  })
})

describe('longestStreak', () => {
  it('finds the longest run of weeks in a row, inside the year', () => {
    const ws = ['2026-01-05', '2026-01-12', '2026-01-26', '2026-02-02', '2026-02-09', '2026-02-11'].map(d => ({ d }))
    expect(longestStreak(ws, 1)).toEqual({ weeks: 3, from: '2026-01-26', to: '2026-02-09' })
    expect(longestStreak([], 1)).toEqual({ weeks: 0, from: null, to: null })
  })
})

describe('biggestPr', () => {
  it('picks the record that grew most past the best before the year', () => {
    const before = [W('2025-11-01', '10:00', 40, [[BENCH, [set(80, 5)]], [SQUAT, [set(120, 5)]]])]
    const year = [
      W('2026-03-01', '10:00', 40, [[BENCH, [set(90, 5)]]], { prs: [BENCH] }),
      W('2026-04-01', '10:00', 40, [[SQUAT, [set(125, 5)]]], { prs: [SQUAT] }),
    ]
    const pr = biggestPr(S([...before, ...year]), 2026)
    expect(pr).toMatchObject({ id: BENCH, w: 90, gain: 10, prev: 80, d: '2026-03-01' })
    expect(yearStats(S([...before, ...year]), 2026).prs).toBe(2)
  })

  it('takes the heaviest record for a first year, and never an assisted lift', () => {
    const year = [
      W('2026-03-01', '10:00', 40, [[BENCH, [set(70, 5)]], [DEAD, [set(140, 3)]], [ASSISTED, [set(10, 8)]]], { prs: [BENCH, DEAD, ASSISTED, DEAD] }),
    ]
    expect(biggestPr(S(year), 2026)).toMatchObject({ id: DEAD, w: 140, gain: null })
    // Each workout's records are counted once: 3 here.
    expect(yearStats(S(year), 2026).prs).toBe(3)
    expect(biggestPr(S([W('2026-03-01', '10:00', 40, [[ASSISTED, [set(10, 8)]]], { prs: [ASSISTED] })]), 2026)).toBeNull()
  })
})

describe('bodyChange', () => {
  const bw = [{ d: '2025-12-30', w: 90 }, { d: '2026-01-04', w: 82, t: 1 }, { d: '2026-06-01', w: 80 }, { d: '2026-12-20', w: 79.5 }]
  it('is the first and the last weigh-in of the year', () => {
    expect(bodyChange({ bodyweight: bw }, 2026)).toMatchObject({ from: 82, to: 79.5, delta: -2.5, n: 3 })
  })
  it('is nothing with fewer than two weigh-ins, or when switched off', () => {
    expect(bodyChange({ bodyweight: bw.slice(0, 2) }, 2026)).toBeNull()
    expect(bodyChange({ bodyweight: bw, wrappedBody: false }, 2026)).toBeNull()
  })
})

describe('comparisonFor', () => {
  it('picks the biggest thing it comes to at least two of', () => {
    expect(comparisonFor(460000)).toEqual({ key: 'whale', count: 3.1 })
    expect(comparisonFor(1000000)).toEqual({ key: 'iss', count: 2.4 })
    expect(comparisonFor(20000)).toEqual({ key: 'trex', count: 2.5 })
    expect(comparisonFor(1000)).toEqual({ key: 'piano', count: 2.1 })
    expect(comparisonFor(50e6)).toEqual({ key: 'eiffel', count: 6.8 })
  })
  it('rounds to whole things past ten, and falls back to cats', () => {
    expect(comparisonFor(140)).toEqual({ key: 'cat', count: 31 })
    expect(comparisonFor(190)).toEqual({ key: 'cat', count: 42 })
    expect(comparisonFor(250)).toEqual({ key: 'panda', count: 2.5 })
    expect(comparisonFor(80)).toEqual({ key: 'cat', count: 18 })
    expect(comparisonFor(3)).toEqual({ key: 'cat', count: 0.7 })
    expect(comparisonFor(0)).toBeNull()
    expect(comparisonFor(NaN)).toBeNull()
  })
})

describe('personalityOf', () => {
  const base = {
    timed: 10, avgMs: 50 * 60000, workouts: 10, prs: 2, distinctExercises: 8,
    streak: { weeks: 3 }, topMuscle: { id: 'chest' },
    shares: { legs: 0.1, upper: 0.5, cardio: 0, early: 0, late: 0, weekend: 0.2 },
  }
  const p = over => personalityOf({ ...base, ...over, shares: { ...base.shares, ...(over.shares || {}) } })
  it('follows the patterns, first rule first', () => {
    expect(p({ shares: { early: 0.5 } })).toBe('early')
    expect(p({ shares: { late: 0.5 } })).toBe('night')
    expect(p({ shares: { early: 0.5, late: 0.5 } })).toBe('early')
    expect(p({ topMuscle: { id: 'quadriceps' }, shares: { legs: 0.4 } })).toBe('legs')
    expect(p({ topMuscle: { id: 'chest' }, shares: { legs: 0.4 } })).not.toBe('legs')
    expect(p({ streak: { weeks: 12 } })).toBe('streak')
    expect(p({ prs: 20 })).toBe('records')
    expect(p({ shares: { weekend: 0.6 } })).toBe('weekend')
    expect(p({ shares: { cardio: 0.5 } })).toBe('cardio')
    expect(p({ avgMs: 80 * 60000 })).toBe('marathon')
    expect(p({ avgMs: 30 * 60000 })).toBe('quick')
    expect(p({ distinctExercises: 45 })).toBe('explorer')
    expect(p({ shares: { upper: 0.7 } })).toBe('upper')
    expect(p({})).toBe('steady')
  })
  it('needs a few timed sessions before it reads the clock, and is kind to an empty year', () => {
    expect(p({ timed: 2, shares: { early: 1 } })).toBe('steady')
    expect(personalityOf(null)).toBe('steady')
  })
  it('reads a real year', () => {
    const ws = Array.from({ length: 6 }, (_, i) => W(`2026-0${i + 1}-14`, '06:00', 45, [[SQUAT, [set(100, 5), set(100, 5)]]]))
    expect(personalityOf(yearStats(S(ws), 2026))).toBe('early')
  })
})

describe('the season and the Home card', () => {
  const st = S([W('2026-03-10', '10:00', 40, [[BENCH, [set(60, 5)]]])])
  const at = (iso, hh = 12) => { const d = new Date(iso + 'T12:00:00'); d.setHours(hh); return d }
  it('runs from Dec 1 to Jan 31, about the year just gone', () => {
    expect(seasonYear(at('2026-11-30'))).toBeNull()
    expect(seasonYear(at('2026-12-01', 0))).toBe(2026)
    expect(seasonYear(at('2026-12-31', 23))).toBe(2026)
    expect(seasonYear(at('2027-01-31', 23))).toBe(2026)
    expect(seasonYear(at('2027-02-01', 0))).toBeNull()
  })
  it('shows Home’s card in season for a year with workouts, until opened or put away', () => {
    expect(homeCardYear(st, at('2026-11-30'))).toBeNull()
    expect(homeCardYear(st, at('2026-12-01'))).toBe(2026)
    expect(homeCardYear(st, at('2027-01-15'))).toBe(2026)
    expect(homeCardYear({ ...st, wrapped: { opened: [2026] } }, at('2026-12-05'))).toBeNull()
    expect(homeCardYear({ ...st, wrapped: { dismissed: [2026] } }, at('2026-12-05'))).toBeNull()
    // Put away last year: this year's still comes.
    expect(homeCardYear({ ...S([W('2027-03-10', '10:00', 40, [[BENCH, [set(60, 5)]]])]), wrapped: { dismissed: [2026] } }, at('2027-12-02'))).toBe(2027)
    expect(homeCardYear(S([]), at('2026-12-05'))).toBeNull()
  })
  it('remembers at most five years, and reads anything else as nothing', () => {
    let s = {}
    for (const y of [2020, 2021, 2022, 2023, 2024, 2025, 2026]) s = { wrapped: withYear(s, 'opened', y) }
    expect(s.wrapped.opened).toEqual([2022, 2023, 2024, 2025, 2026])
    expect(wrappedOf({ wrapped: { opened: 'x', dismissed: [2026, 'a'], phone: '2026' } })).toEqual({ opened: [], dismissed: [2026], phone: null })
  })
  it('can be told it is another day, for a preview', () => {
    localStorage.setItem(NOW_KEY, '2026-12-01')
    const now = wrappedNow(new Date('2026-10-28T15:04:00'))
    expect(seasonYear(now)).toBe(2026)
    expect(now.getHours()).toBe(15)
    localStorage.setItem(NOW_KEY, 'soon')
    expect(seasonYear(wrappedNow(new Date('2026-10-28T15:04:00')))).toBeNull()
  })
})

describe('the phone’s December notification: once a year', () => {
  const st = S([W('2026-03-10', '10:00', 40, [[BENCH, [set(60, 5)]]])])
  const nov = new Date(2026, 10, 15, 9, 0)
  it('is planned for Dec 1 at 18:00 local when the app opens in November with notifications allowed', () => {
    const plan = notificationPlan(st, nov, { granted: true })
    expect(plan.action).toBe('schedule')
    expect(plan.year).toBe(2026)
    expect(plan.at).toEqual(new Date(2026, 11, 1, NOTIFY_HOUR, 0, 0, 0))
  })
  it('is planned on Dec 1 itself until 18:00, and not after', () => {
    expect(notificationPlan(st, new Date(2026, 11, 1, 17, 59), { granted: true }).action).toBe('schedule')
    expect(notificationPlan(st, new Date(2026, 11, 1, 18, 0), { granted: true }).action).toBe('none')
    expect(notificationPlan(st, new Date(2026, 11, 20), { granted: true }).action).toBe('none')
  })
  it('never asks for permission: without it there is only the Home card', () => {
    expect(notificationPlan(st, nov, { granted: false }).action).toBe('none')
  })
  it('waits for November, and for a year with a workout in it', () => {
    expect(notificationPlan(st, new Date(2026, 8, 1), { granted: true }).action).toBe('none')
    expect(notificationPlan(S([]), nov, { granted: true }).action).toBe('none')
  })
  it('is taken back when switched off', () => {
    expect(notificationPlan({ ...st, wrappedNotify: false }, nov, { granted: true }).action).toBe('cancel')
  })
})
