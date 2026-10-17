import { describe, expect, it } from 'vitest'
import { cleanScan, parseScaleQr, readScan, scanDisplay, scanReadable, scanUnit, scanValue } from './bodyscan.js'

// The 64-value code from the plan's appendix A, photographed off the scale's screen (03.01.26),
// with what the gym app showed for the same measurement.
const SAMPLE_64 = '[87.0,64.3,22.7,26.1,36.2,46.9,76.5,1.4,1.3,1.3,0.0,0.1,1.8,1.8,1.8,1.5,1.5,2.2,2.4,3.9,4.0,29.6,9.2,9.0,1.1,1.1,13.5,2.9,2.8,43.0,8.0,4.1,29.7,17.2,13.3,1758.0,30.1,73.8,138.4,240.0,121.0,-13.2,-13.2,0.0,67.4,0.95,170.0,8.7,17.4,2.8,4.9,11.0,15.2,13.6,16.6,22.2,27.1,19.8,34.1,4.7,15.2,40.0,4.0,4.0]'
const list = n => '[' + Array.from({ length: n }, (_, i) => i / 10).join(',') + ']'

describe('parseScaleQr', () => {
  it('reads the scale’s code, every number in its place', () => {
    const v = parseScaleQr(SAMPLE_64)
    expect(v).toHaveLength(64)
    expect(v[0]).toBe(87)
    expect(v[41]).toBe(-13.2)
    expect(v[45]).toBe(0.95)
  })
  it('63 and 95 values are scales too; any other count is not', () => {
    expect(parseScaleQr(list(63))).toHaveLength(63)
    expect(parseScaleQr(list(95))).toHaveLength(95)
    for (const n of [1, 62, 65, 94, 96]) expect(parseScaleQr(list(n))).toBeNull()
  })
  it('one element that is not a number throws the whole code out', () => {
    expect(parseScaleQr(SAMPLE_64.replace('87.0', 'abc'))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.replace('87.0', ''))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.replace('87.0', 'NaN'))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.replace('87.0', 'Infinity'))).toBeNull()
  })
  it('without its brackets it is not a scale code', () => {
    expect(parseScaleQr(SAMPLE_64.slice(1))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.slice(0, -1))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.slice(1, -1))).toBeNull()
  })
  it('takes what Java’s Float.parseFloat takes: spaces, an exponent, an f suffix', () => {
    const v = parseScaleQr(SAMPLE_64.replace('87.0,', ' 8.7e1f ,').replace('64.3', '+64.3d'))
    expect(v.slice(0, 2)).toEqual([87, 64.3])
  })
  it('other codes are not scale codes', () => {
    for (const c of ['', null, 'opengym:ex:abc', 'https://lfconnect.com/q?t=c', '[]', '{"a":1}']) expect(parseScaleQr(c)).toBeNull()
  })
})

describe('reading a scan', () => {
  const scan = cleanScan({ v: parseScaleQr(SAMPLE_64) })

  it('the 64-value layout gives back what the app showed', () => {
    expect(readScan(scan)).toEqual({
      weight: 87, leanMass: 64.3, fatMass: 22.7, fatPct: 26.1, muscleMass: 36.2, water: 46.9,
      armRLean: 3.9, armLLean: 4, trunkLean: 29.6, legRLean: 9.2, legLLean: 9,
      armRFat: 1.1, armLFat: 1.1, trunkFat: 13.5, legRFat: 2.9, legLFat: 2.8,
      protein: 13.3, bmr: 1758, bmi: 30.1, height: 170, bioAge: 40,
    })
  })
  it('the numbers agree with each other: weight − fat = lean, the segments’ fat ≈ the body’s', () => {
    const r = readScan(scan)
    expect(r.weight - r.fatMass).toBeCloseTo(r.leanMass, 5)
    expect(Math.abs(r.armRFat + r.armLFat + r.trunkFat + r.legRFat + r.legLFat - r.fatMass)).toBeLessThan(1.5)
  })
  it('a layout not known yet keeps the scan and reads nothing', () => {
    const s95 = cleanScan({ v: parseScaleQr(list(95)) })
    expect(s95.len).toBe(95)
    expect(scanReadable(s95)).toBe(false)
    expect(readScan(s95)).toEqual({})
    expect(scanValue(s95, 'weight')).toBeNull()
  })
  it('a broken stored scan is dropped', () => {
    expect(cleanScan(null)).toBeNull()
    expect(cleanScan({ v: [1, 2, 3] })).toBeNull()
    expect(cleanScan({ v: Array(64).fill('x') })).toBeNull()
    expect(cleanScan({ len: 95, v: Array(64).fill(1) })).toEqual({ len: 64, v: Array(64).fill(1) })
  })
})

describe('showing a scan', () => {
  it('masses in the profile’s unit, the rest in its own', () => {
    expect([scanUnit('muscleMass', 'kg'), scanUnit('muscleMass', 'lb')]).toEqual(['kg', 'lb'])
    expect([scanUnit('fatPct', 'lb'), scanUnit('water', 'lb'), scanUnit('bmr', 'kg'), scanUnit('height', 'lb')]).toEqual(['%', 'L', 'kcal', 'in'])
    expect(scanDisplay('muscleMass', 36.2, 'lb')).toBe(79.8)
    expect(scanDisplay('muscleMass', 36.2, 'kg')).toBe(36.2)
    expect(scanDisplay('fatPct', 26.1, 'lb')).toBe(26.1)
    expect(scanDisplay('height', 170, 'lb')).toBe(66.9)
    expect(scanDisplay('bmr', 1758.4, 'kg')).toBe(1758)
  })
})
