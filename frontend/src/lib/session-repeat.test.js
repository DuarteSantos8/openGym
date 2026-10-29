import { describe, expect, it } from 'vitest'
import { repeatSessionExposures } from './session-repeat.js'
import { canonicalProfile, loggedExposure } from './test-fixtures.js'

const BENCH = '0025', ROW = '0027'
const sets = (...pairs) => pairs.map(([reps, load]) => ({
  role: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: reps }],
  resistance: { kind: 'external-load', value: load, unit: 'kg' },
}))
const workout = (...exposures) => ({ id: 'w1', d: '2026-09-01', name: 'Push', exposures })

describe('repeatSessionExposures (#58)', () => {
  it('seeds the new session from this workout, in its order, as freestyle exposures', () => {
    const w = workout(loggedExposure(BENCH, sets([8, 60], [6, 62.5])), loggedExposure(ROW, sets([10, 50])))
    const draft = canonicalProfile({ workouts: [w] })
    const { exposures, skipped } = repeatSessionExposures(draft, w, { now: 1 })
    expect(skipped).toBe(0)
    expect(exposures.map(x => x.exerciseId)).toEqual([BENCH, ROW])
    expect(exposures.every(x => x.routineId === undefined)).toBe(true)
    expect(Object.keys(draft.prescriptions)).toHaveLength(2)
  })

  it('leaves out an exercise that no longer exists, and does not touch the source', () => {
    const w = workout(loggedExposure(BENCH, sets([8, 60])), loggedExposure(ROW, sets([10, 50])))
    const before = structuredClone(w)
    const { exposures, skipped } = repeatSessionExposures(canonicalProfile(), w, { exists: id => id === BENCH })
    expect(exposures.map(x => x.exerciseId)).toEqual([BENCH])
    expect(skipped).toBe(1)
    expect(w).toEqual(before)
  })

  it('has nothing to repeat when no logged exercise exists any more', () => {
    const w = workout(loggedExposure(BENCH, sets([8, 60])))
    expect(repeatSessionExposures(canonicalProfile(), w, { exists: () => false })).toEqual({ exposures: [], skipped: 1 })
  })
})
