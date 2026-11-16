import { describe, expect, it } from 'vitest'
import { bodyCSV } from './export-csv.js'
import { parseCSV, parseBodyweight, parseImport, mergeImport, measurementImportPlan } from './import-csv.js'
import {
  CUSTOM_MEASUREMENT_UNITS, fromMeasurementDisplay, measurementSeries, measurementUnitLabel,
  normalizeMeasurementsState, parseCustomCsvColumn,
} from './measurements.js'

// #718 follow-ups: a unitless custom field (a score, a count), and the units travelling through
// the body CSV both ways, so an export read back into a fresh profile means the same thing.
const custom = [
  { id: 'ratio', name: 'Muscle ratio', unit: '%', enabled: true },
  { id: 'lean', name: 'Lean mass', unit: 'lb', enabled: true },
  { id: 'knee', name: 'Knee', enabled: true },
  { id: 'visc', name: 'Visceral fat', unit: 'none', enabled: true },
]
const state = () => normalizeMeasurementsState({
  unit: 'kg', bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }], customMeasurements: structuredClone(custom),
  measurements: [{ d: '2026-10-01', waist: 84.5, other: [
    { id: 'ratio', value: 40.5, unit: '%' }, { id: 'lean', value: 60, unit: 'lb' },
    { id: 'knee', value: 38.1 }, { id: 'visc', value: 0, unit: 'none' },
  ] }],
})

describe('a custom measurement without a unit', () => {
  it('is one of the units, shows no label and keeps a zero', () => {
    expect(CUSTOM_MEASUREMENT_UNITS).toContain('none')
    expect(measurementUnitLabel('none')).toBe('')
    expect(fromMeasurementDisplay(0, 'kg', { unit: 'none' })).toBe(0)
    expect(fromMeasurementDisplay(12, 'lb', { unit: 'none' })).toBe(12)
    const S = state()
    expect(S.measurements[0].other.find(o => o.id === 'visc')).toMatchObject({ value: 0, unit: 'none' })
    expect(measurementSeries({ ...S, unit: 'lb' }, 'other:visc').map(p => p.y)).toEqual([0])
  })
})

describe('the body CSV with custom units (#718)', () => {
  const text = bodyCSV(state())
  const rows = parseCSV(text)

  it('says each custom field\'s unit in its column and writes the values in it', () => {
    expect(rows[0]).toEqual(['date', 'weight_kg', 'waist_cm', 'Muscle ratio (%)', 'Lean mass (lb)', 'Knee (cm)', 'Visceral fat'])
    expect(rows[1]).toEqual(['2026-10-01', '80', '84.5', '40.5', '132.3', '38.1', '0'])
  })

  it('reads the columns back apart', () => {
    expect(parseCustomCsvColumn('Lean mass (lb)')).toEqual({ name: 'Lean mass', unit: 'lb' })
    expect(parseCustomCsvColumn('Visceral fat')).toEqual({ name: 'Visceral fat', unit: 'none' })
  })

  it('brings measurements back into a fresh profile with the same fields and units', () => {
    const parsed = parseImport(text, { unit: 'kg' })
    expect(parsed.kind).toBe('bodyweight')
    expect(parsed.measurements).toHaveLength(1)
    const S = normalizeMeasurementsState({ unit: 'kg', bodyweight: [] })
    const res = mergeImport(S, parsed)
    expect(res.measurements).toBe(1)
    expect(S.customMeasurements.map(c => [c.name, c.unit])).toEqual([
      ['Muscle ratio', '%'], ['Lean mass', 'lb'], ['Knee', 'cm'], ['Visceral fat', 'none'],
    ])
    const m = S.measurements[0]
    expect(m.waist).toBe(84.5)
    const byName = Object.fromEntries(m.other.map(o => [S.customMeasurements.find(c => c.id === o.id).name, o]))
    expect(byName['Muscle ratio']).toMatchObject({ value: 40.5, unit: '%' })
    expect(byName['Lean mass'].value).toBeCloseTo(60, 1)
    expect(byName.Knee.value).toBe(38.1)
    expect(byName['Visceral fat']).toMatchObject({ value: 0, unit: 'none' })
  })

  it('files a column under the field of that name, converting within its kind, and leaves a clashing one out', () => {
    const csv = 'date,weight_kg,Lean mass (kg),Muscle ratio (kg)\n2026-10-02,,61,50\n'
    const S = state()
    const res = mergeImport(S, parseBodyweight(csv, { unit: 'kg' }))
    expect(res.measurements).toBe(1)
    expect(S.customMeasurements).toHaveLength(4)
    const day = S.measurements.find(e => e.d === '2026-10-02')
    expect(day.other.find(o => o.id === 'lean')).toMatchObject({ value: 61, unit: 'lb' })
    expect(day.other.find(o => o.id === 'ratio').value).toBeNull()
  })

  it('leaves a day that already has measurements alone, and imports a measurements-only file', () => {
    const S = state()
    const parsed = parseBodyweight('date,weight_kg,waist_cm\n2026-10-01,,90\n2026-10-03,,83\n', { unit: 'kg' })
    expect(parsed.error).toBeUndefined()
    expect(parsed.bodyweight).toEqual([])
    expect(mergeImport(S, parsed).measurements).toBe(1)
    expect(S.measurements.map(e => [e.d, e.waist])).toEqual([['2026-10-01', 84.5], ['2026-10-03', 83]])
  })

  it('does not read another app\'s extra columns as measurements', () => {
    const parsed = parseBodyweight('Date,Weight,Notes\n2026-10-01,80,after coffee\n', { unit: 'kg' })
    expect(parsed.bodyweight).toHaveLength(1)
    expect(parsed.measurements || []).toEqual([])
  })
})

describe('importing measurements that make no sense', () => {
  it('skips a day whose only values no field can hold', () => {
    const S = state()
    const res = mergeImport(S, parseBodyweight('date,weight_kg,Muscle ratio (%)\n2026-10-05,,140\n', { unit: 'kg' }))
    expect(res.measurements).toBe(0)
    expect(S.measurements.map(e => e.d)).toEqual(['2026-10-01'])
  })
})

// #1206: a day that has some measurements no longer swallows the rest of its row — the check-in
// keeps what it has, the file fills what it has not.
describe('a check-in the file only completes (#1206)', () => {
  it('fills the fields the day has not, and keeps the ones it has', () => {
    const S = state()
    const res = mergeImport(S, parseBodyweight('date,weight_kg,waist_cm,chest_cm\n2026-10-01,,90,100\n', { unit: 'kg' }))
    expect(res.measurements).toBe(1)
    const day = S.measurements.find(e => e.d === '2026-10-01')
    expect(day.waist).toBe(84.5) // the day's own value wins
    expect(day.chest).toBe(100)
    expect(day.other.find(o => o.id === 'ratio').value).toBe(40.5)
    expect(S.measurements).toHaveLength(1)
    // The same file again brings nothing.
    expect(mergeImport(S, parseBodyweight('date,weight_kg,waist_cm,chest_cm\n2026-10-01,,90,100\n', { unit: 'kg' })).measurements).toBe(0)
    expect(S.measurements.find(e => e.d === '2026-10-01').chest).toBe(100)
  })

  it('makes a custom field a filled day needs, and files the value under it', () => {
    const S = state()
    const res = mergeImport(S, parseBodyweight('date,weight_kg,Shoulder (cm)\n2026-10-01,,55\n', { unit: 'kg' }))
    expect(res.measurements).toBe(1)
    const field = S.customMeasurements.find(c => c.name === 'Shoulder')
    expect(field).toMatchObject({ unit: 'cm', enabled: true })
    const day = S.measurements.find(e => e.d === '2026-10-01')
    expect(day.other.find(o => o.id === field.id)).toMatchObject({ value: 55 })
    expect(day.waist).toBe(84.5)
  })

  it('folds several rows of one date into one check-in, the first value of a field winning', () => {
    const S = state()
    const res = mergeImport(S, parseBodyweight('date,weight_kg,waist_cm,chest_cm\n2026-11-01,,90,\n2026-11-01,,91,100\n', { unit: 'kg' }))
    expect(res.measurements).toBe(1)
    const days = S.measurements.filter(e => e.d === '2026-11-01')
    expect(days).toHaveLength(1)
    expect([days[0].waist, days[0].chest]).toEqual([90, 100])
  })

  it('the import plan says which days the file adds to, fills or leaves alone', () => {
    const S = state()
    const before = JSON.stringify(S)
    const days = parseBodyweight(
      'date,weight_kg,waist_cm,chest_cm\n2026-10-01,,90,100\n2026-10-03,,83,\n', { unit: 'kg' }).measurements
    const plan = measurementImportPlan(S, days)
    expect(plan.get('2026-10-01')).toBe('fill')
    expect(plan.get('2026-10-03')).toBe('add')
    // A day the file can only repeat is kept.
    expect(measurementImportPlan(S, parseBodyweight('date,weight_kg,waist_cm\n2026-10-01,,90\n', { unit: 'kg' }).measurements).get('2026-10-01')).toBe('keep')
    expect(JSON.stringify(S)).toBe(before) // planning touches nothing
  })
})
