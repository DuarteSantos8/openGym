// #908: two routines on one weekday stay one combined session unless the day is trained
// separately, then each is a session of its own with its own done state.
import { describe, expect, it } from 'vitest'
import { daySessions, daySessionsStatus, nextSessionIds, dayApart, withDayApart } from './day-sessions.js'

const iso = '2026-11-02'  // a Monday
const base = () => ({
  routines: [{ id: 'run', name: 'Run + lift', ex: [{ id: '0043' }] }, { id: 'ankle', name: 'Ankles', ex: [{ id: '0009' }] }],
  week: { 1: ['run', 'ankle'] }, dayPlan: {}, workouts: [], queue: null,
})

describe('day sessions (#908)', () => {
  it('a combined day is one session, the way it always was', () => {
    expect(daySessions(base(), iso, iso)).toEqual([['run', 'ankle']])
    expect(dayApart(base(), iso)).toBe(false)
  })
  it('a day trained separately is one session per routine, each done on its own', () => {
    const S = { ...base(), weekApart: withDayApart({}, 1, true) }
    expect(dayApart(S, iso)).toBe(true)
    expect(daySessions(S, iso, iso)).toEqual([['run'], ['ankle']])
    expect(nextSessionIds(S, iso)).toEqual(['run'])
    S.workouts = [{ id: 'w1', d: iso, start: 1, end: 2, routineIds: ['run'], entries: [] }]
    const st = daySessionsStatus(S, iso)
    expect(st.map(x => !!x.done)).toEqual([true, false])
    expect(nextSessionIds(S, iso)).toEqual(['ankle'])
    S.workouts.push({ id: 'w2', d: iso, start: 3, end: 4, routineIds: ['ankle'], entries: [] })
    expect(nextSessionIds(S, iso)).toBeNull()
  })
  it('back together drops the key, and a rest day has no sessions', () => {
    expect(withDayApart({ 1: true, 3: true }, 1, false)).toEqual({ 3: true })
    expect(daySessions({ ...base(), week: {} }, iso, iso)).toEqual([])
  })
})
