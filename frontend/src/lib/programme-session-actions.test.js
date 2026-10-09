// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { normalizeState } from '../store/useStore.js'
import { createProgrammeDefinition, startProgrammeCycleInState, programmeCycleItems, programmeWorkoutSource } from './programmes.js'
import { applySessionToFutureProgramme, programmeSessionChangeFields } from './programme-session-actions.js'

function fixture() {
  const state = normalizeState({ routines: [{ id: 'r', name: 'Source', ex: [{ id: '0025', sets: 1, reps: 5, weight: 40 }] }] })
  const definition = createProgrammeDefinition({ name: 'Three weeks', weeks: [1, 2, 3].map(() => ({ days: [{ weekday: 1, sessions: [{ routineId: 'r' }] }] })) }, state, { id: 'p' })
  state.programmes.definitions.push(definition)
  const cycle = startProgrammeCycleInState(state, 'p', { week1StartDate: '2026-09-07', timeZone: 'UTC' })
  const items = programmeCycleItems(state, cycle)
  const session = { id: 'active', routineId: 'r', routineIds: ['r', 'other'], ...programmeWorkoutSource(items[0]), entries: [{ id: '0025', rid: 'r', target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 8, done: true }] }, { id: '0047', rid: 'other', target: { sets: 1, reps: 5 }, sets: [{ w: 90, r: 5, done: true }] }] }
  state.workouts.push({ id: 'completed', ...programmeWorkoutSource(items[2]), entries: [], complete: true })
  return { state, cycle, session }
}
it.each(['active', 'saved'])('previews and updates only later unfinished source occurrences from %s history', kind => {
  const { state, cycle, session } = fixture()
  if (kind === 'saved') { session.resumeEntries = structuredClone(session.entries); state.workouts.push(session) }
  const before = structuredClone(state), original = structuredClone(session), weeks = structuredClone(cycle.snapshot.weeks)
  expect(programmeSessionChangeFields(state, session)).toContain('Weight'); expect(state).toEqual(before)
  expect(applySessionToFutureProgramme(state, session)).toBe(1)
  const next = state.programmes.cycles[0].snapshot.weeks
  expect(next[0]).toEqual(weeks[0]); expect(next[2]).toEqual(weeks[2])
  expect(next[1].days[0].sessions[0].routineSnapshot.ex).toHaveLength(1)
  expect(next[1].days[0].sessions[0].routineSnapshot.ex[0]).toMatchObject({ id: '0025', weight: 60, reps: 8 })
  expect(state.routines).toEqual(before.routines); expect(state.workouts).toEqual(before.workouts); expect(session).toEqual(original)
})
it('rejects a missing cycle without touching source routines or history', () => {
  const { state, session } = fixture(); state.programmes.cycles = []
  const before = structuredClone(state)
  expect(() => applySessionToFutureProgramme(state, session)).toThrow('no longer available')
  expect(state).toEqual(before)
})
