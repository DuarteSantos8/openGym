import { describe, it, expect } from 'vitest'
import { lastDoneOf, sessionPickerRows } from './session-picker.js'

const st = {
  routines: [
    { id: 'push', name: 'Push', ex: [{ id: 'a' }, { id: 'b' }] },
    { id: 'pull', name: 'Pull', ex: [{ id: 'c' }] },
    { id: 'legs', name: 'Legs', ex: [] },
  ],
  workouts: [
    { d: '2026-11-02', routineIds: ['push'] },
    { d: '2026-11-06', routineIds: ['push', 'pull'] },
    { d: '2026-10-30', routineId: 'pull' },
  ],
}

describe('session picker', () => {
  it('finds the last day a routine was done, old single-routine workouts included', () => {
    expect(lastDoneOf(st.workouts, 'push')).toBe('2026-11-06')
    expect(lastDoneOf(st.workouts, 'pull')).toBe('2026-11-06')
    expect(lastDoneOf(st.workouts, 'legs')).toBeNull()
    expect(lastDoneOf(undefined, 'legs')).toBeNull()
  })

  it('puts today first and does not list a single suggested routine twice', () => {
    const { today, routines } = sessionPickerRows(st, ['push'])
    expect(today.ids).toEqual(['push'])
    expect(today.exN).toBe(2)
    expect(routines.map(r => r.id)).toEqual(['pull', 'legs'])
    expect(routines[0]).toMatchObject({ name: 'Pull', exN: 1, last: '2026-11-06' })
  })

  it('a combined day is one row on top, and each of its routines stays pickable on its own', () => {
    const { today, routines } = sessionPickerRows(st, ['push', 'pull'])
    expect(today.ids).toEqual(['push', 'pull'])
    expect(today.exN).toBe(3)
    expect(routines.map(r => r.id)).toEqual(['push', 'pull', 'legs'])
  })

  it('no suggestion, or one that no longer exists: no today row, every routine listed', () => {
    for (const s of [[], null, ['gone']]) {
      const { today, routines } = sessionPickerRows(st, s)
      expect(today).toBeNull()
      expect(routines).toHaveLength(3)
    }
  })
})
