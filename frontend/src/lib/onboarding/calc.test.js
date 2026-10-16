// The live ring's estimate, the units, the starter plans and the thread's geometry.
import { describe, expect, it } from 'vitest'
import { estimateRange } from './estimate.js'
import { moveSession, starterSessions, suggestedDays, templateFor } from './plans.js'
import { checkP, dOf, evalAt, lineP, mixColour, planBetween, seg, EASE } from './thread-geometry.js'
import { heightFrom, heightTo, localeUnits, parseHeight, parseWeight, weightFrom, weightTo, yearRange } from './units.js'

const now = new Date('2026-10-15T12:00:00Z')
const body = (o = {}) => ({ sex: null, birthYear: null, heightCm: null, weightKg: null, ...o })

describe('the live target estimate', () => {
  it('narrows with every answer and collapses to one number with all four', () => {
    const a = estimateRange({ goal: 'keep', body: body() }, now)
    const b = estimateRange({ goal: 'keep', body: body({ sex: 'female' }) }, now)
    const c = estimateRange({ goal: 'keep', body: body({ sex: 'female', birthYear: 1990, heightCm: 168 }) }, now)
    const d = estimateRange({ goal: 'keep', body: body({ sex: 'female', birthYear: 1990, heightCm: 168, weightKg: 64 }) }, now)
    expect([a.answered, b.answered, c.answered, d.answered]).toEqual([0, 1, 3, 4])
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo)
    expect(c.hi - c.lo).toBeLessThan(b.hi - b.lo)
    expect(d.lo).toBe(d.hi)
    // The hub's formula for this person: BMR 6.25·168 + 9.99·64 − 4.92·36 − 161 = 1351.2, × 1.2
    // seated = 1621, rounded to 50.
    expect(d.lo).toBe(1600)
  })

  it('takes the goal and the training days into the number', () => {
    const who = body({ sex: 'male', birthYear: 1990, heightCm: 180, weightKg: 80 })
    const keep = estimateRange({ goal: 'keep', body: who }, now).lo
    expect(estimateRange({ goal: 'build', body: who }, now).lo).toBeGreaterThan(keep)
    expect(estimateRange({ goal: 'lose', body: who }, now).lo).toBeLessThan(keep)
    expect(estimateRange({ goal: 'keep', body: who, trainingDays: 4 }, now).lo).toBeGreaterThan(keep)
  })
})

describe('units', () => {
  it('come from the locale: imperial for the US, Liberia and Myanmar', () => {
    expect(localeUnits('en-US')).toEqual({ weight: 'lb', height: 'ft', source: 'locale' })
    expect(localeUnits('en-GB')).toEqual({ weight: 'kg', height: 'cm', source: 'locale' })
    expect(localeUnits('my')).toMatchObject({ weight: 'lb' })
  })

  it('convert both ways, half kilos and whole pounds and inches', () => {
    expect(heightTo(170, 'ft')).toBe(67)
    expect(heightFrom(67, 'ft')).toBe(170)
    expect(weightTo(70.3, 'kg')).toBe(70.5)
    expect(weightTo(70, 'lb')).toBe(154)
    expect(weightFrom(154, 'lb')).toBe(69.9)
  })

  it('read what is typed: feet and inches several ways, a decimal comma', () => {
    expect(parseHeight('5.7', 'ft')).toBe(67)
    expect(parseHeight("5'7", 'ft')).toBe(67)
    expect(parseHeight('5', 'ft')).toBe(60)
    expect(parseHeight('67', 'ft')).toBe(67)
    expect(parseHeight('172 cm', 'cm')).toBe(172)
    expect(parseHeight('tall', 'cm')).toBeNull()
    expect(parseWeight('72,5')).toBe(72.5)
    expect(parseWeight('heavy')).toBeNull()
    expect(yearRange(now)).toEqual({ min: 1926, max: 2011, start: 1990 })
  })
})

describe('starter plans', () => {
  it('has a plan for 1 to 6 days and none for 0', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(templateFor)).toEqual([null, 'full-body-2', 'full-body-2', 'full-body', 'upper-lower', 'upper-lower-ppl', 'ppl-6'])
    for (const d of [1, 2, 3, 4, 5, 6]) {
      expect(suggestedDays(d)).toHaveLength(d)
      expect(starterSessions(d)).toHaveLength(d)
    }
    expect(suggestedDays(0)).toEqual([])
  })

  it('fits the sessions to the equipment', () => {
    const gym = starterSessions(3, 'gym').flatMap(s => s.exercises.map(e => e.ex?.eq))
    const none = starterSessions(3, 'none').flatMap(s => s.exercises.map(e => e.ex?.eq))
    expect(gym.some(eq => eq !== 'body weight')).toBe(true)
    expect(none.every(eq => eq === 'body weight')).toBe(true)
  })

  it('moves a session to a free day, and selects the session on a day that has one', () => {
    expect(moveSession([1, 3, 5], 0, 2)).toEqual({ weekdays: [2, 3, 5], sel: 0 })
    expect(moveSession([1, 3, 5], 0, 5)).toEqual({ weekdays: [1, 3, 5], sel: 2 })
  })
})

describe('the thread\'s geometry', () => {
  it('writes every form as one path of 13 points', () => {
    const line = lineP(0, 10, 100, 10)
    expect(line).toHaveLength(26)
    expect(dOf(line).match(/C/g)).toHaveLength(4)
    expect(checkP([0, 0], [10, 10], [30, -10])).toHaveLength(26)
  })

  it('lerps from the start to the target, and the colour through the anchors\' own', () => {
    const base = { p: lineP(0, 0, 100, 0), w: 1.5, c: 'var(--a)', o: 1 }
    const to = { p: lineP(0, 50, 100, 50), w: 2.5, c: 'var(--b)' }
    const segs = [seg(0, 100, k => k, to)]
    expect(evalAt(base, segs, 0).p[1]).toBe(0)
    expect(evalAt(base, segs, 50).p[1]).toBe(25)
    const end = evalAt(base, segs, 100)
    expect(end.p[1]).toBe(50)
    expect(end.w).toBe(2.5)
    expect(end.c).toBe('var(--b)')
    expect(mixColour('var(--a)', 'var(--b)', 0.5)).toBe('color-mix(in srgb, var(--b) 50.0%, var(--a))')
  })

  it('times each hand-off by form, and holds still when the floors coincide', () => {
    const at = (form, y, c = 'x') => ({ form, p: lineP(16, y, 304, y), w: 1.5, c })
    expect(planBetween(at('blade', 50), at('check', 80))).toMatchObject({ total: 420, arrive: 420 })
    expect(planBetween(at('check', 50), at('line', 80))).toMatchObject({ total: 420 })
    expect(planBetween(at('line', 50), at('blade', 80))).toMatchObject({ total: 360 })
    expect(planBetween(at('line', 128), at('line', 128)).arrive).toBe(0)
    expect(planBetween(at('line', 128), at('line', 90)).arrive).toBe(320)
    expect(EASE(0.5)).toBeGreaterThan(0.5)
  })
})
