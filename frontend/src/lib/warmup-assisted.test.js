import { describe, expect, it } from 'vitest'
import { buildSets, insertWarmupRow } from './history.js'
import { applyPrescription } from './progression.js'
import { isAssisted } from './exercises.js'

// On an assistance machine the weight is the help the stack gives: less is harder. A warm-up
// must therefore carry MORE help than the work set, ramping down toward it, the mirror of the
// 50% / 75% / 87.5% ramp of a plain lift. Before this the same halving ran on the raw number,
// so 30 of help warmed up at 15 then 22.5: harder than the set it was meant to prepare for.
describe('an assisted warm-up carries more help than the work set', () => {
  const S = { workouts: [], exWeights: {}, routines: [] }
  const cfg = { id: 'x-assisted', assisted: true, sets: 3, reps: 8, weight: 30 }
  const warmOf = rows => rows.filter(r => r.phase === 'warmup').map(r => r.w)
  const workOf = rows => rows.filter(r => r.phase !== 'warmup').map(r => r.w)

  it('the flag is what marks it (the catalogue marks the machines by name)', () => {
    expect(isAssisted(cfg)).toBe(true)
  })

  it('ramps down toward the work help: 45, 37.5, 35 for 30', () => {
    const rows = buildSets(S, { ...cfg, warmupSets: 3 }, { step: 2.5 })
    expect(workOf(rows)).toEqual([30, 30, 30])
    expect(warmOf(rows)).toEqual([45, 37.5, 35])
  })

  it('is the plain ramp when the exercise is not assisted', () => {
    const rows = buildSets(S, { ...cfg, assisted: false, warmupSets: 2 }, { step: 2.5 })
    expect(warmOf(rows)).toEqual([15, 22.5])
  })

  it('never has less help than the work set, whatever the step', () => {
    for (const step of [1, 2.5, 5, 10]) {
      const rows = buildSets(S, { ...cfg, warmupSets: 5 }, { step })
      for (const w of warmOf(rows)) expect(w).toBeGreaterThanOrEqual(30)
      // and each rung is no more help than the one before it
      const warm = warmOf(rows)
      for (let i = 1; i < warm.length; i++) expect(warm[i]).toBeLessThanOrEqual(warm[i - 1])
    }
  })

  it('"Add warm-up set" in a session ramps the same way', () => {
    let rows = [{ w: 30, r: 8, done: false }]
    rows = insertWarmupRow(rows, 'reps', cfg, 2.5)
    rows = insertWarmupRow(rows, 'reps', cfg, 2.5)
    expect(warmOf(rows)).toEqual([45, 37.5])
  })

  it('does not copy a hand-edited warm-up that has less help than the work set', () => {
    const rows = [{ phase: 'warmup', warmup: true, w: 20, r: 8 }, { w: 30, r: 8 }]
    const out = insertWarmupRow(rows, 'reps', cfg, 2.5)
    expect(warmOf(out)).toEqual([20, 30])
  })

  it('has nothing to ramp when the work set has no help at all', () => {
    const rows = buildSets(S, { ...cfg, weight: 0, warmupSets: 2 }, { step: 2.5 })
    expect(warmOf(rows)).toEqual([0, 0])
  })

  it('re-ramps after progression takes help away (less help)', () => {
    const rows = applyPrescription(buildSets(S, { ...cfg, warmupSets: 2 }, { step: 2.5 }), { kind: 'up', weight: 20 }, 2.5, 0, true)
    expect(workOf(rows)).toEqual([20, 20, 20])
    expect(warmOf(rows)).toEqual([30, 25])
  })

  it('re-ramps after a deload gives more help', () => {
    const rows = applyPrescription(buildSets(S, { ...cfg, warmupSets: 2 }, { step: 2.5 }), { kind: 'deload', weight: 40 }, 2.5, 0, true)
    expect(workOf(rows)).toEqual([40, 40, 40])
    expect(warmOf(rows)).toEqual([60, 50])
  })

  it('keeps a warm-up already logged and ramps the rest from it', () => {
    const base = buildSets(S, { ...cfg, warmupSets: 2 }, { step: 2.5 })
    base[0] = { ...base[0], done: true, w: 50 }
    const rows = applyPrescription(base, { kind: 'up', weight: 20 }, 2.5, 0, true)
    expect(warmOf(rows)).toEqual([50, 35])
  })

  it('a per-side warm-up ramps both limbs with the same help', () => {
    const rows = buildSets(S, { ...cfg, side: true, warmupSets: 2 }, { step: 2.5 })
    const warm = rows.filter(r => r.phase === 'warmup')
    expect(warm.map(r => r.w)).toEqual([45, 37.5])
    for (const r of warm) { expect(r.sides.L.w).toBe(r.w); expect(r.sides.R.w).toBe(r.w) }
  })
})
