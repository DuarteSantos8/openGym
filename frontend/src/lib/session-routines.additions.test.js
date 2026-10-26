import { describe, expect, it } from 'vitest'
import { routineAdditions, addToRoutine } from './session-routines.js'
import { loggedExposure, ruleOccurrence } from './test-fixtures.js'
import { planPhase } from './prescription/index.js'

// #592: exercises added in the middle of a routine's session, offered to that routine at the finish.
const routine = { id: 'r1', name: 'Push A', ex: [ruleOccurrence('0025', { routineId: 'r1' })] }
const exposure = (id, extra = {}, rows = [{ r: 10, w: 12 }, { r: 10, w: 12 }]) =>
  ({ ...loggedExposure(id, rows, { exposureId: 'x-' + id + (extra.sg || '') }), routineId: 'r1', ...extra })
const active = exposures => ({ id: 'a', routineIds: ['r1'], exposures })

describe('routineAdditions', () => {
  it('lists an exercise added in the session, with the setup it was done with', () => {
    const [a] = routineAdditions(active([exposure('0025'), exposure('0334', { addedInSession: true })]), [routine])
    expect(a).toMatchObject({ routineId: 'r1', name: 'Push A' })
    expect(a.ex).toHaveLength(1)
    expect(a.ex[0].exerciseId).toBe('0334')
    const p = planPhase(a.ex[0].rule).parameters
    expect([p.sets.min, p.reps.min, p.load.value]).toEqual([2, 10, 12])
    // Nothing that only described today's session rides into the routine.
    expect(a.ex[0].addedInSession).toBeUndefined()
  })

  it('leaves out planned exercises, swaps, ones the routine has, skipped ones and freestyle', () => {
    const exposures = [
      exposure('0025'),                                                           // planned
      exposure('0294'),                                                           // swapped in: no marker
      exposure('0025', { addedInSession: true }),                                 // a second bench: routine has it
      exposure('0334', { addedInSession: true }, [{ r: 10, w: 10, done: false }]),  // never ticked
      { ...exposure('0586', { addedInSession: true }), routineId: undefined },    // freestyle
    ]
    expect(routineAdditions(active(exposures), [routine])).toEqual([])
    expect(routineAdditions(active([exposure('0334', { addedInSession: true })]), [])).toEqual([])
  })

  it('keeps a superset of two added exercises together and groups a combined day per routine', () => {
    const r2 = { id: 'r2', name: 'Pull', ex: [] }
    const list = routineAdditions(active([
      exposure('0334', { addedInSession: true, sg: 'x' }), exposure('0294', { addedInSession: true, sg: 'x' }),
      exposure('0586', { addedInSession: true, routineId: 'r2' }),
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
    const [a] = routineAdditions(active([exposure('0334', { addedInSession: true })]), [r])
    expect(addToRoutine(r, a.ex)).toBe(1)
    expect(r.ex[1].rule.routineId).toBe('r1')
    expect(r.ex.map(x => x.exerciseId)).toEqual(['0025', '0334'])
    expect(addToRoutine(r, a.ex)).toBe(0)
    expect(r.ex).toHaveLength(2)
    expect(addToRoutine(null, a.ex)).toBe(0)
  })
})
