// What the Coach's mid-workout changes would mean for the routine (lib/coach-adapt-routine.js):
// offered in the Coach's change-set shape, applied and undone with the ordinary engine.
import { describe, expect, it } from 'vitest'
import { applyAdapt } from './coach-adapt.js'
import { routineChangesFor, sessionBefore } from './coach-adapt-routine.js'
import { applyChangeSet, revertLast } from './coach.js'

const BENCH = '0025', CURL = '0294', SQUAT = '0043', DBPRESS = '0289', ROW = '0027'
const row = (w, r, done = false) => ({ w, r, done })
const routine = () => ({ id: 'push', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 80 }, { id: CURL, sets: 3, reps: 10, weight: 14 }, { id: SQUAT, sets: 3, reps: 5, weight: 100 }] })
const session = (entries, routines = [routine()]) => ({
  unit: 'kg', exWeights: {}, workouts: [], week: {}, dayPlan: {}, routines,
  active: { id: 'act-1', d: '2026-10-29', cur: 0, entries },
  coach: { consent: { agreedAt: 1, version: 2 }, log: [], snapshots: [], lastReview: { at: 1 } },
})
const inOrder = () => [
  { id: BENCH, rid: 'push', target: { sets: 3, reps: 5, weight: 80 }, sets: [row(80, 5, true), row(80, 5), row(80, 5)] },
  { id: CURL, rid: 'push', target: { sets: 3, reps: 10, weight: 14 }, sets: [row(14, 10), row(14, 10), row(14, 10)] },
  { id: SQUAT, rid: 'push', target: { sets: 3, reps: 5, weight: 100 }, sets: [row(100, 5), row(100, 5), row(100, 5)] },
]
const proposal = changes => ({ id: 'p1', kind: 'adapt', activeId: 'act-1', summary: 'For today.', changes: changes.map((c, i) => ({ id: 'a' + i, why: 'Because.', ...c })) })
const run = (S, p) => {
  const before = sessionBefore(S.active)
  const { applied } = applyAdapt(S, p, p.changes.map(c => c.id))
  return routineChangesFor(p.changes.filter(c => applied.includes(c.id)), S.routines, before, S.active)
}

describe('routine changes offered after the Coach changed the workout', () => {
  it('offers swaps, order and additions in the Coach change-set shape, and nothing for today-only work', () => {
    const S = session(inOrder())
    const p = proposal([
      { type: 'swap', entry: 2, exId: SQUAT, to: ROW },
      { type: 'sets', entry: 0, exId: BENCH, sets: 1 },
      { type: 'move', entry: 1, exId: CURL, place: 'last' },
      { type: 'add', to: DBPRESS, sets: 2, reps: 12, entry: 0 },
      { type: 'rest', entry: 1, exId: CURL, rest: 180 },
    ])
    const changes = run(S, p)
    const ids = S.active.entries.map(e => e.id)
    expect(new Set(ids)).toEqual(new Set([BENCH, DBPRESS, ROW, CURL]))
    expect(ids.at(-1)).toBe(CURL)
    expect(changes.map(c => [c.type, c.after])).toEqual([
      ['reorder', [BENCH, SQUAT, CURL]],
      ['swap-exercise', { id: ROW }],
      ['add-exercise', { id: DBPRESS, sets: 2, mode: 'reps', reps: 12, position: 3 }],
    ])
    expect(changes[1].target).toEqual({ routineId: 'push', exId: SQUAT })

    applyChangeSet(S, { id: 'p1', summary: '', changes }, changes.map(c => c.id))
    expect(S.routines[0].ex.map(e => [e.id, e.sets, e.reps])).toEqual([[BENCH, 3, 5], [ROW, 3, 5], [CURL, 3, 10], [DBPRESS, 2, 12]])
    expect(revertLast(S)).toBe(true)
    expect(S.routines[0]).toEqual(routine())
  })

  it('offers no swap that changes how the slot is logged, and no reorder of a session already out of routine order', () => {
    const S = session([inOrder()[1], inOrder()[0], inOrder()[2]])
    S.routines[0].ex[1] = { id: CURL, sets: 3, mode: 'time', sec: 40 }
    const p = proposal([{ type: 'swap', entry: 0, exId: CURL, to: ROW, reps: 10 }, { type: 'move', entry: 2, exId: SQUAT, place: 'next' }])
    expect(run(S, p)).toEqual([])
  })

  it('offers nothing for an exercise the routine does not have, or a session with no routine behind it', () => {
    const S = session([{ id: DBPRESS, target: { sets: 2, reps: 10, weight: 20 }, sets: [row(20, 10), row(20, 10)] }])
    expect(run(S, proposal([{ type: 'swap', entry: 0, exId: DBPRESS, to: ROW }]))).toEqual([])
    const T = session(inOrder())
    T.active.entries[1].id = ROW   // the session moved off the routine already
    expect(run(T, proposal([{ type: 'swap', entry: 1, exId: ROW, to: DBPRESS }]))).toEqual([])
  })

  it('an exercise swapped while under way keeps the session out of the order offer, but the swap is still offered', () => {
    const S = session(inOrder())
    S.active.entries[1].sets[0].done = true
    const changes = run(S, proposal([{ type: 'swap', entry: 1, exId: CURL, to: ROW }, { type: 'move', entry: 2, exId: SQUAT, place: 'next' }]))
    expect(changes.map(c => c.type)).toEqual(['swap-exercise'])
  })
})
