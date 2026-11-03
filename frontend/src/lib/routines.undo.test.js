// Undo for deleting a routine (Plan's swipe and minus): routineSnapshot takes everything
// deleteRoutine is about to remove, restoreRoutine puts each pointer back where it was.
import { describe, expect, it } from 'vitest'
import { deleteRoutine, restoreRoutine, routineSnapshot } from './routines.js'

const state = () => ({
  routines: [{ id: 'a', name: 'Push', exercises: [{ id: 'x1', sets: 3 }] }, { id: 'b', name: 'Pull' }, { id: 'c', name: 'Legs' }],
  week: { 1: ['a', 'c'], 3: 'b', 5: ['c', 'a'] },
  dayPlan: { '2026-10-20': 'a', '2026-10-21': 'b' },
  rotation: { sequence: ['c', 'a', 'b'], at: 1 },
  queue: { ids: ['b', 'a'] },
})

describe('routineSnapshot', () => {
  it('records the routine, its list index and every place that names it', () => {
    const snap = routineSnapshot(state(), 'a')
    expect(snap).toEqual({
      routine: { id: 'a', name: 'Push', exercises: [{ id: 'x1', sets: 3 }] },
      index: 0,
      week: { 1: 0, 5: 1 },
      dayPlan: { '2026-10-20': 'a' },
      seqAt: 1,
      queueAt: 1,
    })
  })
  it('copies the routine, so editing the state later does not change the snapshot', () => {
    const S = state()
    const snap = routineSnapshot(S, 'a')
    S.routines[0].exercises[0].sets = 9
    expect(snap.routine.exercises[0].sets).toBe(3)
  })
  it('reads a weekday holding a single id and state without rotation or queue', () => {
    const snap = routineSnapshot({ routines: [{ id: 'b' }], week: { 3: 'b' } }, 'b')
    expect(snap).toMatchObject({ index: 0, week: { 3: 0 }, dayPlan: {}, seqAt: -1, queueAt: -1 })
  })
  it('is null for a routine that is not there', () => {
    expect(routineSnapshot(state(), 'zzz')).toBeNull()
    expect(routineSnapshot({}, 'a')).toBeNull()
  })
})

describe('restoreRoutine', () => {
  it('undoes deleteRoutine exactly', () => {
    const S = state()
    const before = structuredClone(S)
    const snap = routineSnapshot(S, 'a')
    deleteRoutine(S, 'a')
    // deleteRoutine leaves the loop and queue alone; a save in between may have dropped them.
    S.rotation.sequence = S.rotation.sequence.filter(id => id !== 'a')
    S.queue.ids = S.queue.ids.filter(id => id !== 'a')
    expect(restoreRoutine(S, snap)).toBe(true)
    expect(S).toEqual(before)
  })

  it('brings back a weekday the delete emptied', () => {
    const S = { routines: [{ id: 'a' }], week: { 2: ['a'] }, dayPlan: {} }
    const snap = routineSnapshot(S, 'a')
    deleteRoutine(S, 'a')
    expect(S.week).toEqual({})
    restoreRoutine(S, snap)
    expect(S.week).toEqual({ 2: ['a'] })
  })

  it('puts a pointer at the end of a list that got shorter since', () => {
    const S = state()
    const snap = routineSnapshot(S, 'a')
    deleteRoutine(S, 'a')
    S.routines = []
    S.week[5] = []
    restoreRoutine(S, snap)
    expect(S.routines.map(r => r.id)).toEqual(['a'])
    expect(S.week[5]).toEqual(['a'])
  })

  it('does not take over a date that was planned again in the meantime', () => {
    const S = state()
    const snap = routineSnapshot(S, 'a')
    deleteRoutine(S, 'a')
    S.dayPlan['2026-10-20'] = 'c'
    restoreRoutine(S, snap)
    expect(S.dayPlan['2026-10-20']).toBe('c')
  })

  it('does not add the id twice to a list that already has it', () => {
    const S = state()
    const snap = routineSnapshot(S, 'a')
    deleteRoutine(S, 'a')
    expect(S.rotation.sequence).toEqual(['c', 'a', 'b']) // untouched by the delete
    restoreRoutine(S, snap)
    expect(S.rotation.sequence).toEqual(['c', 'a', 'b'])
    expect(S.queue.ids).toEqual(['b', 'a'])
  })

  it('changes nothing when the routine already exists again (another device put it back)', () => {
    const S = state()
    const snap = routineSnapshot(S, 'a')
    const before = structuredClone(S)
    expect(restoreRoutine(S, snap)).toBe(false)
    expect(S).toEqual(before)
  })

  it('refuses a missing snapshot or a state without a routine list', () => {
    expect(restoreRoutine(state(), null)).toBe(false)
    expect(restoreRoutine({}, routineSnapshot(state(), 'a'))).toBe(false)
  })

  it('creates week and dayPlan on a state that lost them', () => {
    const snap = routineSnapshot(state(), 'a')
    const S = { routines: [] }
    expect(restoreRoutine(S, snap)).toBe(true)
    expect(S.week).toEqual({ 1: ['a'], 5: ['a'] })
    expect(S.dayPlan).toEqual({ '2026-10-20': 'a' })
    expect(S.rotation).toBeUndefined()
  })
})
