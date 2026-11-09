import { afterEach, describe, expect, it } from 'vitest'
import {
  deloadCycleOf, setDeloadEvery, deloadWhy, isDeloadDay, nextDeloadWeek, pushBack, skipDeload, addDeload,
  dismissSuggestion, deloadSets, performanceTrend, formTrend, deloadSuggestion, setDailyFormSource, dailyFormScores, setDeloadAuto,
} from './deload-cycle.js'
import { buildSessionEntries } from './session-start.js'

const sess = (d, id, w, r = 5) => ({ id: d + id, d, entries: [{ id, sets: [{ w, r, done: true }, { w, r, done: true }] }] })

afterEach(() => setDailyFormSource(null))

describe('deload weeks on a schedule', () => {
  it('every 4 weeks from this week: the 4th, 8th, … week is the deload', () => {
    const S = { weekStart: 1 }
    setDeloadEvery(S, 4, '2026-11-04')
    expect(S.deloadCycle).toEqual({ every: 4, from: '2026-11-02' })
    expect(deloadWhy(S, '2026-11-02')).toBe(null)
    expect(deloadWhy(S, '2026-11-23')).toBe('cycle')
    expect(deloadWhy(S, '2026-12-21')).toBe('cycle')
    expect(isDeloadDay(S, '2026-11-25')).toBe(true)
    expect(isDeloadDay(S, '2026-11-25', true)).toBe(false) // a programme running wins
    expect(nextDeloadWeek(S, '2026-11-04')).toBe('2026-11-23')
  })

  it('pushes one back a week, takes one out, adds one by hand', () => {
    const S = { weekStart: 1 }
    setDeloadEvery(S, 4, '2026-11-04')
    pushBack(S, '2026-11-23')
    expect(deloadWhy(S, '2026-11-23')).toBe(null)
    expect(deloadWhy(S, '2026-11-30')).toBe('cycle')
    expect(deloadWhy(S, '2026-12-21')).toBe('cycle') // the schedule after it stays
    skipDeload(S, '2026-12-21')
    expect(deloadWhy(S, '2026-12-21')).toBe(null)
    addDeload(S, '2026-11-09')
    expect(deloadWhy(S, '2026-11-09')).toBe('extra')
    setDeloadEvery(S, 0, '2026-11-04')
    expect(deloadCycleOf(S).every).toBe(0)
    expect(deloadWhy(S, '2026-11-09')).toBe('extra')
  })

  it('keeps 60 % of the work sets, at least one', () => {
    expect([1, 2, 3, 4, 5].map(deloadSets)).toEqual([1, 1, 2, 2, 3])
  })

  it('a deload week trains fewer sets at the same weight, out of progression', () => {
    const S = { weekStart: 1, unit: 'kg', workouts: [sess('2026-11-16', '0025', 100)], routines: [], exWeights: {}, deloadCycle: { every: 4, from: '2026-11-02' }, active: { d: '2026-11-25' } }
    const r = { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100 }] }
    S.routines = [r]
    const [e] = buildSessionEntries(S, r)
    expect(e.noProg).toBe(true)
    expect(e.plan.kind).toBe('deloadweek')
    expect(e.sets.filter(x => x.phase !== 'warmup' && !x.warmup).map(x => x.w)).toEqual([100, 100])
    // The plan the next session compares against is still the routine's own.
    expect(e.planned.sets).toBe(3)
    const normal = buildSessionEntries({ ...S, active: { d: '2026-11-18' } }, r)[0]
    expect(normal.noProg).toBeUndefined()
  })
})

describe('the automatic trigger', () => {
  const falling = () => ({
    weekStart: 1,
    workouts: [
      sess('2026-10-12', 'a', 100), sess('2026-10-14', 'b', 80),
      sess('2026-10-27', 'a', 95), sess('2026-10-29', 'b', 75),
    ],
  })
  it('reads falling numbers over two weeks', () => {
    expect(performanceTrend(falling(), '2026-11-04').trend).toBe('falling')
    expect(performanceTrend({ workouts: [] }, '2026-11-04').trend).toBe(null)
  })

  it('suggests next week from performance alone without check-ins, once a week', () => {
    const S = falling()
    const sug = deloadSuggestion(S, '2026-11-04')
    expect(sug).toMatchObject({ week: '2026-11-09', reason: 'performance' })
    dismissSuggestion(S, '2026-11-04')
    expect(deloadSuggestion(S, '2026-11-04')).toBe(null)
    setDeloadAuto(S, false)
    expect(deloadSuggestion({ ...S, deloadCycle: { auto: false } }, '2026-11-05')).toBe(null)
    expect(deloadSuggestion(falling(), '2026-11-04', { programmeOn: true })).toBe(null)
  })

  it('reads the daily form through the hook, and needs both signals then', () => {
    const days = ['2026-10-25', '2026-10-27', '2026-10-30', '2026-11-01', '2026-11-03']
    setDailyFormSource((S, from, to) => days.filter(d => d >= from && d <= to).map(d => ({ d, score: 0.2 })).concat([{ d: 'bad' }]))
    expect(dailyFormScores({}, '2026-10-22', '2026-11-04')).toHaveLength(5)
    expect(formTrend({}, '2026-11-04')).toMatchObject({ low: true, n: 5 })
    expect(deloadSuggestion(falling(), '2026-11-04')).toMatchObject({ reason: 'both' })
    // Feeling low but the numbers climb: no suggestion.
    const rising = { weekStart: 1, workouts: [sess('2026-10-12', 'a', 90), sess('2026-10-14', 'b', 70), sess('2026-10-27', 'a', 100), sess('2026-10-29', 'b', 80)] }
    expect(deloadSuggestion(rising, '2026-11-04')).toBe(null)
    // A source that throws reads as no data.
    setDailyFormSource(() => { throw new Error('nope') })
    expect(dailyFormScores({}, '2026-10-22', '2026-11-04')).toEqual([])
  })

  it('stays quiet with a deload coming or just done', () => {
    const S = falling()
    addDeload(S, '2026-11-09')
    expect(deloadSuggestion(S, '2026-11-04')).toBe(null)
    const T = falling()
    addDeload(T, '2026-10-26')
    expect(deloadSuggestion(T, '2026-11-04')).toBe(null)
  })
})
