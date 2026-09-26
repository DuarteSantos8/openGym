import { describe, expect, it } from 'vitest'
import { buildSessionExposures } from './session-start.js'
import { buildCombinedExposures, deriveSessionName } from './session-merge.js'
import { ruleOccurrence } from './test-fixtures.js'

const state = () => ({ unit: 'kg', prescriptions: {}, oneRepMaxes: {}, progression: {}, workouts: [], routines: [
  { id: 'r1', name: 'Strength', ex: [ruleOccurrence('bench', { occurrenceId: 'o1' })] },
  { id: 'r2', name: 'Core', ex: [ruleOccurrence('row', { occurrenceId: 'o2', routineId: 'r2' })] }
] })
const ctx = { now: 1, newId: seed => seed, unit: 'kg' }

describe('buildCombinedExposures', () => {
  it('concatenates canonical exposures and stamps each routine id', () => {
    const s = state()
    const out = buildCombinedExposures(s, ['r1', 'r2'], ctx)
    expect(out.routineIds).toEqual(['r1', 'r2'])
    expect(out.exposures.map(x => [x.exerciseId, x.routineId])).toEqual([['bench', 'r1'], ['row', 'r2']])
    expect(out.exposures.every(x => s.prescriptions[x.prescriptionId])).toBe(true)
  })
  it('de-dupes missing or repeated routine ids', () => {
    expect(buildCombinedExposures(state(), ['r1', 'gone', 'r1'], ctx).routineIds).toEqual(['r1'])
  })
  it('matches the per-routine builder', () => {
    const expectedState = state()
    const expected = expectedState.routines.flatMap(r => buildSessionExposures(expectedState, r, ctx))
    expect(buildCombinedExposures(state(), ['r1', 'r2'], ctx).exposures).toEqual(expected)
  })
})

describe('deriveSessionName', () => {
  it('joins up to three names and abbreviates later ones', () => {
    expect(deriveSessionName(['A', 'B'])).toBe('A + B')
    expect(deriveSessionName(['A', 'B', 'C', 'D'])).toBe('A + B + 2 more')
  })
})
