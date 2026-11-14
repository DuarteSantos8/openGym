import { describe, expect, it } from 'vitest'
import { routineAdditions, addToRoutine } from './session-routines.js'

// #592: exercises added in the middle of a routine's session, offered to that routine at the finish.
const routine = { id: 'r1', name: 'Push A', prog: 'double', ex: [{ id: '0025', sets: 3, reps: 8, weight: 60 }] }
const entry = (id, extra = {}) => ({ id, rid: 'r1', target: { sets: 3, reps: 10, weight: 0 }, sets: [{ w: 12, r: 10, done: true }, { w: 12, r: 10, done: true }], ...extra })
const active = entries => ({ id: 'a', routineIds: ['r1'], entries })

describe('routineAdditions', () => {
  it('lists an exercise added in the session, with the setup it was done with', () => {
    const [a] = routineAdditions(active([entry('0025'), entry('0334', { addedInSession: true })]), [routine])
    expect(a).toMatchObject({ routineId: 'r1', name: 'Push A' })
    expect(a.ex).toEqual([expect.objectContaining({ id: '0334', sets: 2, reps: 10, weight: 12, prog: 'double' })])
    // Nothing that only described today's session rides into the routine.
    expect(a.ex[0].rid).toBeUndefined()
    expect(a.ex[0].addedInSession).toBeUndefined()
  })

  it('leaves out planned exercises, swaps, ones the routine has, skipped ones and freestyle', () => {
    const entries = [
      entry('0025'),                                                    // planned
      entry('0294'),                                                    // swapped in: no marker
      entry('0025', { addedInSession: true }),                          // a second bench: routine has it
      entry('0334', { addedInSession: true, sets: [{ w: 10, r: 10 }] }),  // never ticked
      { ...entry('0586', { addedInSession: true }), rid: undefined },   // freestyle
    ]
    expect(routineAdditions(active(entries), [routine])).toEqual([])
    expect(routineAdditions(active([entry('0334', { addedInSession: true })]), [])).toEqual([])
  })

  it('keeps a superset of two added exercises together and groups a combined day per routine', () => {
    const r2 = { id: 'r2', name: 'Pull', ex: [] }
    const list = routineAdditions(active([
      entry('0334', { addedInSession: true, sg: 'x' }), entry('0294', { addedInSession: true, sg: 'x' }),
      { ...entry('0586', { addedInSession: true }), rid: 'r2' },
    ]), [routine, r2])
    expect(list.map(a => a.routineId)).toEqual(['r1', 'r2'])
    const [a, b] = list[0].ex
    expect(a.sg).toBeTruthy()
    expect(a.sg).toBe(b.sg)
    expect(a.sg).not.toBe('x')
  })
})

describe('addToRoutine', () => {
  it('appends the copies and skips what the routine has by now', () => {
    const r = structuredClone(routine)
    const [a] = routineAdditions(active([entry('0334', { addedInSession: true })]), [r])
    expect(addToRoutine(r, a.ex)).toBe(1)
    expect(r.ex.map(x => x.id)).toEqual(['0025', '0334'])
    expect(addToRoutine(r, a.ex)).toBe(0)
    expect(r.ex).toHaveLength(2)
    expect(addToRoutine(null, a.ex)).toBe(0)
  })
})
