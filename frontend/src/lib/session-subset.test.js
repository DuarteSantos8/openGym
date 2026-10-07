// A shortened session builds through the same path as a full one, for a subset of
// exercises — same prescription, same plan stamp, same rid — so progression and history
// read it as the routine with fewer entries.
import { describe, it, expect } from 'vitest'
import { buildSubsetEntries } from './session-merge.js'
import { buildSessionEntries } from './session-start.js'

const st = {
  unit: 'kg', workouts: [], exWeights: {},
  routines: [
    { id: 'r1', name: 'Strength', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }, { id: '0031', sets: 3, reps: 8, weight: 40 }] },
    { id: 'rehab', name: 'Rehab', excludeFromProgression: true, ex: [{ id: '0050', sets: 2, reps: 15, weight: 5 }] },
  ],
}

describe('buildSubsetEntries', () => {
  it('builds the subset exactly as the full path builds those exercises, plus rid', () => {
    const { entries, routineIds, routines } = buildSubsetEntries(st, 'r1', ['0031'])
    const full = buildSessionEntries(st, st.routines[0]).filter(e => e.id === '0031')
      .map(e => ({ ...e, rid: 'r1' }))
    expect(entries).toEqual(full)
    expect(routineIds).toEqual(['r1'])
    expect(routines.map(r => r.id)).toEqual(['r1'])
  })

  it('keeps routine order and drops unknown ids', () => {
    const { entries } = buildSubsetEntries(st, 'r1', ['0031', 'gone', '0025'])
    expect(entries.map(e => e.id)).toEqual(['0025', '0031'])
  })

  it('carries an excluded routine’s noProg through the subset', () => {
    const { entries } = buildSubsetEntries(st, 'rehab', ['0050'])
    expect(entries).toMatchObject([{ id: '0050', rid: 'rehab', noProg: true }])
  })

  it('builds nothing for an unknown routine, an empty pick, or no overlap', () => {
    expect(buildSubsetEntries(st, 'gone', ['0025'])).toMatchObject({ entries: [], routineIds: [] })
    expect(buildSubsetEntries(st, 'r1', [])).toMatchObject({ entries: [], routineIds: [] })
    expect(buildSubsetEntries(st, 'r1', ['gone'])).toMatchObject({ entries: [], routineIds: [] })
  })

  it('applies the prescription to the subset like a full start would', () => {
    const history = {
      unit: 'kg', exWeights: {},
      routines: [{ id: 'r1', name: 'Strength', prog: 'linear', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }, { id: '0031', sets: 3, reps: 8, weight: 40 }] }],
      workouts: [{
        d: '2026-03-01', routineIds: ['r1'],
        entries: [
          { id: '0025', rid: 'r1', planned: { sets: 3, reps: 5, weight: 60 }, target: { sets: 3, reps: 5, weight: 60 }, sets: [5, 5, 5].map(r => ({ w: 60, r, done: true })) },
          { id: '0031', rid: 'r1', planned: { sets: 3, reps: 8, weight: 40 }, target: { sets: 3, reps: 8, weight: 40 }, sets: [8, 8, 8].map(r => ({ w: 40, r, done: true })) },
        ],
      }],
    }
    const { entries } = buildSubsetEntries(history, 'r1', ['0031'])
    expect(entries).toHaveLength(1)
    // The other exercise progressed in the background, but the subset only carries its own.
    expect(entries[0]).toMatchObject({ id: '0031', rid: 'r1', planned: { sets: 3, reps: 8, weight: 40 } })
    expect(entries[0].target.weight).toBe(42.5)
  })
})
