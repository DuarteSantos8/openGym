import { describe, expect, it } from 'vitest'
import {
  MEASUREMENT_KEYS, DEFAULT_MEASUREMENT_KEYS, emptyMeasurement, enabledMeasurementFields,
  normalizeMeasurementEntry, normalizeMeasurementsState, measurementSeries,
  toMeasurementDisplay, fromMeasurementDisplay, measurementEntryHasValues,
  measurementUnit, measurementValue, customMeasurementUnits,
} from './measurements.js'

describe('body measurements', () => {
  it('creates a complete entry with nulls instead of ambiguous zeroes', () => {
    const e = emptyMeasurement('2026-08-11', [{ id: 'knee', name: 'Around knees' }])
    expect(Object.keys(e).filter(k => MEASUREMENT_KEYS.includes(k))).toEqual(MEASUREMENT_KEYS)
    expect(MEASUREMENT_KEYS.every(k => e[k] === null)).toBe(true)
    expect(e.other).toEqual([{ id: 'knee', name: 'Around knees', value: null }])
    expect(measurementEntryHasValues(e)).toBe(false)
  })

  it('normalizes partial entries and preserves unknown custom history', () => {
    const e = normalizeMeasurementEntry({
      d: '2026-08-11', waist: 82.54, chest: 0,
      bodyFat: 140,
      other: [{ id: 'old', name: 'Old field', value: 12.34 }],
    }, [{ id: 'knee', name: 'Knee' }])
    expect(e.waist).toBe(82.5)
    expect(e.chest).toBeNull()
    expect(e.bodyFat).toBeNull()
    expect(e.other).toEqual([
      { id: 'old', name: 'Old field', value: 12.3 },
      { id: 'knee', name: 'Knee', value: null },
    ])
  })

  it('uses centimetres as canonical storage and round-trips inches', () => {
    expect(fromMeasurementDisplay(32.5, 'lb')).toBe(82.6)
    expect(toMeasurementDisplay(82.6, 'lb')).toBe(32.5)
    expect(fromMeasurementDisplay(82.6, 'kg')).toBe(82.6)
  })

  it('migrates missing state defaults and sorts entries', () => {
    const s = normalizeMeasurementsState({ measurements: [
      { d: '2026-08-12', waist: 83 }, { d: '2026-08-11', waist: 82 },
    ] })
    expect(s.measurementEnabled).toEqual(DEFAULT_MEASUREMENT_KEYS)
    expect(s.measurements.map(e => e.d)).toEqual(['2026-08-11', '2026-08-12'])
    expect(MEASUREMENT_KEYS.every(k => k in s.measurements[0])).toBe(true)
  })

  it('builds a display-unit series and ignores missing values', () => {
    const s = normalizeMeasurementsState({ unit: 'lb', measurements: [
      { d: '2026-08-11', t: 100, waist: 82.55 },
      { d: '2026-08-12', t: 200, waist: null },
      { d: '2026-08-13', t: 300, waist: 85.09 },
    ] })
    expect(measurementSeries(s, 'waist').map(p => p.y)).toEqual([32.5, 33.5])
  })

  it('folds two entries for one date into a single check-in', () => {
    const s = normalizeMeasurementsState({
      customMeasurements: [{ id: 'knee', name: 'Knee' }],
      measurements: [
        { d: '2026-08-11', t: 100, waist: 82, chest: 101, other: [{ id: 'knee', value: 38 }] },
        { d: '2026-08-11', t: 200, waist: 83, other: [{ id: 'knee', value: null }] },
        { d: '2026-08-12', t: 300, waist: 84 },
      ],
    })
    expect(s.measurements.map(e => e.d)).toEqual(['2026-08-11', '2026-08-12'])
    const [merged] = s.measurements
    expect(merged.t).toBe(200)
    expect(merged.waist).toBe(83)     // later reading wins
    expect(merged.chest).toBe(101)    // only the earlier row had it — kept
    expect(merged.other).toEqual([{ id: 'knee', name: 'Knee', value: 38 }])
  })

  it('orders fields by the field list, not by when each was switched on', () => {
    // measurementEnabled is a set the toggles append to: switching Neck off and on again puts
    // it last there, and the form must not reorder itself because of that.
    const state = {
      measurementEnabled: [...DEFAULT_MEASUREMENT_KEYS.filter(k => k !== 'neck'), 'neck'],
      customMeasurements: [{ id: 'knee', name: 'Around knees', enabled: true }],
    }
    expect(enabledMeasurementFields(state).map(f => f.key))
      .toEqual([...DEFAULT_MEASUREMENT_KEYS, 'other:knee'])
  })
})

describe('custom measurement units (#699)', () => {
  const field = unit => ({ id: 'muscle', name: 'Muscle mass', unit })
  const state = (unit, values = [40, 41.5]) => normalizeMeasurementsState({
    unit: 'lb', customMeasurements: [field(unit)], measurementEnabled: [],
    measurements: values.map((value, i) => ({ d: `2026-10-0${i + 1}`, other: [{ id: 'muscle', value }] })),
  })

  it.each(['cm', 'in', '%', 'kg', 'lb'])('preserves the selected %s unit through repeated normalization', unit => {
    const s = state(unit)
    expect(s.customMeasurements[0].unit).toBe(unit)
    expect(enabledMeasurementFields(s)[0].unit).toBe(unit)
    expect(s.measurements[0].other[0].unit).toBe(unit)
    expect(normalizeMeasurementsState(structuredClone(s))).toEqual(s)
    expect(measurementUnit('kg', field(unit))).toBe(unit)
    expect(measurementUnit('lb', field(unit))).toBe(unit)
  })

  it('never converts a custom percentage to inches on a pounds profile', () => {
    const s = state('%')
    expect(measurementSeries(s, 'other:muscle').map(p => p.y)).toEqual([40, 41.5])
    expect(measurementSeries({ ...s, unit: 'kg' }, 'other:muscle').map(p => p.y)).toEqual([40, 41.5])
    expect(fromMeasurementDisplay(41.5, 'lb', field('%'))).toBe(41.5)
  })

  it('converts explicit inches and pounds at the input/display boundary', () => {
    expect(fromMeasurementDisplay(32.5, 'kg', field('in'))).toBe(82.6)
    expect(toMeasurementDisplay(82.6, 'lb', field('cm'))).toBe(82.6)
    expect(fromMeasurementDisplay(110.2, 'kg', field('lb'))).toBe(49.986)
    expect(toMeasurementDisplay(50, 'kg', field('lb'))).toBe(110.2)
    expect(measurementSeries(state('kg'), 'other:muscle')[0].y).toBe(40)
    expect(measurementSeries(state('lb', [50]), 'other:muscle')[0].y).toBe(110.2)
    // Keep enough canonical precision that saving 110.3 lb does not come back as 110.2 lb.
    const kg = fromMeasurementDisplay(110.3, 'kg', field('lb'))
    const saved = state('lb', [kg])
    expect(measurementSeries(saved, 'other:muscle')[0].y).toBe(110.3)
  })

  it('keeps legacy custom values in cm and follows the profile display unit', () => {
    const s = state(undefined, [82.6])
    expect(s.customMeasurements[0]).not.toHaveProperty('unit')
    expect(s.measurements[0].other[0].value).toBe(82.6)
    expect(measurementSeries(s, 'other:muscle')[0].y).toBe(32.5)
    expect(measurementSeries({ ...s, unit: 'kg' }, 'other:muscle')[0].y).toBe(82.6)
  })

  it('accepts 0–100% including zero, ignores blank/invalid values, and preserves orphaned units', () => {
    const s = state('%', [0, 100, 101, -1, null, ''])
    expect(s.measurements.map(e => e.other[0].value)).toEqual([0, 100, null, null, null, null])
    expect(measurementValue(s.measurements[0], 'other:muscle')).toBe(0)
    expect(measurementEntryHasValues(s.measurements[0])).toBe(true)
    const orphaned = normalizeMeasurementsState({ ...s, customMeasurements: [] })
    expect(orphaned.measurements[0].other[0]).toMatchObject({ value: 0, unit: '%' })
    expect(measurementSeries(orphaned, 'other:muscle').map(p => p.y)).toEqual([0, 100])
  })

  it('allows changing display units within a type, without reinterpreting old readings', () => {
    const mass = state('kg')
    expect(customMeasurementUnits(mass.customMeasurements[0], mass.measurements)).toEqual(['kg', 'lb'])
    const length = state(undefined)
    expect(customMeasurementUnits(length.customMeasurements[0], length.measurements)).toEqual(['cm', 'in'])
    const percent = state('%', [0])
    expect(customMeasurementUnits(percent.customMeasurements[0], percent.measurements)).toEqual(['%'])
    expect(customMeasurementUnits(field('cm'), [])).toEqual(['cm', 'in', '%', 'kg', 'lb', 'none'])
    const before = structuredClone(mass.measurements)
    mass.customMeasurements[0].unit = 'lb'
    normalizeMeasurementsState(mass)
    expect(mass.measurements).toEqual(before)
    expect(measurementSeries(mass, 'other:muscle')[0].y).toBe(88.2)
  })

  it('falls back safely for an unknown unit without altering stored values', () => {
    const s = state('invalid', [82.6])
    expect(s.customMeasurements[0]).not.toHaveProperty('unit')
    expect(measurementSeries(s, 'other:muscle')[0].y).toBe(32.5)
  })

  it('keeps a value and its unit together when folding partial backup readings for one day', () => {
    const s = normalizeMeasurementsState({ measurements: [
      { d: '2026-10-01', t: 1, other: [{ id: 'mass', name: 'Mass', value: 60, unit: 'kg' }] },
      { d: '2026-10-01', t: 2, other: [{ id: 'mass', name: 'Mass', value: null, unit: '%' }] },
    ] })
    expect(s.measurements[0].other[0]).toEqual({ id: 'mass', name: 'Mass', value: 60, unit: 'kg' })
  })
})
