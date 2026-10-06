import { describe, expect, test } from 'vitest'
import { mutateRoutines } from './routine-mutations.js'

const profile = () => ({ routines: [{ id: 'old', name: 'Existing', ex: [{ id: '0001', sets: 3, reps: 8 }] }], week: { 1: 'old' }, workouts: [{ id: 'w' }], bodyweight: [{ w: 80 }] })
const plan = () => ({ routines: [{ name: 'New', exercises: [{ id: '0001', sets: 3, reps: 10, weight: 40, rest_sec: 90 }] }], weekdays: [{ weekday: 1, routine_indexes: [0] }] })

describe('shared routine operations', () => {
  test('creates a plan and only changes specified weekdays', () => {
    const state = profile(), before = structuredClone(state)
    state.week[3] = 'old'
    const result = mutateRoutines(state, 'create', plan(), () => 'new')
    expect(result.created_routines[0].id).toBe('new')
    expect(state.routines[1].ex).toEqual([{ id: '0001', mode: 'reps', sets: 3, reps: 10, weight: 40, restSec: 90 }])
    expect(state.routines[0]).toEqual(before.routines[0])
    expect(state.week).toEqual({ 1: ['new'], 3: 'old' })
    expect(state.workouts).toEqual(before.workouts)
    expect(state.bodyweight).toEqual(before.bodyweight)
  })
  test('an empty weekday assignment clears the day', () => {
    const state = profile(), input = plan()
    input.weekdays[0].routine_indexes = []
    mutateRoutines(state, 'create', input, () => 'new')
    expect(state.week).toEqual({})
  })
  test('partial edits retain configuration; mode changes clean incompatible targets and orphan supersets', () => {
    const state = profile()
    state.routines[0].emoji = 'star'
    state.routines[0].ex = [{ id: '0001', mode: 'reps', sets: 3, reps: 8, repsMin: 5, repsMax: 10, weight: 40, prog: 'double', inc: 2, note: 'keep', warmup: true, sg: 'pair' }, { id: '0027', sets: 3, reps: 8, sg: 'pair' }]
    mutateRoutines(state, 'edit', { routine_id: 'old', name: 'Renamed' })
    expect(state.routines[0].ex[0].note).toBe('keep')
    mutateRoutines(state, 'edit', { routine_id: 'old', exercises: [{ id: '0001', mode: 'time', sets: 2, sec: 30, rest_sec: 0 }] })
    expect(state.routines[0]).toEqual({ id: 'old', name: 'Renamed', emoji: 'star', ex: [{ id: '0001', mode: 'time', sets: 2, sec: 30, weight: 40, prog: 'double', inc: 2, note: 'keep', warmup: true }] })
  })
  test('deletion uses the app cleanup for scalar and combined weekdays and date overrides', () => {
    const state = profile(), before = structuredClone(state)
    state.routines.push({ id: 'other', ex: [] })
    state.week = { 1: 'old', 2: ['old', 'other'], 3: ['other'], 4: ['old'] }
    state.dayPlan = { '2026-10-05': 'old', '2026-10-06': 'other', '2026-10-07': 'rest' }
    const result = mutateRoutines(state, 'delete', { routine_id: 'old', confirm: true })
    expect(result.changed_weekdays).toEqual([1, 2, 4])
    expect(result.changed_dates).toEqual(['2026-10-05'])
    expect(state.week).toEqual({ 2: ['other'], 3: ['other'] })
    expect(state.dayPlan).toEqual({ '2026-10-06': 'other', '2026-10-07': 'rest' })
    expect(state.workouts).toEqual(before.workouts)
    expect(state.bodyweight).toEqual(before.bodyweight)
  })
  test('validates API input without relying on an MCP schema', () => {
    const bad = [
      { routines: [{ name: '', exercises: [] }] },
      { routines: [{ name: 'Bad', exercises: [{ id: 'nope', sets: 3, reps: 8 }] }] },
      { routines: [{ name: 'Bad', exercises: [{ id: '0001', sets: 3, reps: '8' }] }] },
      { routines: [{ name: 'Bad', exercises: [{ id: '0001', mode: 'time', sets: 3 }] }] },
      { ...plan(), weekdays: [{ weekday: '__proto__', routine_indexes: [0] }] },
      { ...plan(), weekdays: [{ weekday: 1, routine_indexes: [4] }] },
      { ...plan(), weekdays: [{ weekday: 1, routine_indexes: [0] }, { weekday: 1, routine_indexes: [0] }] }
    ]
    for (const input of bad) expect(() => mutateRoutines(profile(), 'create', input, () => 'new')).toThrow()
    expect(() => mutateRoutines(profile(), 'delete', { routine_id: 'old' })).toThrow('confirm=true')
    expect(() => mutateRoutines(profile(), 'edit', { routine_id: 'old' })).toThrow('at least one')
    expect(() => mutateRoutines(profile(), 'edit', { routine_id: 'missing', name: 'New' })).toThrow('No routine')
  })
  test('an existing target omitted during editing is retained', () => {
    const state = profile()
    mutateRoutines(state, 'edit', { routine_id: 'old', exercises: [{ id: '0001', sets: 4 }] })
    expect(state.routines[0].ex[0]).toMatchObject({ sets: 4, reps: 8 })
  })
  test('repeated exercise slots retain their own configuration in order', () => {
    const state = profile()
    state.routines[0].ex = [{ id: '0001', sets: 3, reps: 8, weight: 40, note: 'heavy' }, { id: '0001', sets: 2, reps: 12, weight: 20, note: 'light' }]
    mutateRoutines(state, 'edit', { routine_id: 'old', exercises: [{ id: '0001', sets: 4, reps: 6 }, { id: '0001', sets: 2, reps: 15 }] })
    expect(state.routines[0].ex.map(ex => [ex.weight, ex.note])).toEqual([[40, 'heavy'], [20, 'light']])
  })
  test('custom exercises use the selected profile catalogue', () => {
    const state = profile(), input = plan()
    state.customEx = [{ id: 'c1', n: 'My exercise', bp: 'chest', eq: 'custom' }]
    input.routines[0].exercises[0].id = 'c1'
    mutateRoutines(state, 'create', input, () => 'new')
    expect(state.routines[1].ex[0].id).toBe('c1')
    expect(() => mutateRoutines(profile(), 'create', input, () => 'new')).toThrow('Unknown exercise')
  })
})
