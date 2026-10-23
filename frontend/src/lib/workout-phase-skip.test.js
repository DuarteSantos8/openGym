// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { skipSection, sectionSkipped, entrySettled } from './workout-sections.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { nextOpenSet } from './workout-keys.js'
import { nextUnfinishedUnit } from './supersetFlow.js'
import { setsDoneActive, setUnitsTotal, workoutVolume, supersetUnits } from './history.js'
import { exerciseChips } from './exercise-chips.js'
import { makeSideSet } from './workout-model.js'
import { editCompletedSession, saveWorkoutEdit, editChangesNothing } from './session-edit.js'
import { normalizeState } from '../store/useStore.js'

const phase = id => ({ id, label: id, type: 'custom', countsAsWork: true })
const row = done => ({ w: 40, r: 5, done })
function session() {
  return { id: 'a', d: '2026-10-14', start: 100, cur: 0, programmeInstanceId: 'instance',
    sections: [phase('main'), phase('finish')], entries: [
      { id: '0025', occurrenceId: 'first', sectionId: 'main', target: { sets: 2, reps: 5 }, sets: [row(true), row(false)] },
      { id: '0047', occurrenceId: 'second', sectionId: 'main', target: { sets: 1, reps: 5 }, sets: [row(false)] },
      { id: '0025', occurrenceId: 'last', sectionId: 'finish', target: { sets: 1, reps: 5 }, sets: [row(false)] },
    ] }
}

it('skips only the selected phase without altering any result or routine target, and resumes it', () => {
  const active = session(), before = structuredClone(active)
  expect(skipSection(active, 'main')).toBe(true)
  expect(active.cur).toBe(2)
  expect(sectionSkipped(active, 'main')).toBe(true)
  expect(active.entries[2].skipped).toBeUndefined()
  active.entries.forEach((entry, i) => {
    expect(entry.sets).toEqual(before.entries[i].sets)
    expect(entry.target).toEqual(before.entries[i].target)
  })
  expect(setsDoneActive(active)).toBe(1)
  expect(setUnitsTotal(active.entries)).toBe(2)
  expect(nextOpenSet(active.entries, 0)).toMatchObject({ idx: 2, i: 0 })
  expect(nextUnfinishedUnit(active.entries, supersetUnits(active.entries), 2)).toBeNull()
  expect(exerciseChips(active.entries, 2).map(c => c.state)).toEqual(['skipped', 'skipped', 'todo'])
  skipSection(active, 'main', false)
  expect(active.entries).toEqual(before.entries)
  expect(nextOpenSet(active.entries, 0)).toMatchObject({ idx: 0, i: 1 })
})

it('retains one completed side without counting its skipped partner', () => {
  const active = session()
  active.entries[0].sets = [makeSideSet({ w: 20, r: 10, done: false })]
  active.entries[0].sets[0].sides.L.done = true
  skipSection(active, 'main')
  expect(setsDoneActive(active)).toBe(1)
  expect(setUnitsTotal(active.entries)).toBe(2)
  expect(buildCompletedWorkout(active).entries[0].sets[0].sides.L.done).toBe(true)
  expect(buildCompletedWorkout(active).entries[0].sets[0].sides.R.done).toBe(false)
})

it('persists skip intent through reload, finish and resume, without fake volume or failed progression', () => {
  const active = session()
  skipSection(active, 'main')
  active.entries[2].sets[0].done = true
  expect(active.entries.every(entrySettled)).toBe(true)
  const reloaded = normalizeState(JSON.parse(JSON.stringify({ active }))).active
  expect(reloaded.entries[0].skipped).toBe(true)
  const record = buildCompletedWorkout(reloaded, { end: 200 })
  expect(record.entries).toHaveLength(2)
  expect(record.entries[0]).toMatchObject({ skipped: true, noProg: true })
  expect(workoutVolume(record)).toBe(400)
  const state = normalizeState({ workouts: [record], routines: [] })
  editCompletedSession(state, record.id)
  expect(state.active.entries.map(e => e.skipped)).toEqual(reloaded.entries.map(e => e.skipped))
  skipSection(state.active, 'main', false)
  expect(state.active.entries[0].noProg).toBeUndefined()
  expect(nextOpenSet(state.active.entries, 0)).toMatchObject({ idx: 0, i: 1 })

})

it('preserves skipped exercises in history editing and removes stale resume data after completing them', () => {
  const active = session()
  skipSection(active, 'main')
  active.entries[2].sets[0].done = true
  const record = buildCompletedWorkout(active, { end: 200 })
  const state = normalizeState({ workouts: [record] })
  editCompletedSession(state, 'a')
  expect(state.active.entries).toHaveLength(3)
  expect(editChangesNothing(state)).toBe(true)
  skipSection(state.active, 'main', false)
  state.active.entries.forEach(entry => entry.sets.forEach(set => { set.done = true }))
  const saved = saveWorkoutEdit(state, 300)
  expect(saved.resumeEntries).toBeUndefined()
  expect(saved.entries.some(entry => entry.skipped || entry.noProg)).toBe(false)
})

it('does not invent work for an empty, finished or missing phase', () => {
  const active = session()
  expect(skipSection(active, 'missing')).toBe(false)
  active.entries.forEach(entry => entry.sets.forEach(set => { set.done = true }))
  skipSection(active, 'main')
  expect(sectionSkipped(active, 'main')).toBe(false)
  expect(skipSection({ entries: [] }, 'main')).toBe(false)
})

it('restores progression after resuming the only partially completed exercise in history', () => {
  const active = session()
  active.entries = [active.entries[0]]
  skipSection(active, 'main')
  const record = buildCompletedWorkout(active, { end: 200 })
  expect(record.excludeFromProgression).toBe(true)
  const state = normalizeState({ workouts: [record] })
  editCompletedSession(state, 'a')
  skipSection(state.active, 'main', false)
  state.active.entries[0].sets[1].done = true
  const saved = saveWorkoutEdit(state, 300)
  expect(saved.entries[0].noProg).toBeUndefined()
  expect(saved.excludeFromProgression).toBeUndefined()
})

it('preserves ordinary early-finish resume data when editing history without phase skips', () => {
  const record = buildCompletedWorkout(session(), { end: 200 })
  const state = normalizeState({ workouts: [record] })
  editCompletedSession(state, 'a')
  state.active.entries[0].sets[0].r = 6
  const saved = saveWorkoutEdit(state, 300)
  expect(saved.resumeEntries).toEqual(record.resumeEntries)
})
