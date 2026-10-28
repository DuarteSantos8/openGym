// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { beginWorkout } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { defaultWarmupStep } from '../../api/training/guided-warmup.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = EXDB.filter(e => e.bp !== 'cardio').slice(0, 3).map(e => e.id)

function install(routines, week = {}) {
  const S = clone(DEF)
  S.routines = routines
  S.week = week
  S.active = null
  S.workouts = []
  useStore.setState({ S, user: null })
}

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [] })
  install([
    { id: 'strength', name: 'Strength', emoji: '🏋️', prog: 'off', ex: [{ id: ids[0], sets: 3, reps: 5, weight: 60 }] },
    { id: 'core', name: 'Core', emoji: '🧘', prog: 'off', ex: [{ id: ids[1], sets: 3, reps: 12, weight: 0 }, { id: ids[2], sets: 3, reps: 10, weight: 0 }] },
    { id: 'rehab', name: 'Rehab', emoji: '🩹', excludeFromProgression: true, ex: [{ id: ids[1], sets: 2, reps: 15, weight: 5 }] },
  ])
})

describe('beginWorkout with a routine-id list', () => {
  it('concatenates the routines’ entries in order, stamps rid, derives the name', () => {
    act(() => beginWorkout(['strength', 'core'], null))
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual(['strength', 'core'])
    expect(a.name).toBe('Strength + Core')
    expect(a.entries.map(e => e.rid)).toEqual(['strength', 'core', 'core'])
    expect(a).not.toHaveProperty('routineId')
    expect(a).not.toHaveProperty('excludeFromProgression')
  })

  it('a single-element list is an ordinary single-routine session', () => {
    act(() => beginWorkout(['strength'], null))
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual(['strength'])
    expect(a.name).toBe('Strength')
    expect(a.entries.every(e => e.rid === 'strength')).toBe(true)
  })

  it('an empty list is a freestyle session — no entries, no rid', () => {
    act(() => beginWorkout([], null))
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual([])
    expect(a.name).toBe('Freestyle')
    expect(a.entries).toEqual([])
  })

  it('carries a merged excluded routine’s per-entry noProg', () => {
    act(() => beginWorkout(['strength', 'rehab'], null))
    const a = useStore.getState().S.active
    expect(a.entries.find(e => e.rid === 'rehab').noProg).toBe(true)
    expect(a.entries.find(e => e.rid === 'strength').noProg).toBeUndefined()
  })

  it('drops an unknown id and de-dupes a repeat (first wins)', () => {
    act(() => beginWorkout(['core', 'gone', 'core'], null))
    expect(useStore.getState().S.active.routineIds).toEqual(['core'])
  })

  it('snapshots one guided warm-up before the unchanged combined working entries', () => {
    const baseline = () => {
      act(() => beginWorkout(['strength', 'core'], null))
      return structuredClone(useStore.getState().S.active.entries)
    }
    const main = baseline()
    useStore.getState().update(s => {
      s.active = null
      s.routines[0].warmup = { enabled: true, steps: [defaultWarmupStep('3905')] }
      s.routines[1].warmup = { enabled: true, steps: [defaultWarmupStep('3905'), defaultWarmupStep('3502')] }
    })
    act(() => beginWorkout(['strength', 'core'], null))
    const active = useStore.getState().S.active
    expect(active.entries).toEqual(main)
    expect(active.warmup).toMatchObject({ status: 'in_progress', current: 0 })
    expect(active.warmup.steps.map(s => s.id)).toEqual(['3905', '3502'])
    useStore.getState().update(s => { s.routines[0].warmup.steps[0].sec = 60 })
    expect(active.warmup.steps[0].sec).toBe(30)
  })

  it('does not introduce a preparation stage for disabled or empty routines', () => {
    useStore.getState().update(s => {
      s.routines[0].warmup = { enabled: false, steps: [defaultWarmupStep('3905')] }
    })
    act(() => beginWorkout(['strength'], null))
    expect(useStore.getState().S.active).not.toHaveProperty('warmup')
    act(() => beginWorkout([], null))
    expect(useStore.getState().S.active).not.toHaveProperty('warmup')
  })

  it('keeps a watch-started session’s identity and time alongside guided preparation', () => {
    const start = Date.parse('2026-10-26T12:00:00Z')
    useStore.getState().update(s => {
      s.routines[0].warmup = { enabled: true, steps: [defaultWarmupStep('3905')] }
    })
    act(() => beginWorkout(['strength'], 75, { id: 'watch-start', start }))
    const active = useStore.getState().S.active
    expect(active).toMatchObject({ id: 'watch-start', start, d: '2026-10-26', bw: 75, routineIds: ['strength'] })
    expect(active.warmup).toMatchObject({ status: 'in_progress', current: 0,
      steps: [{ ...defaultWarmupStep('3905'), status: 'pending' }] })
    expect(active.entries).toHaveLength(1)
    expect(active.entries[0].id).toBe(ids[0])
  })

})
