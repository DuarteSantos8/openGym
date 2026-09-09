import { describe, it, expect } from 'vitest'
import { copyRoutine } from './routines.js'

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
})
