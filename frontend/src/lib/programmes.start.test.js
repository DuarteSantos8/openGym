import { describe, expect, it } from 'vitest'
import { createProgrammeDefinition, programmeSessionsForDate, programmeSessionsForStart, startProgrammeCycleInState } from './programmes.js'

function fixture(weekdays = [1, 2]) {
  const state = { programmeMode: true, routines: [{ id: 'push', name: 'Push', ex: [{ id: '0009' }] }], workouts: [], programmes: { version: 1, definitions: [], cycles: [] } }
  const definition = createProgrammeDefinition({ name: 'Strength', weeks: [{ days: weekdays.map(weekday => ({ weekday, sessions: [{ routineId: 'push' }] })) }] }, state, { id: 'definition' })
  startProgrammeCycleInState(state, definition, { id: 'cycle', week1StartDate: '2026-08-31', weekStart: 1 })
  return state
}

describe('programme start choices', () => {
  it('offers only the oldest unfinished overdue occurrence and preserves its identity and date', () => {
    const state = fixture()
    const first = programmeSessionsForDate(state, '2026-08-31')[0]
    const second = programmeSessionsForDate(state, '2026-09-01')[0]
    state.workouts.push({ cycleId: 'cycle', programmeInstanceId: first.instanceId })
    const before = structuredClone(state)
    expect(programmeSessionsForStart(state, '2026-09-02', '2026-09-02')).toEqual([second])
    expect(programmeSessionsForDate(state, '2026-09-02')).toEqual([])
    expect(state).toEqual(before)
  })

  it('keeps scheduled occurrences ahead of catch-up work even when today is completed', () => {
    const state = fixture()
    const today = programmeSessionsForDate(state, '2026-09-01')[0]
    state.workouts.push({ cycleId: 'cycle', programmeInstanceId: today.instanceId })
    expect(programmeSessionsForStart(state, '2026-09-01', '2026-09-01')).toEqual([{ ...today, status: 'completed' }])
  })

  it('does not add overdue work to other dates or while programme mode is off', () => {
    const state = fixture([1])
    expect(programmeSessionsForStart(state, '2026-09-03', '2026-09-02')).toEqual([])
    expect(programmeSessionsForStart(state, '2026-09-01', '2026-09-02')).toEqual([])
    state.programmeMode = false
    expect(programmeSessionsForStart(state, '2026-09-02', '2026-09-02')).toEqual([])
  })

  it('offers one overdue occurrence per active cycle without merging repeated routines', () => {
    const state = fixture()
    const definition = createProgrammeDefinition({ name: 'Second block', weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }] }] }, state, { id: 'second' })
    startProgrammeCycleInState(state, definition, { id: 'second-cycle', week1StartDate: '2026-08-31', weekStart: 1 })
    const choices = programmeSessionsForStart(state, '2026-09-02', '2026-09-02')
    expect(choices.map(item => item.cycleId)).toEqual(['cycle', 'second-cycle'])
    expect(choices.every(item => item.date === '2026-08-31')).toBe(true)
    expect(new Set(choices.map(item => item.instanceId)).size).toBe(2)
  })
})
