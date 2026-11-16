import { describe, it, expect } from 'vitest'
import { copyRoutine, deleteRoutine } from './routines.js'
import { ruleOccurrence } from './test-fixtures.js'

const routine = {
  id: 'r1',
  name: 'Push Day',
  emoji: 'arm',
  prog: 'linear',
  ex: [
    { id: 'ex1', sets: 3, reps: 10, weight: 60, sg: 'sg1' },
    { id: 'ex2', sets: 4, reps: 8, weight: 80, sg: 'sg1' },
    { id: 'ex3', sets: 3, reps: 12, weight: 20 }
  ]
}

describe('copyRoutine', () => {
  it('returns a new routine with a different id', () => {
    const copy = copyRoutine(routine)
    expect(copy.id).not.toBe(routine.id)
    expect(copy.id).toBeTruthy()
  })

  it('appends "(Copy)" to the name by default', () => {
    const copy = copyRoutine(routine)
    expect(copy.name).toBe('Push Day (Copy)')
  })

  it('uses a custom suffix when provided', () => {
    const copy = copyRoutine(routine, 'Kopie')
    expect(copy.name).toBe('Push Day (Kopie)')
  })

  it('deep-copies all exercises with their configuration', () => {
    const copy = copyRoutine(routine)
    expect(copy.ex).toHaveLength(3)
    expect(copy.ex[0]).toEqual(routine.ex[0])
    expect(copy.ex[1]).toEqual(routine.ex[1])
    expect(copy.ex[2]).toEqual(routine.ex[2])
  })

  it('preserves exercise ids (references to the global library)', () => {
    const copy = copyRoutine(routine)
    expect(copy.ex[0].id).toBe('ex1')
    expect(copy.ex[1].id).toBe('ex2')
    expect(copy.ex[2].id).toBe('ex3')
  })

  it('preserves superset groupings', () => {
    const copy = copyRoutine(routine)
    expect(copy.ex[0].sg).toBe('sg1')
    expect(copy.ex[1].sg).toBe('sg1')
    expect(copy.ex[2].sg).toBeUndefined()
  })

  it('preserves the emoji and progression settings', () => {
    const copy = copyRoutine(routine)
    expect(copy.emoji).toBe('arm')
    expect(copy.prog).toBe('linear')
  })

  it('produces an independent copy — mutating it does not affect the original', () => {
    const copy = copyRoutine(routine)
    copy.name = 'Modified'
    copy.ex[0].weight = 999
    copy.ex.push({ id: 'ex4', sets: 5, reps: 5 })

    expect(routine.name).toBe('Push Day')
    expect(routine.ex[0].weight).toBe(60)
    expect(routine.ex).toHaveLength(3)
  })

  it('handles a routine with no exercises', () => {
    const empty = { id: 'r2', name: 'Empty', emoji: 'dumbbell', ex: [] }
    const copy = copyRoutine(empty)
    expect(copy.ex).toEqual([])
    expect(copy.name).toBe('Empty (Copy)')
    expect(copy.id).not.toBe('r2')
  })
})

describe('copyRoutine of a copy', () => {
  it('numbers the copies instead of stacking suffixes', () => {
    const first = copyRoutine({ id: 'r', name: 'Push', ex: [] })
    expect(first.name).toBe('Push (Copy)')
    const second = copyRoutine(first)
    expect(second.name).toBe('Push (Copy 2)')
    expect(copyRoutine(second).name).toBe('Push (Copy 3)')
    expect(copyRoutine({ id: 'r', name: 'Push (Kopie)', ex: [] }, 'Kopie').name).toBe('Push (Kopie 2)')
  })

  it('gives each copied occurrence its own track and rule, owned by the copy', () => {
    const source = { id: 'r1', name: 'Push', ex: [ruleOccurrence('0025')] }
    const [occ] = copyRoutine(source).ex
    const copy = copyRoutine(source)
    expect(occ.occurrenceId).not.toBe('occ-0025')
    expect(occ.rule.id).not.toBe(source.ex[0].rule.id)
    expect(copy.ex[0].rule.routineId).toBe(copy.id)
    expect({ ...occ.rule, id: 0, routineId: 0 }).toEqual({ ...source.ex[0].rule, id: 0, routineId: 0 })
  })
})

describe('deleteRoutine', () => {
  const store = () => ({
    routines: [{ id: 'r1', name: 'Push', ex: [] }, { id: 'r2', name: 'Pull', ex: [] }],
    // Monday combines both, Wednesday is Pull alone, Friday a legacy scalar day.
    week: { 1: ['r1', 'r2'], 3: ['r2'], 5: 'r1' },
    dayPlan: { '2099-01-01': 'r2', '2099-01-02': 'r1', '2099-01-03': 'rest' }
  })

  it('removes the routine and pulls it from every day, dropping a day it leaves empty', () => {
    const s = store()
    deleteRoutine(s, 'r2')
    expect(s.routines.map(r => r.id)).toEqual(['r1'])
    expect(s.week[1]).toEqual(['r1'])
    expect(s.week[3]).toBeUndefined()
    expect(s.week[5]).toBe('r1')   // a day that never named it is left as it was
  })

  it('drops the reschedules naming it and returns them, leaving every other one', () => {
    const s = store()
    expect(deleteRoutine(s, 'r2')).toEqual({ '2099-01-01': 'r2' })
    expect(s.dayPlan).toEqual({ '2099-01-02': 'r1', '2099-01-03': 'rest' })
  })

  it('reads a legacy scalar day as a list of one', () => {
    const s = store()
    deleteRoutine(s, 'r1')
    expect(s.week[5]).toBeUndefined()
    expect(s.week[1]).toEqual(['r2'])
  })
})
