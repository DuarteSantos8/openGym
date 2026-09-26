import { describe, expect, it } from 'vitest'
import { defaultPlanRule, generatePrescription } from './prescription/index.js'
import { entriesForExposures, exposuresWithPerformance, loadStepFor, planSummary, rowFindings, rowIndexOf } from './session-ui-adapter.js'

const NOW = '2026-09-24T10:00:00.000Z'
const pyramid = generatePrescription({
  id: 'p1', now: NOW, trackId: 't1',
  rule: { ...defaultPlanRule('pyramid', { id: 'r', exerciseId: '0025', unit: 'kg' }), parameters: { ...defaultPlanRule('pyramid', { id: 'r', exerciseId: '0025', unit: 'kg' }).parameters, load: { mode: 'absolute', value: 100, unit: 'kg' } }, target: { mode: 'absolute', value: 150, unit: 'kg' } }
})
const rpt = generatePrescription({
  id: 'p3', now: NOW, trackId: 't3',
  rule: { ...defaultPlanRule('reverse_pyramid', { id: 'r3', exerciseId: '0025', unit: 'kg' }), parameters: { ...defaultPlanRule('reverse_pyramid', { id: 'r3', exerciseId: '0025', unit: 'kg' }).parameters, reps: { min: 6, max: 6 }, load: { mode: 'absolute', value: 100, unit: 'kg' } }, special: { offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }] } }
})

describe('entriesForExposures', () => {
  it('projects prescription rows into editable rows with prefill and rest', () => {
    const [entry] = entriesForExposures([{ exposureId: 'x1', exerciseId: '0025', prescriptionId: 'p1', routineId: 'r1' }], { p1: pyramid })
    expect(entry).toMatchObject({ id: '0025', exposureId: 'x1', rid: 'r1', target: { sets: 3, reps: 8, weight: 70, restSec: 150 } })
    expect(entry.sets.map(s => [s.setId, s.r, s.w, s.done])).toEqual([['r0', 8, 70, false], ['r1', 8, 85, false], ['r2', 8, 100, false]])
    expect(loadStepFor(pyramid, 'kg')).toBe(2.5)
    expect(rowIndexOf(entry.sets[2])).toBe(2)
    expect(rowIndexOf({ done: true })).toBe(null)
  })

  it('gives every RPT row its own reps and shows them in the summary', () => {
    const [entry] = entriesForExposures([{ exposureId: 'x3', exerciseId: '0025', prescriptionId: 'p3' }], { p3: rpt })
    expect(entry.sets.map(s => [s.r, s.w])).toEqual([[6, 100], [8, 90], [10, 80]])
    expect(planSummary(rpt)).toBe('3 × 6/8/10 @ 100/90/80 kg')
  })
})

describe('entriesForExposures intensifier', () => {
  const linear = generatePrescription({ id: 'p2', now: NOW, trackId: 't2', rule: defaultPlanRule('linear', { id: 'r2', exerciseId: '0025', unit: 'kg' }) })
  const run = intensifier => entriesForExposures([{ exposureId: 'x', exerciseId: '0025', prescriptionId: 'p2', intensifier }], { p2: linear })[0]
  it('stamps drops on every work row and exposes the plan on the target', () => {
    const entry = run({ type: 'dropset', count: 2, pct: 20 })
    expect(entry.target.intensifier.type).toBe('dropset')
    expect(entry.sets.every(s => s.type === 'dropset' && s.drops.length === 2 && s.setId)).toBe(true)
  })
  it('collapses to one prescribed rest-pause row', () => {
    const entry = run({ type: 'restpause', totalReps: 12, restSec: 15 })
    const work = entry.sets.filter(s => s.type === 'restpause')
    expect(work).toHaveLength(1)
    expect(work[0]).toMatchObject({ setId: 'r0', r: 12 })
  })
})

describe('exposuresWithPerformance', () => {
  it('writes the exact rows back with role, mode and normalized effort', () => {
    const exposures = [{ exposureId: 'x1', exerciseId: '0025', prescriptionId: 'p1' }]
    const entries = [{ exposureId: 'x1', id: '0025', target: { sets: 3, reps: 8 }, sets: [
      { phase: 'warmup', done: true, r: 12, w: 40 },
      { setId: 'r0', done: true, r: 7, w: 101.3, rpe: 8 },
      { done: false, r: 8, w: 70 }
    ] }]
    const [x] = exposuresWithPerformance(exposures, entries, 'kg')
    expect(x.mode).toBe('reps')
    expect(x.performance.sets.map(s => [s.role, s.status, s.prescribed])).toEqual([['warmup', 'completed', false], ['work', 'completed', true], ['work', 'skipped', false]])
    expect(x.performance.sets[1]).toMatchObject({ setId: 'r0', resistance: { kind: 'external-load', value: 101.3, unit: 'kg' }, rir: 2, rpeEntered: 8 })
  })
})

describe('live audit and plan line', () => {
  const linear = generatePrescription({ id: 'p2', now: NOW, trackId: 't', rule: defaultPlanRule('linear', { id: 'r', exerciseId: '0025', unit: 'kg' }) })

  it('reports findings per UI row, skipping warm-ups, and never blocks', () => {
    const entry = { sets: [{ phase: 'warmup', r: 12, w: 10 }, { setId: 'r0', r: 5, w: 20 }, { setId: 'r1', r: 3, w: 20 }, { r: 5, w: 150 }] }
    const found = rowFindings(linear, entry, 'kg')
    expect([...found.keys()]).toEqual([2, 3])
    expect(found.get(2).map(f => f.code)).toEqual(['below_range'])
    expect(found.get(3).map(f => f.code)).toEqual(['above_range', 'above_cap'])
  })

  it('summarizes sets, reps and per-row loads', () => {
    expect(planSummary(linear)).toBe('3 × 5 @ 20 kg')
    expect(planSummary(pyramid)).toBe('3 × 8 @ 70/85/100 kg')
  })

  it('shows a load range as low–high', () => {
    const base = defaultPlanRule('autoregulated', { id: 'r', exerciseId: '0025', unit: 'kg' })
    const rule = { ...base, parameters: { ...base.parameters, load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } } }
    expect(planSummary(generatePrescription({ id: 'p3', now: NOW, trackId: 't', rule }))).toBe('3 × 8–12 @ 60–80 kg')
  })
})

describe('warm-up materialization', () => {
  const r = defaultPlanRule('linear', { id: 'w1', exerciseId: 'ex1', routineId: 'rt', unit: 'kg' })
  r.parameters.load = { mode: 'absolute', value: 100, unit: 'kg' }
  const p = generatePrescription({ id: 'pw', now: '2026-09-25T00:00:00.000Z', trackId: 't', rule: r, warmup: { mode: 'smart', count: 2 }, equipment: 'barbell' })
  it('puts generated warm-ups before work, flagged automatic', () => {
    const [entry] = entriesForExposures([{ exerciseId: 'ex1', exposureId: 'e1', prescriptionId: 'pw' }], { pw: p })
    expect(entry.sets.slice(0, 2)).toEqual([
      { w: 75, r: 1, done: false, phase: 'warmup', warmup: true, autoWarmup: true },
      { w: 85, r: 1, done: false, phase: 'warmup', warmup: true, autoWarmup: true }
    ])
    expect(entry.sets.slice(2).every(s => !s.warmup && s.setId)).toBe(true)
    expect(entry.target.sets).toBe(p.rows.length)
  })
})
