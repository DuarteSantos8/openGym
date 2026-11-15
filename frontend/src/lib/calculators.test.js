import { describe, expect, it } from 'vitest'
import { percentTable, rpePercent, rpeLoad, e1rmFromRpe, dots, wilks, ipfGl, bmi, bmiBand, ffmi, navyBodyFat, pace, timeAt, fmtClock, parseClock, RACES } from './calculators.js'

describe('strength scores against published values', () => {
  it('DOTS: men 100 kg has the coefficient 0.6155 (500 / 812.33)', () => {
    expect(dots(1000, 100)).toBeCloseTo(615.5, 0)
    expect(dots(600, 100)).toBeCloseTo(369.3, 0)
    // Women weigh in on their own polynomial.
    expect(dots(1000, 60, 'female')).toBeGreaterThan(dots(1000, 60))
  })
  it('Wilks (1994): men 100 kg 0.6086, men 75 kg 0.7126', () => {
    expect(wilks(1000, 100)).toBeCloseTo(608.6, 0)
    expect(wilks(1000, 75)).toBeCloseTo(712.6, 0)
  })
  it('IPF GL classic: 700 kg at 100 kg is 88.4 points', () => {
    expect(ipfGl(700, 100)).toBeCloseTo(88.43, 1)
    expect(ipfGl(400, 60, 'female')).toBeCloseTo(90.4, 0)
  })
  it('clamps body weight to the fitted range and refuses nonsense', () => {
    expect(dots(500, 250)).toBe(dots(500, 210))
    expect(dots(0, 80)).toBeNull()
    expect(wilks(500, -1)).toBeNull()
    expect(ipfGl(null, 80)).toBeNull()
  })
})

describe('body calculators', () => {
  it('BMI: 80 kg at 1.80 m is 24.7, normal', () => {
    expect(bmi(80, 180)).toBe(24.7)
    expect(bmiBand(24.7)).toBe('normal')
    expect(bmiBand(18.4)).toBe('under')
    expect(bmiBand(29.9)).toBe('over')
    expect(bmiBand(30)).toBe('obese')
  })
  it('FFMI: 80 kg, 1.80 m, 15 % is 68 kg lean, FFMI 21.0', () => {
    expect(ffmi(80, 180, 15)).toEqual({ lean: 68, ffmi: 21, normalized: 21 })
    // Shorter than 1.80 m adds to the normalised value.
    expect(ffmi(70, 170, 12).normalized).toBeGreaterThan(ffmi(70, 170, 12).ffmi)
  })
  it('Navy: the metric form agrees with the inch form (70 in, neck 15, waist 34 → 17.5 %)', () => {
    const inch = 86.010 * Math.log10(34 - 15) - 70.041 * Math.log10(70) + 36.76
    expect(inch).toBeCloseTo(17.5, 1)
    expect(navyBodyFat({ heightCm: 70 * 2.54, neckCm: 15 * 2.54, waistCm: 34 * 2.54 })).toBeCloseTo(inch, 0)
    // Women: 163.205·log10(waist+hip−neck) − 97.684·log10(height) − 78.387 (inches).
    const w = { h: 65, n: 13, wa: 30, hi: 40 }
    const fInch = 163.205 * Math.log10(w.wa + w.hi - w.n) - 97.684 * Math.log10(w.h) - 78.387
    expect(navyBodyFat({ sex: 'female', heightCm: w.h * 2.54, neckCm: w.n * 2.54, waistCm: w.wa * 2.54, hipCm: w.hi * 2.54 })).toBeCloseTo(fInch, 0)
  })
  it('Navy says nothing when the tape does not add up', () => {
    expect(navyBodyFat({ heightCm: 180, neckCm: 40, waistCm: 38 })).toBeNull()
    expect(navyBodyFat({ sex: 'female', heightCm: 165, neckCm: 33, waistCm: 75 })).toBeNull()
  })
})

describe('% of 1RM and RPE', () => {
  it('rounds every percentage down to the gym grid, with the reps it is good for', () => {
    const rows = percentTable(140, { grid: 2.5 })
    expect(rows[0]).toMatchObject({ pct: 100, w: 140, reps: 1 })
    expect(rows.find(r => r.pct === 85)).toMatchObject({ raw: 119, w: 117.5, reps: 5 })
    expect(rows.find(r => r.pct === 40).reps).toBeNull()
    // A function grid is the gym's own plates (plates.js dropGrid).
    expect(percentTable(100, { grid: x => Math.floor(x / 5) * 5 }).find(r => r.pct === 85).w).toBe(85)
    expect(percentTable(0)).toEqual([])
  })
  it('reads the RTS chart: 5 @ 8 is 81.1 %, 1 @ 10 is 100 %, halves in between', () => {
    expect(rpePercent(1, 10)).toBe(100)
    expect(rpePercent(5, 8)).toBe(81.1)
    expect(rpePercent(3, 8.5)).toBe(87.8)
    expect(rpePercent(15, 6)).toBeNull()
    expect(rpePercent(5, 5)).toBeNull()
    expect(rpeLoad(150, 5, 8)).toEqual({ pct: 81.1, raw: 121.65, w: 120 })
    expect(e1rmFromRpe(120, 5, 8)).toBeCloseTo(148, 0)
  })
})

describe('pace', () => {
  it('turns distance and time into pace and speed, and back', () => {
    const p = pace(10, 50 * 60)
    expect(p.secPer).toBe(300)
    expect(p.speed).toBe(12)
    expect(fmtClock(timeAt(RACES[3].km, 300))).toBe('3:30:59')
    expect(fmtClock(300)).toBe('5:00')
    expect(pace(0, 100)).toBeNull()
  })
  it('reads a clock the way people type one', () => {
    expect(parseClock('25:30')).toBe(1530)
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('45')).toBe(2700)
    expect(parseClock('4,5')).toBe(270)
    expect(parseClock('a:b')).toBeNull()
    expect(parseClock('')).toBeNull()
  })
})
