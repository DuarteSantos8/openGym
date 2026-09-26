// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { beginWorkout } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { ruleOccurrence } from './lib/test-fixtures.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = EXDB.filter(e => e.bp !== 'cardio').slice(0, 3).map(e => e.id)
const fiveAt60 = r => ({ ...r, parameters: { ...r.parameters, sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 60, unit: 'kg' } } })
const routine = (id, name, exercises, over = {}) => ({ id, name, ex: exercises.map((exerciseId, i) => ruleOccurrence(exerciseId, { occurrenceId: id + '-' + i, routineId: id, patch: fiveAt60 })), ...over })

function install(routines, week = {}) {
  const S = clone(DEF)
  S.routines = routines
  S.week = week
  S.workouts = []
  useStore.setState({ S, A: null, user: null })
}

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [] })
  install([
    routine('strength', 'Strength', [ids[0]]),
    routine('core', 'Core', [ids[1], ids[2]]),
    routine('rehab', 'Rehab', [ids[1]], { excludeFromProgression: true }),
  ])
})

describe('beginWorkout with a routine-id list', () => {
  it('concatenates the routines’ exposures in order and derives the name', () => {
    act(() => beginWorkout(['strength', 'core'], null))
    const a = useStore.getState().A
    expect(a.routineIds).toEqual(['strength', 'core'])
    expect(a.name).toBe('Strength + Core')
    expect(a.status).toBe('in-progress')
    expect(a.exposures.map(x => x.routineId)).toEqual(['strength', 'core', 'core'])
    expect(a).not.toHaveProperty('routineId')
    expect(a).not.toHaveProperty('excludeFromProgression')
  })

  it('projects canonical exposures into the temporary rows required by Workout', () => {
    act(() => beginWorkout(['strength'], null))
    const a = useStore.getState().A
    expect(a.entries).toHaveLength(1)
    expect(a.entries[0]).toMatchObject({ id: ids[0], exposureId: a.exposures[0].exposureId, rid: 'strength' })
    expect(a.entries[0].sets[0].setId).toBeTruthy()
  })

  it('a single-element list is an ordinary single-routine session', () => {
    act(() => beginWorkout(['strength'], null))
    const a = useStore.getState().A
    expect(a.routineIds).toEqual(['strength'])
    expect(a.name).toBe('Strength')
    expect(a.exposures.every(x => x.routineId === 'strength')).toBe(true)
  })

  it('an empty list is a freestyle session — no exposures', () => {
    act(() => beginWorkout([], null))
    const a = useStore.getState().A
    expect(a.routineIds).toEqual([])
    expect(a.name).toBe('Freestyle')
    expect(a.exposures).toEqual([])
  })

  it('carries a merged excluded routine’s per-exposure exclusion', () => {
    act(() => beginWorkout(['strength', 'rehab'], null))
    const a = useStore.getState().A
    expect(a.exposures.find(x => x.routineId === 'rehab').excludedFromProgression).toBe(true)
    expect(a.exposures.find(x => x.routineId === 'strength').excludedFromProgression).toBe(false)
  })

  it('drops an unknown id and de-dupes a repeat (first wins)', () => {
    act(() => beginWorkout(['core', 'gone', 'core'], null))
    expect(useStore.getState().A.routineIds).toEqual(['core'])
  })
})
