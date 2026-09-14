import { describe, expect, it } from 'vitest'
import { editCompletedSession, localStateForEditMerge, saveWorkoutEdit } from './session-edit.js'

const entry = (w, id = '0025') => ({ id, sets: [{ w, r: 5, done: true }], target: { mode: 'reps' } })
const fixture = () => ({
  active: null,
  exWeights: {},
  routines: [{ id: 'routine', ex: [] }],
  workouts: [{ id: 'workout', d: '2026-09-01', start: 1000, end: 2000, entries: [entry(40)], note: 'old', prs: ['0025'] }],
})

describe('saved workout editing', () => {
  it('keeps history unchanged until Save, survives reload and preserves its identity, clock and templates', () => {
    const state = fixture(), history = structuredClone(state.workouts), routines = structuredClone(state.routines)
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 80
    state.active.note = ''
    expect(state.workouts).toEqual(history)
    const reloaded = JSON.parse(JSON.stringify(state))
    const saved = saveWorkoutEdit(reloaded)
    expect(saved).toMatchObject({ id: 'workout', d: '2026-09-01', start: 1000, end: 2000, vol: 400 })
    expect(saved).not.toHaveProperty('note')
    expect(saved).not.toHaveProperty('editingWorkoutId')
    expect(reloaded.active).toBeNull()
    expect(reloaded.routines).toEqual(routines)
  })

  it('saves added exercises and sets without persisting a live prescription', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets.push({ w: 42.5, r: 4, done: true })
    state.active.entries.push({ ...entry(25, 'added'), rid: 'routine', plan: { kind: 'up' } })
    const saved = saveWorkoutEdit(state)
    expect(saved.entries[0].sets).toHaveLength(2)
    expect(saved.entries[1]).toMatchObject({ id: 'added', rid: 'routine' })
    expect(saved.entries[1]).not.toHaveProperty('plan')
  })

  it('rebuilds best weights and historical PR flags after lowering or deleting record work', () => {
    const state = fixture()
    state.workouts.push({ id: 'later', d: '2026-09-02', start: 3000, end: 4000, entries: [entry(30)], prs: [] })
    state.exWeights['0025'] = { w: 40, d: '2026-09-01' }
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 20
    saveWorkoutEdit(state)
    expect(state.exWeights['0025']).toEqual({ w: 30, d: '2026-09-02' })
    expect(state.workouts[0].prs).toEqual(['0025'])
    expect(state.workouts[1].prs).toEqual(['0025'])
  })

  it('preserves repeated occurrences, combined-routine ownership and per-side fields', () => {
    const state = fixture(), workout = state.workouts[0]
    workout.routineIds = ['a', 'b']
    workout.entries = [
      { ...entry(40), rid: 'a', occurrenceId: 'first', opaque: { retained: true } },
      { ...entry(20), rid: 'b', occurrenceId: 'second', sets: [{ w: 20, r: 8, done: true, sides: { L: { w: 12, r: 4, done: true }, R: { w: 8, r: 4, done: true } } }] },
    ]
    editCompletedSession(state, 'workout')
    state.active.entries[1].sets[0].sides.L.w = 14
    const saved = saveWorkoutEdit(state)
    expect(saved.entries.map(item => [item.occurrenceId, item.rid])).toEqual([['first', 'a'], ['second', 'b']])
    expect(saved.entries[0].opaque).toEqual({ retained: true })
    expect(saved.entries[1].sets[0].sides.L.w).toBe(14)
  })

  it('keeps a partially completed per-side occurrence and its opaque ownership', () => {
    const state = fixture()
    state.workouts[0].entries = [{
      ...entry(20), rid: 'routine', occurrenceId: 'partial',
      sets: [{ w: 20, r: 8, done: false, sides: {
        L: { w: 20, r: 4, done: true }, R: { w: 17.5, r: 4, done: false },
      } }],
    }]
    editCompletedSession(state, 'workout')
    const saved = saveWorkoutEdit(state)
    expect(saved.entries[0]).toMatchObject({ rid: 'routine', occurrenceId: 'partial' })
    expect(saved.entries[0].sets[0].sides).toEqual({
      L: { w: 20, r: 4, done: true }, R: { w: 17.5, r: 4, done: false },
    })
    expect(saved.vol).toBe(80)
  })

  it('keeps the draft when the original is missing or changed remotely', () => {
    const deleted = fixture()
    editCompletedSession(deleted, 'workout')
    deleted.workouts = []
    expect(() => saveWorkoutEdit(deleted)).toThrow('deleted on another device')
    expect(deleted.active.editingWorkoutId).toBe('workout')

    const changed = fixture()
    editCompletedSession(changed, 'workout')
    changed.workouts[0].note = 'remote'
    expect(() => saveWorkoutEdit(changed)).toThrow('changed on another device')
    expect(changed.active.editingWorkoutId).toBe('workout')
  })

  it('feeds a remotely changed or deleted original into the current revision merge', () => {
    const local = fixture()
    editCompletedSession(local, 'workout')
    local.active.entries[0].sets[0].w = 50
    const remote = fixture()
    remote.workouts[0].note = 'from phone'
    remote.exWeights['0025'] = { w: 40, d: '2026-09-01' }
    expect(localStateForEditMerge(local, remote).workouts[0].note).toBe('from phone')
    expect(localStateForEditMerge(local, { ...remote, workouts: [] }).workouts).toEqual([])
    expect(local.active.entries[0].sets[0].w).toBe(50)
  })

  it('restores a locally saved correction as a draft when its first push conflicts', () => {
    const local = fixture()
    editCompletedSession(local, 'workout')
    const original = structuredClone(local.active.editingOriginal)
    local.active.entries[0].sets[0].w = 50
    saveWorkoutEdit(local)
    const remote = fixture()
    remote.workouts[0].note = 'from phone'
    remote.exWeights['0025'] = { w: 40, d: '2026-09-01' }
    const merged = localStateForEditMerge(local, remote, { id: 'workout', original })
    expect(merged.workouts[0].note).toBe('from phone')
    expect(merged.active.entries[0].sets[0].w).toBe(50)
    expect(merged.active.editingOriginal).toEqual(remote.workouts[0])
    expect(merged.exWeights['0025'].w).toBe(40)
  })
})
