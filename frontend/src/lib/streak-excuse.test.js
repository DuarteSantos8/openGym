// Sick and travel weeks (api/coach/core/streak.js): a missed week with a sick, travel or injured
// day note keeps the streak without spending a freeze, up to a cap a year, the same on the server.
import { describe, expect, it } from 'vitest'
import { streakInfo } from './streak.js'
import { setExcuseCap, excuseCapOf, EXCUSE_DEFAULT } from './streak-rule.js'
import { explainWeek, excuseLabel, excuseLine } from './streak-explain.js'
import { streakWeeks } from './streak-explain.js'
import { streakWeeks as serverStreak } from '../../../api/trainers/projections.js'

const mondays = list => list.map(d => ({ d }))
// Weekly workouts on Mondays of Sep/Oct 2026, with the weeks of 5 and 12 Oct missed.
const base = () => ({
  weekStart: 1,
  streakRule: { rule: 'off', since: null, history: [] },
  workouts: mondays(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-19', '2026-10-26']),
})

describe('sick and travel weeks', () => {
  it('without a note, a missed week on the no-freeze rule breaks the streak', () => {
    expect(streakInfo(base(), '2026-10-28').current).toBe(2)
  })

  it('a sick note on any day of the missed weeks carries the streak and spends nothing', () => {
    const S = { ...base(), dayNotes: { '2026-10-07': { tag: 'sick', _ts: 1 }, '2026-10-15': { tag: 'travel', text: 'Lisbon', _ts: 2 } } }
    const info = streakInfo(S, '2026-10-28')
    expect(info.current).toBe(6)
    expect(info.excused).toEqual(['2026-10-05', '2026-10-12'])
    expect(info.excuseLeft).toBe(EXCUSE_DEFAULT - 2)
    // Same number for the trainer's member list.
    expect(serverStreak(S, '2026-10-28')).toBe(6)
  })

  it('a rest-day note or a cleared note does not excuse', () => {
    const S = { ...base(), dayNotes: { '2026-10-07': { tag: 'rest', _ts: 1 }, '2026-10-14': { _ts: 2 } } }
    expect(streakInfo(S, '2026-10-28').current).toBe(2)
  })

  it('keeps the freezes in the bank when a note covers the week', () => {
    const S = { ...base(), streakRule: { rule: 'generous', since: null, history: [] }, dayNotes: { '2026-10-06': { tag: 'injured', _ts: 1 } } }
    S.workouts = mondays(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-12', '2026-10-19'])
    const info = streakInfo(S, '2026-10-21')
    expect(info.current).toBe(6)
    expect(info.freezes).toBe(1)
    expect(info.frozen).toEqual([])
  })

  it('stops at the yearly cap and falls back to freezes, then a new year starts fresh', () => {
    const S = { ...base(), streakExcuse: 2 }
    // Weeks trained with three sick weeks in between (each its own gap).
    S.workouts = mondays(['2026-09-07', '2026-09-21', '2026-10-05', '2026-10-19', '2027-01-04', '2027-01-18'])
    S.dayNotes = { '2026-09-15': { tag: 'sick' }, '2026-09-29': { tag: 'sick' }, '2026-10-13': { tag: 'sick' } }
    // Third sick week in 2026 is past the cap of 2: the no-freeze rule breaks the run there.
    expect(streakInfo(S, '2026-10-21').current).toBe(1)
    const log = new Map()
    streakInfo(S, '2026-10-21', log)
    expect(log.get('2026-09-14')).toMatchObject({ s: 'excused', tag: 'sick' })
    expect(log.get('2026-10-12').s).toBe('broke')
    expect(explainWeek(log.get('2026-09-14'))).toMatch(/sick/)
  })

  it('a cap of 0 turns it off, and the default is stored as no key', () => {
    const S = { ...base(), dayNotes: { '2026-10-07': { tag: 'sick' }, '2026-10-14': { tag: 'sick' } } }
    setExcuseCap(S, 0)
    expect(S.streakExcuse).toBe(0)
    expect(streakInfo(S, '2026-10-28').current).toBe(2)
    expect(excuseLine(streakInfo(S, '2026-10-28'))).toMatch(/freezes/)
    setExcuseCap(S, EXCUSE_DEFAULT)
    expect('streakExcuse' in S).toBe(false)
    expect(excuseCapOf(S)).toBe(EXCUSE_DEFAULT)
    expect(setExcuseCap(S, 99)).toBe(false)
    expect(excuseLabel(4)).toBe('4 weeks a year')
  })

  it('the calendar log marks the excused week with its tag', () => {
    const S = { ...base(), dayNotes: { '2026-10-07': { tag: 'travel' }, '2026-10-14': { tag: 'travel' } } }
    const { log } = streakWeeks(S, '2026-10-28')
    expect(log.get('2026-10-05')).toMatchObject({ s: 'excused', tag: 'travel' })
  })
})
