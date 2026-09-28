import { describe, test, expect } from 'vitest'
import { mergeExerciseHistory } from './history-migration.js'
import { mergeExerciseHistory as serverMerge } from '../../../api/history-migration.js'
import { best1RM } from './onerm.js'
import { exerciseHistory } from './exercise-history.js'
import { sessionsFor } from './progression.js'
import { lastEntryFor, pinnedNoteFor, workoutVolume, bestWeightFor } from './history.js'
import { buildSessionEntries } from './session-start.js'

const input = { source_exercise_id: '0001', target_exercise_id: '0027', update_routines: true }
const set = (w, r = 8) => ({ w, r, done: true, rpe: 8, rir: 2, drops: [{ w: 5, r: 2, done: true }] })
const entry = (id, w, note = 'original') => ({ id, target: { id, mode: 'reps', reps: 8, sets: 1 }, sets: [set(w)], note, notePin: true, rid: 'r', topW: w, muscleSnapshot: { n: 'original', muscleWeights: { quads: 1 } } })
const state = () => ({
  workouts: [
    { id: 'w1', d: '2026-09-01', start: 1, note: 'session', entries: [entry('0027', 30)], prs: ['0027', 'other'] },
    { id: 'w2', d: '2026-09-02', start: 2, entries: [entry('0027', 20), entry('0001', 50, 'source note')], prs: ['0001'] }
  ], routines: [{ id: 'r', name: 'Legs', prog: 'off', ex: [{ id: '0001', sets: 1, reps: 8, weight: 20, side: true, sg: 'pair' }, { id: '0002', sets: 1, reps: 8, sg: 'pair' }] }],
  exWeights: { '0001': { w: 50, d: '2026-09-02' }, '0027': { w: 30, d: '2026-09-01' }, other: { w: 9 } },
  bodyweight: [{ d: '2026-09-01', w: 80 }], week: { 1: 'r' }
})

describe('exercise history migration', () => {
  test('moves references without changing original sets, notes, targets or snapshots', () => {
    const before = state(), copy = structuredClone(before)
    const { state: next, summary } = mergeExerciseHistory(before, input)
    expect(before).toEqual(copy)
    expect(summary).toMatchObject({ workouts_updated: 1, entries_moved: 1, sets_moved: 1, routines_updated: 1, overlapping_workouts: 1 })
    expect(next.workouts[1].entries[1]).toEqual({ ...before.workouts[1].entries[1], id: '0027', target: { ...before.workouts[1].entries[1].target, id: '0027' } })
    expect(next.workouts[1].entries[0]).toEqual(before.workouts[1].entries[0])
    expect(next.bodyweight).toEqual(before.bodyweight)
    expect(next.routines[0].ex[0]).toEqual({ ...before.routines[0].ex[0], id: '0027' })
    expect(next.week).toEqual(before.week)
    expect(next.workouts.map(workoutVolume)).toEqual(before.workouts.map(workoutVolume))
  })
  test('all colliding entries contribute to history, 1RM, PRs and progression preview', () => {
    const { state: next } = mergeExerciseHistory(state(), input)
    expect(best1RM(next, '0027').w).toBe(50)
    expect(best1RM(next, '0001')).toBeNull()
    expect(bestWeightFor(next, '0027')).toBe(50)
    const history = exerciseHistory(next, '0027')
    expect(history.best).toBe(50)
    expect(history.total).toBe(2)
    expect(history.points).toHaveLength(2)
    expect(history.sessions.flatMap(s => s.sets)).toHaveLength(3)
    expect(next.workouts.map(w => w.prs)).toEqual([['other', '0027'], ['0027']])
    expect(next.exWeights['0001']).toBeUndefined()
    expect(next.exWeights['0027']).toEqual({ w: 50, d: '2026-09-02' })
    expect(sessionsFor(next, '0027').map(s => s.weight)).toContain(50)
    expect(lastEntryFor(next, '0027').sets[0].w).toBe(50)
    expect(pinnedNoteFor(next, '0027').note).toBe('source note')
    expect(buildSessionEntries(next, { ...next.routines[0], prog: 'linear' })[0].sets[0].w).toBeGreaterThan(50)
  })
  test('excluded migrated entries stay out of progression', () => {
    const before = state(); before.workouts[1].entries[1].noProg = true
    const { state: next } = mergeExerciseHistory(before, input)
    expect(sessionsFor(next, '0027').map(s => s.weight)).toEqual([30, 20])
    expect(lastEntryFor(next, '0027').sets[0].w).toBe(20)
  })
  test('rejects unknown IDs, equal IDs and routine collisions without mutation', () => {
    const before = state(), copy = structuredClone(before)
    expect(() => mergeExerciseHistory(before, { ...input, target_exercise_id: 'missing' })).toThrow('Unknown')
    expect(() => mergeExerciseHistory(before, { ...input, target_exercise_id: '0001' })).toThrow('different')
    before.routines[0].ex.push({ id: '0027', sets: 3, reps: 5 })
    expect(() => mergeExerciseHistory(before, input)).toThrow('already contains')
    expect(mergeExerciseHistory(before, { ...input, update_routines: false }).state.routines).toEqual(before.routines)
    expect(before.workouts).toEqual(copy.workouts)
  })
  test('same-load blocks count as one exposure and keep their original target checks', () => {
    const before = state()
    before.workouts[1].entries[0].sets[0].w = 50
    before.workouts[1].entries[0].sets[0].r = 5
    before.workouts[1].entries[0].target.reps = 5
    const { state: next } = mergeExerciseHistory(before, input)
    const sessions = sessionsFor(next, '0027')
    expect(sessions).toHaveLength(2)
    expect(sessions[1].ok).toBe(true)
    expect(sessions[1].count).toBe(2)
  })
  test('server artifact matches canonical metrics, including custom exercises and warmups', () => {
    const before = state()
    before.customEx = [{ id: 'custom-source', n: 'Old press', bp: 'upper legs', eq: 'machine' }, { id: 'custom-target', n: 'New press', bp: 'upper legs', eq: 'machine' }]
    before.workouts[1].entries[1].id = 'custom-source'
    before.workouts[1].entries[1].target.id = 'custom-source'
    before.workouts[1].entries[1].sets.push({ w: 999, r: 8, done: true, warmup: true })
    before.workouts[1].vol = -1
    const args = { source_exercise_id: 'custom-source', target_exercise_id: 'custom-target' }
    const canonical = mergeExerciseHistory(before, args)
    expect(serverMerge(before, args)).toEqual(canonical)
    expect(canonical.state.exWeights['custom-target'].w).toBe(50)
    expect(canonical.state.workouts[1].vol).toBe(workoutVolume(before.workouts[1]))
    expect(canonical.summary.sets_moved).toBe(2)
  })
  test('timed overlapping blocks retain duration and do not introduce invalid rep metrics', () => {
    const before = state()
    for (const en of before.workouts[1].entries) {
      en.target = { id: en.id, mode: 'time', sets: 1, sec: 30 }
      en.sets = [{ w: 20, sec: 45, done: true }]
    }
    const { state: next } = mergeExerciseHistory(before, input)
    const timed = sessionsFor(next, '0027').filter(s => s.mode === 'time')
    expect(timed).toHaveLength(1)
    expect(timed[0].held).toEqual([45, 45])
    expect(timed[0].count).toBeUndefined()
    expect(exerciseHistory(next, '0027').sessions[0].sets).toHaveLength(2)
  })
  test('merged blocks retain independent progression and last entries for each routine', () => {
    const before = state()
    before.workouts[1].entries[0].rid = 'other-routine'
    before.workouts[1].entries[0].sets[0].w = 50
    before.workouts[1].entries[0].sets[0].r = 3
    before.workouts[1].entries[0].planned = { sets: 1, reps: 8, mode: 'reps' }
    before.workouts[1].entries[1].planned = { sets: 1, reps: 8, mode: 'reps' }
    const { state: next } = mergeExerciseHistory(before, input)
    const own = sessionsFor(next, '0027', undefined, 'r')
    const other = sessionsFor(next, '0027', undefined, 'other-routine')
    expect(own.at(-1)).toMatchObject({ rid: 'r', weight: 50, ok: true, count: 1 })
    expect(other.at(-1)).toMatchObject({ rid: 'other-routine', weight: 50, ok: false, count: 1 })
    expect(own.at(-1).planned).toEqual(before.workouts[1].entries[1].planned)
    expect(lastEntryFor(next, '0027', 'r').sets[0].r).toBe(8)
    expect(lastEntryFor(next, '0027', 'other-routine').sets[0].r).toBe(3)
  })
  test('repeated merge is a no-op', () => {
    const first = mergeExerciseHistory(state(), input)
    expect(mergeExerciseHistory(first.state, input).state).toEqual(first.state)
  })
})
