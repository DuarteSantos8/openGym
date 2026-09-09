import { describe, it, expect } from 'vitest'
import { buildCombinedEntries, deriveSessionName } from './session-merge.js'
import { buildSessionEntries } from './session-start.js'

const st = {
  unit: 'kg', workouts: [], exWeights: {},
  routines: [
    { id: 'r1', name: 'Strength', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }, { id: '0031', sets: 3, reps: 8, weight: 40 }] },
    { id: 'r2', name: 'Core', prog: 'off', ex: [{ id: '0047', sets: 3, reps: 12, weight: 0 }] },
    { id: 'rehab', name: 'Rehab', excludeFromProgression: true, ex: [{ id: '0050', sets: 2, reps: 15, weight: 5 }] },
  ],
}

describe('buildCombinedEntries', () => {
  it('concatenates each routine’s entries in list order, stamping rid on every one', () => {
    const { entries, routineIds } = buildCombinedEntries(st, ['r1', 'r2'])
    expect(entries.map(e => e.id)).toEqual(['0025', '0031', '0047'])
    expect(entries.map(e => e.rid)).toEqual(['r1', 'r1', 'r2'])
    expect(routineIds).toEqual(['r1', 'r2'])
  })

  it('de-dupes a repeated id (first wins) and drops an id with no matching routine', () => {
    const { entries, routineIds } = buildCombinedEntries(st, ['r1', 'gone', 'r1', 'r2'])
    expect(routineIds).toEqual(['r1', 'r2'])
    expect(entries.map(e => e.rid)).toEqual(['r1', 'r1', 'r2'])
  })

  it('an empty / null list builds nothing', () => {
    expect(buildCombinedEntries(st, [])).toMatchObject({ entries: [], routineIds: [], routines: [] })
    expect(buildCombinedEntries(st, null)).toMatchObject({ entries: [], routineIds: [] })
  })

  it('a single-element list matches the plain buildSessionEntries path (bar the rid stamp)', () => {
    const combined = buildCombinedEntries(st, ['r1']).entries.map(({ rid, ...e }) => e)
    expect(combined).toEqual(buildSessionEntries(st, st.routines[0]))
  })

  it('carries an excluded routine’s per-entry noProg through the merge', () => {
    const { entries } = buildCombinedEntries(st, ['r1', 'rehab'])
    expect(entries.find(e => e.id === '0050')).toMatchObject({ rid: 'rehab', noProg: true })
    expect(entries.find(e => e.id === '0025').noProg).toBeUndefined()
  })
})

describe('deriveSessionName', () => {
  it('is null for an empty list', () => {
    expect(deriveSessionName([])).toBe(null)
  })
  it('joins 1–3 names with " + "', () => {
    expect(deriveSessionName(['Rehab'])).toBe('Rehab')
    expect(deriveSessionName(['Rehab', 'Core'])).toBe('Rehab + Core')
    expect(deriveSessionName(['A', 'B', 'C'])).toBe('A + B + C')
  })
  it('collapses 4+ to "A + B + N more"', () => {
    expect(deriveSessionName(['A', 'B', 'C', 'D'])).toBe('A + B + 2 more')
    expect(deriveSessionName(['A', 'B', 'C', 'D', 'E'])).toBe('A + B + 3 more')
  })
})
