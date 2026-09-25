import { describe, expect, it } from 'vitest'
import { defaultPlanRule } from '../../../../api/engine/rules.js'
import { generatePrescription } from '../../../../api/engine/generate.js'
import { auditExecution, missingReference, normalizeEffort, summarizeActual } from '../../../../api/engine/audit.js'

const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
const prescribe = (preset, patch = r => r) => generatePrescription({
  id: 'p1', now: NOW, trackId: 't1', rule: patch(defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg' }))
})
const linear = prescribe('linear')   // 3 × 5 @ 20 kg, target 100 kg

describe('auditExecution', () => {
  it('flags values outside the prescription as warnings, bounds inclusive', () => {
    expect(auditExecution(linear, { row: 0, reps: 5, load: kg(20) })).toEqual([])
    expect(auditExecution(linear, { row: 0, reps: 4 })).toEqual([{ code: 'below_range', field: 'reps', expected: { min: 5, max: 5 }, actual: 4, severity: 'warning', row: 0 }])
    expect(auditExecution(linear, { row: 1, load: kg(22.5) })).toEqual([{ code: 'above_range', field: 'load', expected: { min: 20, max: 20 }, actual: 22.5, severity: 'warning', row: 1 }])
    expect(auditExecution(linear, { sets: 4 })).toEqual([{ code: 'above_range', field: 'sets', expected: { min: 3, max: 3 }, actual: 4, severity: 'warning' }])
  })

  it('flags a load above the automatic cap without capping it', () => {
    const findings = auditExecution(linear, { row: 0, load: kg(250) })
    expect(findings.map(f => f.code)).toEqual(['above_range', 'above_cap'])
    expect(findings[1]).toMatchObject({ field: 'load', expected: 100, actual: 250 })
  })

  it('audits a set beyond the prescription against the last prescribed row', () => {
    expect(auditExecution(linear, { row: 7, reps: 5, load: kg(20) })).toEqual([])
  })

  it('never flags reps above an AMRAP set', () => {
    const greyskull = prescribe('greyskull')
    expect(auditExecution(greyskull, { row: 2, reps: 14 })).toEqual([])
    expect(auditExecution(greyskull, { row: 2, reps: 3 })[0]).toMatchObject({ code: 'below_range', field: 'reps' })
    expect(auditExecution(greyskull, { row: 1, reps: 14 })[0]).toMatchObject({ code: 'above_range', field: 'reps' })
  })

  it('marks a manual load on an unresolved percent row as missing_reference', () => {
    const pct = prescribe('linear', r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'percent_1rm', percent: 60 } }, increment: { type: 'percentage_points', value: 5 } }))
    expect(missingReference(pct)).toBe(true)
    expect(missingReference(linear)).toBe(false)
    expect(auditExecution(pct, { row: 0, reps: 5, load: kg(50) }).map(f => f.code)).toEqual(['missing_reference'])
  })

  it('marks entries on a completed track once, on the exercise summary', () => {
    const done = { status: 'completed', planRuleRevision: linear.planRuleRevision }
    expect(auditExecution(linear, { sets: 3 }, done).map(f => f.code)).toEqual(['completed_track'])
    expect(auditExecution(linear, { row: 0, reps: 5, load: kg(20) }, done)).toEqual([])
  })

  it('does not report a completed track whose rule was edited since (it reopened)', () => {
    const stale = { status: 'completed', planRuleRevision: linear.planRuleRevision - 1 }
    expect(auditExecution(linear, { sets: 3 }, stale)).toEqual([])
  })

  it('keeps pyramid offset rows while allowing performed counts inside the declared range', () => {
    const pyramid = prescribe('pyramid', r => ({ ...r, parameters: { ...r.parameters, sets: { min: 2, max: 4 } } }))
    expect(pyramid.rows).toHaveLength(3)
    expect(auditExecution(pyramid, { sets: 2 })).toEqual([])
    expect(auditExecution(pyramid, { sets: 4 })).toEqual([])
    expect(auditExecution(pyramid, { sets: 1 }).map(f => f.code)).toEqual(['below_range'])
    expect(auditExecution(pyramid, { sets: 5 }).map(f => f.code)).toEqual(['above_range'])
  })
})

describe('load ranges', () => {
  const ranged = prescribe('autoregulated', r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } } }))

  it('accepts any load inside the prescribed range and flags one outside it', () => {
    expect(auditExecution(ranged, { row: 0, load: kg(60) })).toEqual([])
    expect(auditExecution(ranged, { row: 1, load: kg(72.5) })).toEqual([])
    expect(auditExecution(ranged, { row: 2, load: kg(80) })).toEqual([])
    expect(auditExecution(ranged, { row: 0, load: kg(57.5) })).toEqual([{ code: 'below_range', field: 'load', expected: { min: 60, max: 80 }, actual: 57.5, severity: 'warning', row: 0 }])
    expect(auditExecution(ranged, { row: 0, load: kg(82.5) })).toEqual([{ code: 'above_range', field: 'load', expected: { min: 60, max: 80 }, actual: 82.5, severity: 'warning', row: 0 }])
  })
})

describe('effort', () => {
  it('normalizes RPE to RIR and compares RIR', () => {
    expect(normalizeEffort({ rpeEntered: 8 })).toEqual({ rir: 2, rpeEntered: 8 })
    expect(normalizeEffort({ rir: 3 })).toEqual({ rir: 3, rpeEntered: null })
    const auto = prescribe('autoregulated')   // RIR 1-3
    expect(auditExecution(auto, { row: 0, rpeEntered: 9.5 })).toEqual([{ code: 'below_range', field: 'rir', expected: { min: 1, max: 3 }, actual: 0.5, severity: 'warning', row: 0 }])
  })
})

describe('summarizeActual', () => {
  it('keeps exact logged values — no clamp, truncation or rounding', () => {
    const performed = [{ row: 0, reps: 17, load: kg(250.33) }, { row: 1, reps: 3, load: kg(12.1) }, { row: 5, reps: 5, load: kg(20) }]
    const before = JSON.stringify(performed)
    expect(summarizeActual(linear, performed)).toEqual({ sets: 3, reps: 3, load: kg(12.1) })
    expect(JSON.stringify(performed)).toBe(before)
  })

  it('reads only a pyramid anchor for reps and load, but counts every set', () => {
    const pyramid = prescribe('pyramid', r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value: 100, unit: 'kg' } }, target: { mode: 'absolute', value: 150, unit: 'kg' } }))
    const performed = [{ row: 0, reps: 8, load: kg(70) }, { row: 1, reps: 8, load: kg(85) }, { row: 2, reps: 6, load: kg(100) }]
    expect(summarizeActual(pyramid, performed)).toEqual({ sets: 3, reps: 6, load: kg(100) })
  })

  it('summarizes effort in RIR and keeps the hardest RPE entered', () => {
    const auto = prescribe('autoregulated')
    expect(summarizeActual(auto, [{ row: 0, reps: 8, rpeEntered: 8 }, { row: 1, reps: 9, rir: 1 }])).toEqual({ sets: 2, reps: 8, load: null, rir: 1, rpeEntered: 8 })
  })
})
