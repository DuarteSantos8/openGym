import { describe, expect, it } from 'vitest'
import { workoutVolume, insertWarmupRow } from './history.js'

// The config sheet tells users warm-ups are "left out of volume, records and progression",
// and history.js repeats that as an invariant in a comment. Volume was the one place it
// was false — harmless while warm-ups were hand-added and rare, wrong now that a routine
// plans them by default and the number is written into the saved workout for good.
describe('warm-ups and volume', () => {
  // A warm-up the user actually checks off is logged with status 'completed', exactly like a
  // work set — status alone cannot tell them apart. Finish writes each row's `role`
  // (session-ui-adapter's performanceRow), and workoutVolume excludes rows whose role is
  // 'warmup', the same filter workSetsDone uses, so these fixtures are 'completed' throughout
  // and rely purely on the role to separate warm-up from work.
  const perfRow = (setId, value) =>
    ({ setId, role: setId.startsWith('w') ? 'warmup' : 'work', status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value }, segments: [] })
  const S = {}
  const w = {
    exposures: [{
      exerciseId: 'bench',
      performance: { sets: [
        perfRow('w1', 50),
        perfRow('w2', 75),
        perfRow('w3', 87.5),
        perfRow('s1', 100),
        perfRow('s2', 100),
        perfRow('s3', 100),
      ] },
    }],
  }

  it('counts only the work sets', () => {
    expect(workoutVolume(S, w)).toBe(1500)
  })

  it('a warm-up adds nothing, whatever it weighs', () => {
    const heavy = { exposures: [{ exerciseId: 'b', performance: { sets: [perfRow('w1', 200)] } }] }
    expect(workoutVolume(S, heavy)).toBe(0)
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
