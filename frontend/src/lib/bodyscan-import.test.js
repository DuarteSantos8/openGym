import { describe, expect, it } from 'vitest'
import { applyScanImport, scanImportPreview } from './bodyscan-import.js'
import { parseScaleQr } from './bodyscan.js'
import { latestMeasurement, measurementSeries, normalizeMeasurementsState } from './measurements.js'

// The made-up sample of lib/bodyscan.test.js.
const SAMPLE_64 = '[78.4,60.5,17.9,22.8,33.1,44.6,81.0,1.2,1.1,1.2,0.0,0.1,1.6,1.7,1.6,1.4,1.3,2.0,2.1,3.4,3.3,27.4,8.6,8.5,0.9,1.0,10.6,2.4,2.3,39.0,7.0,3.6,26.9,15.8,12.4,1690.0,25.3,69.2,131.0,228.0,117.0,-9.8,-9.8,0.0,63.1,0.91,176.0,7.9,15.8,2.6,4.5,10.2,14.1,12.6,15.4,20.5,25.0,18.3,31.6,4.3,14.0,34.0,4.0,4.0]'
const values = parseScaleQr(SAMPLE_64)
const day = '2026-01-03'
const state = extra => normalizeMeasurementsState({ unit: 'kg', bodyweight: [], measurements: [], ...extra })

describe('applyScanImport', () => {
  it('keeps the scan on the day’s check-in, with its body fat and weight where the app tracks them', () => {
    const S = state()
    applyScanImport(S, values, { date: day, now: 5 })
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ d: day, t: 5, bodyFat: 22.8, scan: { len: 64, v: values } })
    expect(S.bodyweight).toEqual([{ d: day, w: 78.4, t: 5 }])
  })
  it('joins a check-in the day already has, its tape measurements left alone', () => {
    const S = state({ measurements: [{ d: day, t: 1, waist: 92 }] })
    applyScanImport(S, values, { date: day, now: 5 })
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ waist: 92, bodyFat: 22.8 })
  })
  it('the weigh-in in an lb profile is in lb; left out when not asked for', () => {
    const lb = state({ unit: 'lb' })
    applyScanImport(lb, values, { date: day, now: 5 })
    expect(lb.bodyweight[0].w).toBe(172.8)
    const none = state({ bodyweight: [{ d: day, w: 86, t: 1 }] })
    applyScanImport(none, values, { date: day, weighIn: false, now: 5 })
    expect(none.bodyweight).toEqual([{ d: day, w: 86, t: 1 }])
  })
  it('a second scan the same day replaces the first, and the day’s weigh-in', () => {
    const S = state({ bodyweight: [{ d: day, w: 86, t: 1 }] })
    applyScanImport(S, values, { date: day, now: 5 })
    const second = values.slice(); second[0] = 77.6; second[3] = 22.1
    expect(scanImportPreview(S, second, day)).toMatchObject({ hadScan: true, hadWeight: { w: 78.4 } })
    applyScanImport(S, second, { date: day, now: 6 })
    expect(S.measurements[0]).toMatchObject({ bodyFat: 22.1, scan: { v: second } })
    expect(S.bodyweight).toEqual([{ d: day, w: 77.6, t: 6 }])
  })
  it('a scale whose layout is not known yet: the scan is kept, nothing else is filled', () => {
    const S = state()
    const v95 = Array.from({ length: 95 }, (_, i) => i + 1)
    applyScanImport(S, v95, { date: day, now: 5 })
    expect(S.measurements[0]).toMatchObject({ bodyFat: null, scan: { len: 95 } })
    expect(S.bodyweight).toEqual([])
    // It stays through the normalising every write does.
    normalizeMeasurementsState(S)
    expect(S.measurements).toHaveLength(1)
  })
  it('not a scan: nothing changes', () => {
    const S = state()
    expect(applyScanImport(S, [1, 2, 3], { date: day })).toBeNull()
    expect(S.measurements).toEqual([])
  })
})

describe('a scan on the measurements chart', () => {
  it('its fields are series of their own, masses in the profile’s unit', () => {
    const S = state()
    applyScanImport(S, values, { date: day, now: 5 })
    expect(latestMeasurement(S, 'scan:muscleMass').value).toBe(33.1)
    expect(measurementSeries(S, 'scan:muscleMass')).toEqual([{ t: new Date(day + 'T12:00:00').getTime(), d: day, y: 33.1 }])
    expect(measurementSeries({ ...S, unit: 'lb' }, 'scan:muscleMass')[0].y).toBe(73)
    expect(measurementSeries(S, 'scan:bmr')[0].y).toBe(1690)
  })
  it('two rows of one day fold into one and keep the scan', () => {
    const S = state()
    applyScanImport(S, values, { date: day, now: 5 })
    S.measurements.push({ d: day, t: 9, waist: 90 })
    normalizeMeasurementsState(S)
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ waist: 90, bodyFat: 22.8, scan: { len: 64 } })
  })
})
