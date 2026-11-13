// Blood pressure as a pair (#313) and a check-in's note.
import { describe, expect, it } from 'vitest'
import {
  normalizeMeasurementEntry, normalizeMeasurementsState, measurementSeries, toMeasurementDisplay, fromMeasurementDisplay,
  measurementEntryHasValues, bpOf, bpText, bpSeries, bpProblem, pairKeys, builtinUnit, MEASUREMENT_FIELDS, builtinCsvColumn,
} from './measurements.js'
import { bodyCSV } from './export-csv.js'
import { parseBodyweight } from './import-csv.js'

describe('blood pressure', () => {
  it('is three keys under one switch, in mmHg and bpm, never converted to inches', () => {
    expect(pairKeys('bp')).toEqual(['bpSys', 'bpDia', 'pulse'])
    expect(builtinUnit('bpSys')).toBe('mmHg')
    expect(builtinUnit('pulse')).toBe('bpm')
    expect(builtinUnit('waist')).toBeNull()
    expect(toMeasurementDisplay(120, 'in', { key: 'bpSys' })).toBe(120)
    expect(fromMeasurementDisplay(80, 'in', { key: 'bpDia' })).toBe(80)
  })
  it('stores whole numbers and charts both halves', () => {
    const e = normalizeMeasurementEntry({ d: '2026-11-01', bpSys: '121.6', bpDia: 79.2, pulse: 61 })
    expect([e.bpSys, e.bpDia, e.pulse]).toEqual([122, 79, 61])
    expect(measurementEntryHasValues(e)).toBe(true)
    const S = { measureUnit: 'in', measurements: [e, normalizeMeasurementEntry({ d: '2026-11-03', bpSys: 118, bpDia: 76 })] }
    expect(measurementSeries(S, 'bpSys').map(p => p.y)).toEqual([122, 118])
    expect(bpSeries(S).dia.map(p => p.y)).toEqual([79, 76])
    expect(bpText(bpOf(e))).toBe('122/79')
    expect(bpOf({ d: '2026-11-01', waist: 80 })).toBeNull()
  })
  it('says what is wrong with a reading', () => {
    expect(bpProblem({ sys: 120, dia: 80, pulse: 60 })).toBeNull()
    expect(bpProblem({})).toBeNull()
    expect(bpProblem({ sys: 120 })).toBe('pair')
    expect(bpProblem({ sys: 80, dia: 120 })).toBe('order')
    expect(bpProblem({ sys: 400, dia: 80 })).toBe('range')
    expect(bpProblem({ pulse: 400 })).toBe('pulse')
  })
  it('has CSV columns of its own that come back in', () => {
    expect(MEASUREMENT_FIELDS.filter(f => f.pair).map(builtinCsvColumn)).toEqual(['bp_systolic_mmhg', 'bp_diastolic_mmhg', 'pulse_bpm'])
    const S = { unit: 'kg', bodyweight: [], measurements: [normalizeMeasurementEntry({ d: '2026-11-01', bpSys: 120, bpDia: 80, pulse: 60 })] }
    const csv = bodyCSV(S)
    expect(csv.split('\n')[0]).toContain('bp_systolic_mmhg')
    const back = parseBodyweight(csv, 'kg')
    expect(back.measurements[0].values).toEqual({ bpSys: 120, bpDia: 80, pulse: 60 })
  })
})

describe('a check-in note', () => {
  it('is kept, trimmed and capped, and survives the fold of two rows of a day', () => {
    expect(normalizeMeasurementEntry({ d: '2026-11-01', waist: 80, note: '  after the holidays \u0007 ' }).note).toBe('after the holidays')
    expect(normalizeMeasurementEntry({ d: '2026-11-01', note: 'x'.repeat(900) }).note).toHaveLength(500)
    expect('note' in normalizeMeasurementEntry({ d: '2026-11-01', waist: 80 })).toBe(false)
    const S = normalizeMeasurementsState({ measurements: [{ d: '2026-11-01', t: 1, waist: 80, note: 'first' }, { d: '2026-11-01', t: 2, hips: 90 }] })
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0].note).toBe('first')
  })
})
