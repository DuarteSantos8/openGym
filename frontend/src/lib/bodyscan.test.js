import { describe, expect, it } from 'vitest'
import { cleanScan, parseScaleQr, readScan, scanDisplay, scanReadable, scanUnit, scanValue } from './bodyscan.js'

// A 64-value code in the layout of docs/BODY_SCALE_QR_IMPORT.md. The numbers are made up (they
// still add up: weight − fat = lean); the positions are the ones confirmed on a real measurement.
const SAMPLE_64 = '[78.4,60.5,17.9,22.8,33.1,44.6,81.0,1.2,1.1,1.2,0.0,0.1,1.6,1.7,1.6,1.4,1.3,2.0,2.1,3.4,3.3,27.4,8.6,8.5,0.9,1.0,10.6,2.4,2.3,39.0,7.0,3.6,26.9,15.8,12.4,1690.0,25.3,69.2,131.0,228.0,117.0,-9.8,-9.8,0.0,63.1,0.91,176.0,7.9,15.8,2.6,4.5,10.2,14.1,12.6,15.4,20.5,25.0,18.3,31.6,4.3,14.0,34.0,4.0,4.0]'
const list = n => '[' + Array.from({ length: n }, (_, i) => i / 10).join(',') + ']'

describe('parseScaleQr', () => {
  it('reads the scale’s code, every number in its place', () => {
    const v = parseScaleQr(SAMPLE_64)
    expect(v).toHaveLength(64)
    expect(v[0]).toBe(78.4)
    expect(v[41]).toBe(-9.8)
    expect(v[45]).toBe(0.91)
  })
  it('63 and 95 values are scales too; any other count is not', () => {
    expect(parseScaleQr(list(63))).toHaveLength(63)
    expect(parseScaleQr(list(95))).toHaveLength(95)
    for (const n of [1, 62, 65, 94, 96]) expect(parseScaleQr(list(n))).toBeNull()
  })
  it('one element that is not a number throws the whole code out', () => {
    expect(parseScaleQr(SAMPLE_64.replace('78.4', 'abc'))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.replace('78.4', ''))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.replace('78.4', 'NaN'))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.replace('78.4', 'Infinity'))).toBeNull()
  })
  it('without its brackets it is not a scale code', () => {
    expect(parseScaleQr(SAMPLE_64.slice(1))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.slice(0, -1))).toBeNull()
    expect(parseScaleQr(SAMPLE_64.slice(1, -1))).toBeNull()
  })
  it('takes what Java’s Float.parseFloat takes: spaces, an exponent, an f suffix', () => {
    const v = parseScaleQr(SAMPLE_64.replace('78.4,', ' 7.84e1f ,').replace('60.5', '+60.5d'))
    expect(v.slice(0, 2)).toEqual([78.4, 60.5])
  })
  it('other codes are not scale codes', () => {
    for (const c of ['', null, 'opengym:ex:abc', 'https://lfconnect.com/q?t=c', '[]', '{"a":1}']) expect(parseScaleQr(c)).toBeNull()
  })
})

describe('reading a scan', () => {
  const scan = cleanScan({ v: parseScaleQr(SAMPLE_64) })

  it('the 64-value layout puts every value in its place', () => {
    expect(readScan(scan)).toEqual({
      weight: 78.4, leanMass: 60.5, fatMass: 17.9, fatPct: 22.8, muscleMass: 33.1, water: 44.6,
      armRLean: 3.4, armLLean: 3.3, trunkLean: 27.4, legRLean: 8.6, legLLean: 8.5,
      armRFat: 0.9, armLFat: 1, trunkFat: 10.6, legRFat: 2.4, legLFat: 2.3,
      protein: 12.4, bmr: 1690, bmi: 25.3, height: 176, bioAge: 34,
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
    expect(scanDisplay('muscleMass', 33.1, 'lb')).toBe(73)
    expect(scanDisplay('muscleMass', 33.1, 'kg')).toBe(33.1)
    expect(scanDisplay('fatPct', 22.8, 'lb')).toBe(22.8)
    expect(scanDisplay('height', 176, 'lb')).toBe(69.3)
    expect(scanDisplay('bmr', 1690.4, 'kg')).toBe(1690)
  })
})
