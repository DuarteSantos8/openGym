import { describe, it, expect } from 'vitest'
import { entryToAdd } from './session-add.js'

const base = (extra = {}) => ({
  active: { id: 'a', d: '2026-11-22', start: 0, entries: [{ id: '0025', rid: extra.rid }], cur: 0 },
  routines: extra.routines || [],
  sessions: [],
  profile: {},
  ...extra.S,
})

describe('entryToAdd', () => {
  it('builds a freestyle entry for the id when the current entry has no routine', () => {
    const S = base()
    const e = entryToAdd(S, '0150', S.active.entries[0])
    expect(e.id).toBe('0150')
    expect(e.rid).toBeUndefined()
    expect(e.addedInSession).toBeUndefined()
  })

  it('carries the routine and addedInSession when the current entry belongs to one', () => {
    const routines = [{ id: 'r1', name: 'Push', items: [{ id: '0025', sets: 3, reps: 8 }] }]
    const S = base({ rid: 'r1', routines })
    const e = entryToAdd(S, '0150', S.active.entries[0])
    expect(e.id).toBe('0150')
    expect(e.rid).toBe('r1')
    expect(e.addedInSession).toBe(true)
  })
})
