import { describe, it, expect } from 'vitest'
import { transferRoutineExercise } from './routines.js'

const slot = (id, extra = {}) => ({ id, sets: 3, mode: 'reps', reps: 8, weight: 60, ...extra })

describe('transferRoutineExercise', () => {
  it('copies a deep clone to the end of the target and leaves the source alone', () => {
    const routines = [
      { id: 'a', ex: [slot('bench', { note: 'pause', warmupSets: 2, prog: 'double', subs: ['0289'] })] },
      { id: 'b', ex: [slot('row')] },
    ]
    const out = transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'b', mode: 'copy' })
    expect(out.ok).toBe(true)
    expect(out.toIndex).toBe(1)
    expect(routines[0].ex).toHaveLength(1)
    expect(routines[1].ex).toEqual([
      slot('row'),
      { id: 'bench', sets: 3, mode: 'reps', reps: 8, weight: 60, note: 'pause', warmupSets: 2, prog: 'double', subs: ['0289'] },
    ])
    routines[1].ex[1].note = 'changed'
    expect(routines[0].ex[0].note).toBe('pause')
  })

  it('moves the slot out of the source and cleans up a leftover superset partner', () => {
    const routines = [
      { id: 'a', ex: [
        slot('bench', { sg: 'g1', sgName: 'Press', sgRest: 90 }),
        slot('fly', { sg: 'g1', sgName: 'Press', sgRest: 90 }),
        slot('curl'),
      ] },
      { id: 'b', ex: [] },
    ]
    const out = transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'b', mode: 'move' })
    expect(out.ok).toBe(true)
    expect(routines[0].ex.map(e => e.id)).toEqual(['fly', 'curl'])
    expect(routines[0].ex[0].sg).toBeUndefined()
    expect(routines[1].ex).toEqual([slot('bench')])
    expect(routines[1].ex[0].sg).toBeUndefined()
    expect(routines[1].ex[0].sgName).toBeUndefined()
    expect(routines[1].ex[0].sgRest).toBeUndefined()
  })

  it('keeps warm-ups, progression, rests and intensifiers on the transferred slot', () => {
    const rich = slot('squat', {
      prog: 'triple', inc: 2.5, deloadFactor: 0.9, restSec: 180, restOff: undefined,
      warmup: 'own', warmupRows: [{ weight: 40, reps: 5 }],
      intensifier: { type: 'dropset', count: 1, pct: 20 },
      sideRestSec: 10, autoHold: true,
    })
    const routines = [{ id: 'a', ex: [rich] }, { id: 'b', ex: [] }]
    transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'b', mode: 'copy' })
    expect(routines[1].ex[0]).toEqual(rich)
  })

  it('inserts at a chosen index in the target', () => {
    const routines = [
      { id: 'a', ex: [slot('bench')] },
      { id: 'b', ex: [slot('row'), slot('curl')] },
    ]
    const out = transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'b', mode: 'copy', at: 1 })
    expect(out.toIndex).toBe(1)
    expect(routines[1].ex.map(e => e.id)).toEqual(['row', 'bench', 'curl'])
  })

  it('allows a duplicate exercise id on the target', () => {
    const routines = [
      { id: 'a', ex: [slot('bench', { weight: 80 })] },
      { id: 'b', ex: [slot('bench', { weight: 40 })] },
    ]
    transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'b', mode: 'copy' })
    expect(routines[1].ex.map(e => e.weight)).toEqual([40, 80])
  })

  it('copy into the same routine appends a twin; move into the same one is refused', () => {
    const routines = [{ id: 'a', ex: [slot('bench')] }]
    expect(transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'a', mode: 'move' }))
      .toEqual({ ok: false, reason: 'same-routine' })
    expect(routines[0].ex).toHaveLength(1)
    expect(transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'a', mode: 'copy' }).ok).toBe(true)
    expect(routines[0].ex).toHaveLength(2)
    expect(routines[0].ex.map(e => e.id)).toEqual(['bench', 'bench'])
  })

  it('moving the last exercise leaves an empty source list', () => {
    const routines = [{ id: 'a', ex: [slot('bench')] }, { id: 'b', ex: [] }]
    transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'b', mode: 'move' })
    expect(routines[0].ex).toEqual([])
    expect(routines[1].ex).toEqual([slot('bench')])
  })

  it('refuses missing routines, a bad index and a bad mode', () => {
    const routines = [{ id: 'a', ex: [slot('bench')] }, { id: 'b', ex: [] }]
    expect(transferRoutineExercise(routines, { fromId: 'x', index: 0, toId: 'b', mode: 'move' }).reason).toBe('missing-from')
    expect(transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'x', mode: 'move' }).reason).toBe('missing-to')
    expect(transferRoutineExercise(routines, { fromId: 'a', index: 3, toId: 'b', mode: 'move' }).reason).toBe('bad-index')
    expect(transferRoutineExercise(routines, { fromId: 'a', index: 0, toId: 'b', mode: 'teleport' }).reason).toBe('bad-mode')
    expect(transferRoutineExercise(null, { fromId: 'a', index: 0, toId: 'b', mode: 'move' }).reason).toBe('bad-routines')
  })
})
