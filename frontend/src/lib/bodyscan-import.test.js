import { describe, expect, it } from 'vitest'
import { applyScanImport, scanImportPreview } from './bodyscan-import.js'
import { parseScaleQr } from './bodyscan.js'
import { latestMeasurement, measurementSeries, normalizeMeasurementsState } from './measurements.js'

// The plan's appendix A sample (lib/bodyscan.test.js).
const SAMPLE_64 = '[87.0,64.3,22.7,26.1,36.2,46.9,76.5,1.4,1.3,1.3,0.0,0.1,1.8,1.8,1.8,1.5,1.5,2.2,2.4,3.9,4.0,29.6,9.2,9.0,1.1,1.1,13.5,2.9,2.8,43.0,8.0,4.1,29.7,17.2,13.3,1758.0,30.1,73.8,138.4,240.0,121.0,-13.2,-13.2,0.0,67.4,0.95,170.0,8.7,17.4,2.8,4.9,11.0,15.2,13.6,16.6,22.2,27.1,19.8,34.1,4.7,15.2,40.0,4.0,4.0]'
const values = parseScaleQr(SAMPLE_64)
const day = '2026-01-03'
const state = extra => normalizeMeasurementsState({ unit: 'kg', bodyweight: [], measurements: [], ...extra })

describe('applyScanImport', () => {
  it('keeps the scan on the day’s check-in, with its body fat and weight where the app tracks them', () => {
    const S = state()
    applyScanImport(S, values, { date: day, now: 5 })
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ d: day, t: 5, bodyFat: 26.1, scan: { len: 64, v: values } })
    expect(S.bodyweight).toEqual([{ d: day, w: 87, t: 5 }])
  })
  it('joins a check-in the day already has, its tape measurements left alone', () => {
    const S = state({ measurements: [{ d: day, t: 1, waist: 92 }] })
    applyScanImport(S, values, { date: day, now: 5 })
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ waist: 92, bodyFat: 26.1 })
  })
  it('the weigh-in in an lb profile is in lb; left out when not asked for', () => {
    const lb = state({ unit: 'lb' })
    applyScanImport(lb, values, { date: day, now: 5 })
    expect(lb.bodyweight[0].w).toBe(191.8)
    const none = state({ bodyweight: [{ d: day, w: 86, t: 1 }] })
    applyScanImport(none, values, { date: day, weighIn: false, now: 5 })
    expect(none.bodyweight).toEqual([{ d: day, w: 86, t: 1 }])
  })
  it('a second scan the same day replaces the first, and the day’s weigh-in', () => {
    const S = state({ bodyweight: [{ d: day, w: 86, t: 1 }] })
    applyScanImport(S, values, { date: day, now: 5 })
    const second = values.slice(); second[0] = 86.4; second[3] = 25.8
    expect(scanImportPreview(S, second, day)).toMatchObject({ hadScan: true, hadWeight: { w: 87 } })
    applyScanImport(S, second, { date: day, now: 6 })
    expect(S.measurements[0]).toMatchObject({ bodyFat: 25.8, scan: { v: second } })
    expect(S.bodyweight).toEqual([{ d: day, w: 86.4, t: 6 }])
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
    expect(latestMeasurement(S, 'scan:muscleMass').value).toBe(36.2)
    expect(measurementSeries(S, 'scan:muscleMass')).toEqual([{ t: new Date(day + 'T12:00:00').getTime(), d: day, y: 36.2 }])
    expect(measurementSeries({ ...S, unit: 'lb' }, 'scan:muscleMass')[0].y).toBe(79.8)
    expect(measurementSeries(S, 'scan:bmr')[0].y).toBe(1758)
  })
  it('two rows of one day fold into one and keep the scan', () => {
    const S = state()
    applyScanImport(S, values, { date: day, now: 5 })
    S.measurements.push({ d: day, t: 9, waist: 90 })
    normalizeMeasurementsState(S)
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ waist: 90, bodyFat: 26.1, scan: { len: 64 } })
  })
})
