import { describe, it, expect } from 'vitest'
import { MUSCLES, MUSCLE_NAME, canonicalMuscle, muscleWeightsOf, musclesOf, muscleGroupsOf, matchesMuscleGroups, exerciseMuscleSnapshot, loadOf, slugWeight, expandSlug, GENERIC } from './muscles.js'
import { EXDB, EXIDX } from './exercises.js'
import { targetOf } from './muscle-targets.js'

// The shoulder in three heads and the lats on their own (#638, v1.4.5).
const byName = n => EXDB.find(e => e.n === n)

describe('the muscles the map draws', () => {
  it('has the three heads and the lats, and no whole shoulder of its own', () => {
    for (const m of ['front-delts', 'side-delts', 'rear-delts', 'lats', 'upper-back']) {
      expect(MUSCLES).toContain(m)
      expect(MUSCLE_NAME[m]).toBeTruthy()
    }
    expect(MUSCLES).not.toContain('deltoids')
    expect(MUSCLE_NAME.deltoids).toBe('Shoulders')
    expect(MUSCLE_NAME['upper-back']).toBe('Upper back')
  })

  it('reads every old spelling of the shoulder as the whole shoulder, and the heads as heads', () => {
    for (const w of ['shoulders', 'deltoids', 'delts']) expect(canonicalMuscle(w)).toBe('deltoids')
    expect(canonicalMuscle('front delts')).toBe('front-delts')
    expect(canonicalMuscle('side delts')).toBe('side-delts')
    expect(canonicalMuscle('rear deltoids')).toBe('rear-delts')
    expect(canonicalMuscle('lats')).toBe('lats')
    expect(canonicalMuscle('latissimus dorsi')).toBe('lats')
    expect(canonicalMuscle('upper back')).toBe('upper-back')
    expect(expandSlug('deltoids')).toEqual(Object.keys(GENERIC.deltoids))
  })
})

describe('the catalogue names the head', () => {
  it('a lateral raise trains the side, a face pull the rear, an overhead press the front and side', () => {
    const raise = EXDB.find(e => /^dumbbell lateral raise$/.test(e.n))
    expect(Object.keys(musclesOf(raise))).toContain('side-delts')
    const face = EXDB.find(e => /face pull/.test(e.n) && e.tg)
    expect(musclesOf(face)['rear-delts']).toBe(1)
    const press = EXDB.find(e => /^barbell (standing )?(overhead|military) press$/.test(e.n) && e.tg)
    const m = musclesOf(press)
    expect(m['front-delts']).toBe(1)
    expect(m['side-delts']).toBeGreaterThan(0)
  })

  it('a pull-up trains the lats, a row the lats and the upper back, a bench press the front delts', () => {
    const pull = EXIDX['0652']
    expect(musclesOf(pull).lats).toBe(1)
    expect(musclesOf(pull)['upper-back'] || 0).toBe(0)
    const row = EXIDX['0027']
    expect(musclesOf(row).lats).toBeGreaterThan(0)
    expect(musclesOf(row)['upper-back']).toBeGreaterThan(0)
    expect(musclesOf(row)['rear-delts']).toBeGreaterThan(0)
    expect(musclesOf(EXIDX['0025'])['front-delts']).toBeGreaterThan(0)
  })

  it('no built-in exercise is left with the whole shoulder or the old back', () => {
    for (const e of EXDB) {
      if (!e.tg) continue
      expect(['delts']).not.toContain(e.tg)
      const w = muscleWeightsOf(EXIDX[e.id] || e)
      expect(w.deltoids).toBeUndefined()
    }
  })
})

describe('data from before the split still counts', () => {
  it('a custom exercise tagged "Shoulders" trains all three heads, the front most', () => {
    const ex = { id: 'c1', custom: true, n: 'My press', bp: 'shoulders', primaries: ['deltoids'], secondaries: ['triceps'] }
    const w = muscleWeightsOf(ex)
    expect(w['front-delts']).toBe(1)
    expect(w['side-delts']).toBeGreaterThan(0)
    expect(w['rear-delts']).toBeGreaterThan(0)
    expect(w['side-delts']).toBeLessThan(1)
    expect(muscleGroupsOf(ex)).toContain('deltoids')
    // It is found under every head, and every head's exercises under "Shoulders".
    expect(matchesMuscleGroups(ex, 'rear-delts')).toBe(true)
    expect(matchesMuscleGroups({ id: 'c2', custom: true, n: 'x', primaries: ['side-delts'] }, 'deltoids')).toBe(true)
    expect(slugWeight(w, 'deltoids')).toBe(1)
  })

  it('an old "Lats & upper back" custom exercise is both halves until it is saved again', () => {
    const old = { id: 'c3', custom: true, n: 'Row', primaries: ['upper-back'] }
    expect(muscleWeightsOf(old)).toMatchObject({ lats: 1, 'upper-back': 1 })
    expect(muscleGroupsOf(old)).toEqual(['lats', 'upper-back'])
    const saved = { ...old, mv: 2 }
    expect(muscleWeightsOf(saved)).toEqual({ 'upper-back': 1 })
  })

  it('an old history snapshot keeps its shoulders and back', () => {
    const entry = { id: 'gone', sets: [{ done: true }, { done: true }], muscleSnapshot: { n: 'Old', muscleWeights: { deltoids: 1, 'upper-back': 0.4 } } }
    const load = loadOf([{ id: 'gone', ex: entry, sets: 2 }])
    expect(load['front-delts']).toBe(2)
    expect(load.lats).toBeCloseTo(0.8)
    expect(load['upper-back']).toBeCloseTo(0.8)
  })

  it('a new snapshot says which model it is, and reads back the same', () => {
    const ex = { id: 'c4', custom: true, n: 'Raise', primaries: ['side-delts'], secondaries: ['upper-back'] }
    const snap = exerciseMuscleSnapshot(ex)
    expect(snap.mv).toBe(2)
    expect(muscleWeightsOf({ muscleSnapshot: snap })).toEqual(muscleWeightsOf(ex))
    expect(exerciseMuscleSnapshot({})).toEqual({})
  })

  it('a weekly range set for "Shoulders" or "Lats & upper back" carries over to the heads and the lats', () => {
    const S = { muscleTargets: { deltoids: [10, 14], 'upper-back': [12, 18] } }
    expect(targetOf(S, 'side-delts')).toEqual([10, 14])
    expect(targetOf(S, 'rear-delts')).toEqual([10, 14])
    expect(targetOf(S, 'lats')).toEqual([12, 18])
    expect(targetOf({ muscleTargets: { deltoids: [10, 14], 'side-delts': [6, 8] } }, 'side-delts')).toEqual([6, 8])
    expect(targetOf({}, 'front-delts')).toEqual([4, 12])
  })
})
