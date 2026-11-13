import { describe, expect, it } from 'vitest'
import { leftoversOf, leftoversBefore, leadEntries, LEFTOVER_DAYS } from './leftovers.js'

const TODAY = '2026-11-06'
const base = (over = {}) => ({
  unit: 'kg',
  routines: [
    { id: 'legs', name: 'Legs', ex: [{ id: '0043', sets: 3, reps: 5 }, { id: '0032', sets: 3, reps: 8 }, { id: '0585', sets: 2, reps: 12 }] },
    { id: 'core', name: 'Core', ex: [{ id: '0001', sets: 2, reps: 15 }] },
  ],
  workouts: [{ id: 'w1', d: '2026-11-05', start: 100, routineIds: ['legs', 'core'], entries: [{ id: '0043', rid: 'legs', sets: [{ done: true, w: 100, r: 5 }] }] }],
  ...over,
})

describe('leftovers', () => {
  it('lists what the last planned session did not get to, per routine, in order', () => {
    expect(leftoversOf(base(), TODAY)).toEqual({ key: 'w1', d: '2026-11-05', routines: [{ id: 'legs', name: 'Legs' }, { id: 'core', name: 'Core' }],
      ex: [{ rid: 'legs', id: '0032' }, { rid: 'legs', id: '0585' }, { rid: 'core', id: '0001' }] })
  })
  it('nothing when the session was complete, freestyle, answered, too old or its routine is gone', () => {
    const all = base(); all.workouts[0].entries = ['0043', '0032', '0585', '0001'].map(id => ({ id, sets: [] }))
    expect(leftoversOf(all, TODAY)).toBeNull()
    expect(leftoversOf(base({ workouts: [{ id: 'f', d: '2026-11-05', routineIds: [], entries: [] }] }), TODAY)).toBeNull()
    expect(leftoversOf(base({ leftoverSeen: 'w1' }), TODAY)).toBeNull()
    expect(leftoversOf(base(), '2026-11-' + String(5 + LEFTOVER_DAYS + 1).padStart(2, '0'))).toBeNull()
    expect(leftoversOf(base({ routines: [] }), TODAY)).toBeNull()
    const marked = base(); marked.workouts[0].entries = []
    expect(leftoversOf(marked, TODAY)).toBeNull()                 // ticked off as done, nothing logged
  })
  it('reads the newest workout only: a later session supersedes the early finish', () => {
    const S = base(); S.workouts.push({ id: 'w2', d: '2026-11-06', start: 5, routineIds: [], entries: [] })
    expect(leftoversOf(S, TODAY)).toBeNull()
    expect(leftoversOf(S, '2026-11-05').key).toBe('w1')          // a workout dated after "today" is not looked at
  })
  it('leaves out the routines the session about to start holds anyway', () => {
    expect(leftoversBefore(base(), TODAY, ['core']).ex).toEqual([{ rid: 'legs', id: '0032' }, { rid: 'legs', id: '0585' }])
    expect(leftoversBefore(base(), TODAY, ['core']).routines).toEqual([{ id: 'legs', name: 'Legs' }])
    expect(leftoversBefore(base(), TODAY, ['legs', 'core'])).toBeNull()
  })
  it('builds their session entries like Start does, stamped with their routine', () => {
    const S = base()
    const es = leadEntries(S, leftoversOf(S, TODAY))
    expect(es.map(e => [e.id, e.rid, e.sets.length])).toEqual([['0032', 'legs', 3], ['0585', 'legs', 2], ['0001', 'core', 2]])
    expect(leadEntries(S, null)).toEqual([])
  })
})
