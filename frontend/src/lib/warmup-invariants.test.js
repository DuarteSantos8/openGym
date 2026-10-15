import { describe, expect, it } from 'vitest'
import { workoutVolume, insertWarmupRow, buildSets, applyIntensifierPlan } from './history.js'
import { applyPrescription } from './progression.js'
import { isSideSet } from './workout-model.js'

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

// A unilateral exercise warms up per side too (issue #60): the warm-up row is split into L/R
// like the work sets it ramps toward, each side its own reps/weight/effort and done tick —
// not one scalar row where "12 reps" is silently 6 per side and both sides share one RIR.
// insertWarmupRow is also the in-session "Add warm-up set" path, so this covers both.
describe('a unilateral warm-up is logged per side', () => {
  it('insertWarmupRow builds a side set, splitting the combined reps across L and R', () => {
    const rows = [{ w: 100, r: 12, done: false }]
    const out = insertWarmupRow(rows, 'reps', { reps: 12, side: true }, 2.5)
    expect(isSideSet(out[0])).toBe(true)
    expect(out[0].sides.L).toMatchObject({ w: 50, r: 6, done: false })
    expect(out[0].sides.R).toMatchObject({ w: 50, r: 6, done: false })
    // the warm-up markers survive makeSideSet, and the scalar mirror stays correct
    expect(out[0]).toMatchObject({ w: 50, r: 12, phase: 'warmup', warmup: true, done: false })
    // no single shared RIR on the row — effort is per side now
    expect(out[0].rir).toBeUndefined()
    expect(out[0].rpe).toBeUndefined()
  })

  it('leaves a straight (two-sided) exercise as a scalar warm-up row', () => {
    const out = insertWarmupRow([{ w: 100, r: 12, done: false }], 'reps', { reps: 12 }, 2.5)
    expect(isSideSet(out[0])).toBe(false)
    expect(out[0]).toMatchObject({ w: 50, r: 12, phase: 'warmup' })
  })

  it('does not split a timed hold or cardio warm-up', () => {
    // only reps-mode warm-ups are per side; a per-side flag on a timed hold must not split it
    expect(isSideSet(insertWarmupRow([{ sec: 45, w: 40 }], 'time', { sec: 45, side: true }, 2.5)[0])).toBe(false)
    expect(isSideSet(insertWarmupRow([{ min: 20, speed: 10 }], 'cardio', { min: 20, side: true }, 2.5)[0])).toBe(false)
  })

  it('buildSets prepends per-side warm-ups that ramp per side toward the work weight', () => {
    const S = { workouts: [], exWeights: {}, routines: [] }
    const cfg = { id: 'curl', mode: 'reps', sets: 2, reps: 16, weight: 100, warmupSets: 2, side: true }
    const rows = buildSets(S, cfg, { step: 2.5 })
    const warm = rows.filter(r => r.phase === 'warmup')
    expect(warm).toHaveLength(2)
    for (const row of warm) {
      expect(isSideSet(row)).toBe(true)
      // both sides share the same ramped weight (same bar, both limbs) and half the reps
      expect(row.sides.L.w).toBe(row.sides.R.w)
      expect(row.sides.L.r + row.sides.R.r).toBe(16)
    }
    // the ramp itself is unchanged by the split: 50% then 75% of the 100 work weight
    expect(warm.map(r => r.w)).toEqual([50, 75])
    // and the per-side work sets follow (every row is a side set)
    expect(rows.every(r => isSideSet(r))).toBe(true)
  })

  it('re-ramps a per-side warm-up on both sides, keeping the aggregate in step', () => {
    const S = { workouts: [], exWeights: {}, routines: [] }
    const cfg = { id: 'curl', mode: 'reps', sets: 2, reps: 16, weight: 100, warmupSets: 2, side: true }
    // a deload rewrites the work rows to 50; rerampWarmups (end of applyPrescription) must bring
    // the warm-ups down with it, on BOTH sides, or the L/R rows would disagree with the row's w.
    const rows = applyPrescription(buildSets(S, cfg, { step: 2.5 }), { kind: 'deload', weight: 50 })
    const warm = rows.filter(r => r.phase === 'warmup')
    for (const row of warm) {
      expect(row.sides.L.w).toBe(row.w)
      expect(row.sides.R.w).toBe(row.w)
      expect(row.w).toBeLessThanOrEqual(50)
    }
    expect(warm.map(r => r.w)).toEqual([25, 37.5])
  })
})

// Rest-pause builds its own two rows (one warm-up, one rest-pause work set). On a unilateral
// exercise the warm-up is per side too, the same as the work set below it.
describe('a unilateral rest-pause warm-up is per side', () => {
  it('splits the activation warm-up across L and R', () => {
    const sets = [{ w: 60, r: 8, done: false, sides: { L: { w: 60, r: 4, done: false }, R: { w: 60, r: 4, done: false } } }]
    const out = applyIntensifierPlan(sets, { reps: 8, side: true, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } })
    expect(out).toHaveLength(2)
    const warm = out[0]
    expect(warm.phase).toBe('warmup')
    expect(isSideSet(warm)).toBe(true)
    expect(warm.sides.L.r + warm.sides.R.r).toBe(8)
    expect(warm.sides.L.w).toBe(60)
    expect(warm.sides.R.w).toBe(60)
    // the work set stays per side with its bursts on each limb
    expect(isSideSet(out[1])).toBe(true)
    expect(out[1].type).toBe('restpause')
  })
})
