import { describe, expect, it } from 'vitest'
import {
  kindOfName, kindOfEntry, kindOfSport, cardioWeekTotals, goalValue, cardioGoalsOf, withCardioGoals, readGoal,
  shownUnit, toShown, fromShown, suggestedShown, unitsOf,
} from './cardio-goals.js'
import { cardioWeeks, cardioGoalOf } from './lifetime.js'
import { stampChange, mergeStates } from './sync-merge.js'

const done = (o) => ({ ...o, done: true })

describe('which activity an exercise is', () => {
  it('reads the catalogue names', () => {
    const cases = {
      'run on treadmill': 'run', 'walking on treadmill': 'walk', 'sprint': 'run', 'briskly walking': 'walk',
      'stationary bike walk': 'ride', 'assault bike run': 'ride', 'aquabike': 'ride', 'riding outdoor bicycle': 'ride',
      'elliptical machine walk': 'elliptical', 'walk wave machine': 'elliptical', 'cycle cross trainer': 'elliptical',
      'walking on stepmill': 'stairs', 'lever stepper': 'stairs', 'rowing (with rowing machine)': 'row',
      'swimming crawl style': 'swim', 'jump rope': 'rope', 'ski ergometer': 'ski',
    }
    for (const [name, kind] of Object.entries(cases)) expect([name, kindOfName(name)]).toEqual([name, kind])
  })
  it('leaves drills on the spot and other cardio without a kind', () => {
    for (const name of ['high knee run', 'place jog', 'marching on spot', 'burpee', 'battling ropes', 'ski step', 'butt kicks']) {
      expect([name, kindOfName(name)]).toEqual([name, null])
    }
  })
  it('falls back to the machine and reads names in other languages', () => {
    expect(kindOfName('mein Gerät', 'stationary bike')).toBe('ride')
    expect(kindOfName('Schwimmen 50 m Bahn')).toBe('swim')
    expect(kindOfName('Laufband')).toBe('run')
    expect(kindOfName('Rudergerät')).toBe('row')
    expect(kindOfName('Natation')).toBe('swim')
  })
  it('finds your own exercise by its id in the profile', () => {
    const S = { customEx: [{ id: 'c1', n: 'Pool laps', bp: 'cardio' }, { id: 'c2', n: 'Morning swim', bp: 'cardio' }] }
    expect(kindOfEntry({ id: 'c2' }, S)).toBe('swim')
    expect(kindOfEntry({ id: 'c1' }, S)).toBe(null)
    expect(kindOfEntry({ id: '2259' }, S)).toBe('walk')
  })
  it('maps sport to a kind, and leaves yoga out', () => {
    expect(kindOfSport('swim')).toBe('swim')
    expect(kindOfSport('football')).toBe('any')
    expect(kindOfSport('yoga')).toBe(null)
  })
})

// The week of 2026-11-02 (Monday) and the one before.
const S0 = () => ({
  weekStart: 1,
  customEx: [{ id: 'sw', n: 'Pool swim', bp: 'cardio' }],
  workouts: [
    // Treadmill run by speed (10 km/h × 30 min = 5 km) and by distance, plus a bench set.
    { d: '2026-11-03', entries: [{ id: '2197', sets: [done({ min: 30, speed: 10 }), { min: 20, speed: 10, done: false }] }, { id: '0025', sets: [done({ w: 60, r: 5 })] }] },
    { d: '2026-11-05', entries: [{ id: '0685', sets: [done({ min: 25, km: 4 })] }, { id: '2141', sets: [done({ min: 15, speed: 8 })] }] },
    { d: '2026-11-08', entries: [{ id: 'sw', sets: [done({ min: 40, km: 1.5 })] }] },
    { d: '2026-10-28', entries: [{ id: '0685', sets: [done({ min: 40, km: 8 })] }] },
  ],
  activities: {
    a1: { d: '2026-11-07', sport: 'ride', min: 90, km: 40, src: 'hc', _ts: 1 },
    a2: { d: '2026-11-06', sport: 'yoga', min: 60, src: 'manual', _ts: 1 },
    a3: { d: '2026-11-04', sport: 'football', min: 60, src: 'manual', _ts: 1 },
    gone: { _ts: 2 },
  },
})

describe('the sums per week', () => {
  it('adds minutes, distance and sessions per activity', () => {
    const weeks = cardioWeekTotals(S0(), { today: '2026-11-06' })
    expect(weeks).toHaveLength(8)
    const now = weeks.at(-1)
    expect(now.week).toBe('2026-11-02')
    expect(now.by.run).toEqual({ min: 55, km: 9, n: 2 })
    expect(now.by.elliptical.min).toBe(15)
    expect(now.by.ride).toEqual({ min: 90, km: 40, n: 1 })
    expect(now.by.swim).toEqual({ min: 40, km: 1.5, n: 1 })
    // Everything cardio: two runs, the elliptical, the swim, the ride, football; yoga not.
    expect(now.by.any.min).toBe(55 + 15 + 40 + 90 + 60)
    expect(now.by.any.n).toBe(5)
    expect(weeks.at(-2).by.run).toEqual({ min: 40, km: 8, n: 1 })
    expect(goalValue(now, { kind: 'run', unit: 'km' })).toBe(9)
    expect(goalValue(now, { kind: 'row', unit: 'min' })).toBe(0)
  })
  it('follows the first day of the week', () => {
    // Sunday weeks: the swim on Sunday 11-08 starts a new week.
    const sun = cardioWeekTotals({ ...S0(), weekStart: 0 }, { today: '2026-11-08' })
    expect(sun.at(-1).week).toBe('2026-11-08')
    expect(sun.at(-1).by.swim.km).toBe(1.5)
    expect(sun.at(-1).by.run).toBeUndefined()
    const mon = cardioWeekTotals(S0(), { today: '2026-11-08' })
    expect(mon.at(-1).by.run.n).toBe(2)
  })
  it('cardioWeeks keeps its shape, with sport counted', () => {
    const w = cardioWeeks(S0(), { today: '2026-11-06' })
    expect(w.at(-1)).toEqual({ week: '2026-11-02', min: 260 })
  })
})

describe('the goals, and the number from before 1.4.5', () => {
  it('turns an old S.cardioGoal into the first goal', () => {
    expect(cardioGoalsOf({ cardioGoal: 150 })).toEqual([{ kind: 'any', unit: 'min', v: 150 }])
    expect(cardioGoalsOf({ cardioGoal: 220 })).toEqual([{ kind: 'any', unit: 'min', v: 220 }])
    expect(cardioGoalsOf({})).toEqual([])
    expect(cardioGoalsOf({ cardioGoal: 1e9 })).toEqual([])
  })
  it('keeps the list order and takes the minutes from S.cardioGoal', () => {
    const S = { cardioGoal: 300, cardioGoals: [{ kind: 'run', unit: 'km', v: 20 }, { kind: 'any', unit: 'min', v: 150 }] }
    expect(cardioGoalsOf(S)).toEqual([{ kind: 'run', unit: 'km', v: 20 }, { kind: 'any', unit: 'min', v: 300 }])
    // An older app set it to None.
    expect(cardioGoalsOf({ ...S, cardioGoal: 0 })).toEqual([{ kind: 'run', unit: 'km', v: 20 }])
  })
  it('drops broken and doubled goals', () => {
    const S = { cardioGoals: [{ kind: 'run', unit: 'km', v: 5 }, { kind: 'run', unit: 'km', v: 9 }, { kind: 'any', unit: 'km', v: 3 }, { kind: 'nope', unit: 'min', v: 3 }, { kind: 'swim', unit: 'n', v: -1 }, null, 'x'] }
    expect(cardioGoalsOf(S)).toEqual([{ kind: 'run', unit: 'km', v: 5 }])
    expect(readGoal({ kind: 'stairs', unit: 'km', v: 1 })).toBe(null)
    expect(unitsOf('swim')).toEqual(['min', 'km', 'n'])
  })
  it('writes the list and mirrors the minutes into S.cardioGoal', () => {
    const S = { cardioGoal: 150 }
    withCardioGoals(S, [{ kind: 'swim', unit: 'km', v: 2 }, { kind: 'any', unit: 'min', v: 200 }])
    expect(S.cardioGoals).toEqual([{ kind: 'swim', unit: 'km', v: 2 }, { kind: 'any', unit: 'min', v: 200 }])
    expect(cardioGoalOf(S)).toBe(200)
    withCardioGoals(S, [{ kind: 'swim', unit: 'km', v: 2 }])
    expect(S.cardioGoal).toBe(0)
    expect(cardioGoalsOf(S)).toEqual([{ kind: 'swim', unit: 'km', v: 2 }])
    withCardioGoals(S, [])
    expect(cardioGoalsOf(S)).toEqual([])
  })
})

describe('units on screen', () => {
  it('shows km or mi, and m or yd for a swim, from the profile', () => {
    expect(shownUnit({ kind: 'run', unit: 'km' }, { unit: 'kg' })).toBe('km')
    expect(shownUnit({ kind: 'run', unit: 'km' }, { unit: 'lb' })).toBe('mi')
    expect(shownUnit({ kind: 'run', unit: 'km' }, { unit: 'lb', speedUnit: 'kmh' })).toBe('km')
    expect(shownUnit({ kind: 'swim', unit: 'km' }, { unit: 'kg' })).toBe('m')
    expect(shownUnit({ kind: 'swim', unit: 'km' }, { speedUnit: 'mph' })).toBe('yd')
    expect(shownUnit({ kind: 'swim', unit: 'n' }, {})).toBe('n')
  })
  it('converts both ways without drifting', () => {
    for (const [v, u] of [[6, 'mi'], [10, 'km'], [1500, 'm'], [1000, 'yd'], [26.2, 'mi']]) expect(toShown(fromShown(v, u), u)).toBe(v)
    expect(fromShown(1000, 'm')).toBe(1)
    expect(suggestedShown('any', 'min')).toBe(150)
    expect(suggestedShown('swim', 'm')).toBe(1000)
    expect(suggestedShown('run', 'mi')).toBe(6)
  })
})

describe('two devices', () => {
  const clone = o => JSON.parse(JSON.stringify(o))
  const edit = (S, fn, wall) => { const next = clone(S); fn(next); next._ts = stampChange(S, next, wall); return next }
  const base = { _ts: 1000, unit: 'kg', cardioGoal: 150, workouts: [], routines: [] }
  it('an older app changing the minutes keeps the goals the new one added', () => {
    const phone = edit(base, s => { withCardioGoals(s, [...cardioGoalsOf(s), { kind: 'swim', unit: 'km', v: 2 }]) }, 3000)
    const old = edit(base, s => { s.cardioGoal = 300 }, 5000)
    for (const [a, b] of [[phone, old], [old, phone]]) {
      expect(cardioGoalsOf(mergeStates(a, b))).toEqual([{ kind: 'any', unit: 'min', v: 300 }, { kind: 'swim', unit: 'km', v: 2 }])
    }
  })
})
