import { describe, expect, it } from 'vitest'
import { workoutVolume, insertWarmupRow, buildSets } from './history.js'
import { applyPrescription } from './progression.js'

// The config sheet tells users warm-ups are "left out of volume, records and progression",
// and history.js repeats that as an invariant in a comment. Volume was the one place it
// was false — harmless while warm-ups were hand-added and rare, wrong now that a routine
// plans them by default and the number is written into the saved workout for good.
describe('warm-ups and volume', () => {
  const w = {
    entries: [{
      id: 'bench',
      sets: [
        { w: 50, r: 5, done: true, phase: 'warmup', warmup: true },
        { w: 75, r: 5, done: true, phase: 'warmup', warmup: true },
        { w: 87.5, r: 5, done: true, phase: 'warmup', warmup: true },
        { w: 100, r: 5, done: true },
        { w: 100, r: 5, done: true },
        { w: 100, r: 5, done: true },
      ],
    }],
  }

  it('counts only the work sets', () => {
    expect(workoutVolume(w)).toBe(1500)
  })

  it('a warm-up adds nothing, whatever it weighs', () => {
    const heavy = { entries: [{ id: 'b', sets: [{ w: 200, r: 10, done: true, phase: 'warmup', warmup: true }] }] }
    expect(workoutVolume(heavy)).toBe(0)
  })
})

// A warm-up must never be heavier than the set it warms you up for. The ramp branch clamps
// to the work weight; the early-return branch did not, so a hand-edited warm-up above the
// work weight propagated into every warm-up added after it.
describe('a warm-up never outweighs the work set', () => {
  // The 120 is something the user typed, and it stays: silently rewriting their own edit
  // would be worse than leaving it. What must not happen is the NEW row inheriting it, which
  // is how one bad number used to spread through the whole warm-up block.
  it('does not copy a hand-edited warm-up that sits above the work weight', () => {
    const rows = [{ warmup: true, phase: 'warmup', w: 120, r: 5 }, { w: 100, r: 5 }]
    const out = insertWarmupRow(rows, 'reps', { reps: 5 }, 2.5)
    expect(out.map(r => r.w)).toEqual([120, 100, 100])
    expect(out[1].phase).toBe('warmup')
  })

  it('still ramps normally when the previous warm-up is below the work weight', () => {
    const rows = [{ warmup: true, phase: 'warmup', w: 50, r: 5 }, { w: 100, r: 5 }]
    const out = insertWarmupRow(rows, 'reps', { reps: 5 }, 2.5)
    expect(out.filter(r => r.phase === 'warmup').map(r => r.w)).toEqual([50, 75])
  })
})

// buildSets prepends the warm-ups, then applyPrescription rewrites the WORK rows only — so a
// ramp built against last session's weight is stale the moment progression moves. On a deload
// that put the last warm-up above every work set.
describe('the ramp follows the prescribed weight', () => {
  const S = { workouts: [], exWeights: {}, routines: [] }
  const cfg = { id: 'bench', sets: 3, reps: 5, weight: 100, warmupSets: 2 }

  it('re-ramps after a deload instead of aiming at the old weight', () => {
    const rows = applyPrescription(buildSets(S, cfg, { step: 2.5 }), { kind: 'deload', weight: 50 })
    const warm = rows.filter(r => r.phase === 'warmup').map(r => r.w)
    const work = rows.filter(r => r.phase !== 'warmup').map(r => r.w)
    expect(work).toEqual([50, 50, 50])
    for (const x of warm) expect(x).toBeLessThanOrEqual(50)
    expect(warm).toEqual([25, 37.5])
  })

  it('re-ramps after a bump', () => {
    const rows = applyPrescription(buildSets(S, cfg, { step: 2.5 }), { kind: 'up', weight: 150 })
    expect(rows.filter(r => r.phase !== 'warmup').map(r => r.w)).toEqual([150, 150, 150])
    expect(rows.filter(r => r.phase === 'warmup').map(r => r.w)).toEqual([75, 112.5])
  })
})
