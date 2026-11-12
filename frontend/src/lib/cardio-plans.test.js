import { describe, expect, it } from 'vitest'
import {
  PLANS_MAX, PLAN_MAX_SEGMENTS, newPlan, normalizePlan, normalizeSegment, parsePlanText, planById, planMinutes,
  planToSets, plansOf, removePlan, savePlan, setsToSegments,
} from './cardio-plans.js'

const MIRROR = `➡️ Minutos 0–3
Inclinação: 4
Velocidade: 5,0 km/h

➡️ Minutos 3–6
Inclinação: 7
Velocidade: 5,4 km/h

➡️ Minutos 6–9
Inclinação: 10
Velocidade: 5,6 km/h

➡️ Minutos 9–12
Inclinação: 13
Velocidade: 5,2 km/h

➡️ Minutos 12–15
Inclinação: 8
Velocidade: 5,8 km/h

➡️ Minutos 15–18
Inclinação: 12
Velocidade: 5,3 km/h


➡️ Minutos 18–21
Inclinação: 6
Velocidade: 5,8 km/h`

describe('normalizeSegment', () => {
  it('keeps whole minutes, a tenth of km/h and a grade on the half percent', () => {
    expect(normalizeSegment({ min: '3', speed: 5.04, incline: 4.3 })).toEqual({ min: 3, speed: 5, incline: 4.5 })
  })
  it('leaves a flat grade out instead of storing a 0', () => {
    expect(normalizeSegment({ min: 3, speed: 5, incline: 0 })).toEqual({ min: 3, speed: 5 })
    expect(normalizeSegment({ min: 3, speed: 5, incline: '' })).toEqual({ min: 3, speed: 5 })
  })
  it('refuses a segment with no minutes or no speed, and caps the absurd', () => {
    expect(normalizeSegment({ min: 0, speed: 5 })).toBe(null)
    expect(normalizeSegment({ min: 3, speed: 0 })).toBe(null)
    expect(normalizeSegment(null)).toBe(null)
    expect(normalizeSegment({ min: 9999, speed: 99, incline: 90 })).toEqual({ min: 300, speed: 40, incline: 40 })
  })
})

describe('normalizePlan and the store helpers', () => {
  it('needs an id, a name and at least one good segment', () => {
    expect(normalizePlan({ id: 'a', name: ' ', segments: [{ min: 3, speed: 5 }] })).toBe(null)
    expect(normalizePlan({ id: 'a', name: 'X', segments: [{ min: 0, speed: 5 }] })).toBe(null)
    expect(normalizePlan({ name: 'X', segments: [{ min: 3, speed: 5 }] })).toBe(null)
    expect(normalizePlan({ id: 'a', name: '  Hill   walk ', at: 5, segments: [{ min: 3, speed: 5 }, { min: 0 }] }))
      .toEqual({ id: 'a', name: 'Hill walk', at: 5, segments: [{ min: 3, speed: 5 }] })
  })
  it('caps the segments of a plan', () => {
    const many = Array.from({ length: 60 }, () => ({ min: 1, speed: 5 }))
    expect(normalizePlan({ id: 'a', name: 'X', segments: many }).segments).toHaveLength(PLAN_MAX_SEGMENTS)
  })
  it('saves, lists newest first, finds and removes', () => {
    const s = {}
    const a = savePlan(s, newPlan('Old', [{ min: 5, speed: 5 }], 1))
    const b = savePlan(s, newPlan('New', [{ min: 5, speed: 6 }], 2))
    expect(plansOf(s).map(p => p.name)).toEqual(['New', 'Old'])
    expect(planById(s, a.id).name).toBe('Old')
    expect(removePlan(s, a.id)).toBe(true)
    expect(removePlan(s, a.id)).toBe(false)
    expect(Object.keys(s.cardioPlans)).toEqual([b.id])
  })
  it('saving over an id replaces that plan, and the cap drops the oldest', () => {
    const s = {}
    const first = savePlan(s, newPlan('One', [{ min: 5, speed: 5 }], 1))
    savePlan(s, { ...first, name: 'Renamed' })
    expect(plansOf(s)).toHaveLength(1)
    expect(plansOf(s)[0].name).toBe('Renamed')
    for (let i = 0; i < PLANS_MAX + 5; i++) savePlan(s, newPlan('P' + i, [{ min: 5, speed: 5 }], 10 + i))
    expect(plansOf(s)).toHaveLength(PLANS_MAX)
    expect(plansOf(s).some(p => p.name === 'Renamed')).toBe(false)
  })
  it('refuses to save a plan that holds nothing, and reads a damaged map as empty', () => {
    const s = {}
    expect(savePlan(s, { id: 'a', name: 'X', segments: [] })).toBe(null)
    expect(s.cardioPlans).toBeUndefined()
    expect(plansOf({ cardioPlans: [1, 2] })).toEqual([])
    expect(plansOf({ cardioPlans: { a: 'nope', b: { id: 'b', name: 'Ok', segments: [{ min: 2, speed: 4 }] } } })).toHaveLength(1)
  })
})

describe('plans as sets and back', () => {
  const plan = { id: 'a', name: 'Hills', at: 0, segments: [{ min: 3, speed: 5, incline: 4 }, { min: 3, speed: 5.4 }] }
  it('writes one undone set per segment, with the grade only when asked', () => {
    expect(planToSets(plan)).toEqual([{ min: 3, speed: 5, incline: 4, done: false }, { min: 3, speed: 5.4, done: false }])
    expect(planToSets(plan, { withIncline: false })).toEqual([{ min: 3, speed: 5, done: false }, { min: 3, speed: 5.4, done: false }])
  })
  it('reads an exercise rows back into segments and adds the minutes up', () => {
    const sets = [{ min: 10, speed: 5, incline: 2, done: true }, { min: 0, speed: 5 }, { min: 5, speed: 6, done: false }]
    expect(setsToSegments(sets)).toEqual([{ min: 10, speed: 5, incline: 2 }, { min: 5, speed: 6 }])
    expect(planMinutes(plan)).toBe(6)
  })
})

describe('parsePlanText', () => {
  it('reads the minute-range blocks a plan is usually written in', () => {
    const { segments, skipped } = parsePlanText(MIRROR)
    expect(skipped).toBe(0)
    expect(segments).toHaveLength(7)
    expect(segments[0]).toEqual({ min: 3, speed: 5, incline: 4 })
    expect(segments[3]).toEqual({ min: 3, speed: 5.2, incline: 13 })
    expect(segments[6]).toEqual({ min: 3, speed: 5.8, incline: 6 })
    expect(segments.reduce((n, g) => n + g.min, 0)).toBe(21)
  })
  it('reads the one-line form the set list prints, in any language of it', () => {
    const text = '3 min @ 5 km/h · 4% de inclinação\n3 min @ 5,5 km/h · 5% incline\n10 min @ 6 km/h'
    expect(parsePlanText(text).segments).toEqual([
      { min: 3, speed: 5, incline: 4 }, { min: 3, speed: 5.5, incline: 5 }, { min: 10, speed: 6 },
    ])
  })
  it('reads English labels', () => {
    const { segments } = parsePlanText('Minutes 0-5\nIncline: 3\nSpeed: 4.8 km/h\nMinutes 5-10\nSpeed: 5 km/h')
    expect(segments).toEqual([{ min: 5, speed: 4.8, incline: 3 }, { min: 5, speed: 5 }])
  })
  it('converts mph, and takes a speed with no unit in the profile one', () => {
    expect(parsePlanText('5 min @ 3 mph').segments[0].speed).toBe(4.8)
    expect(parsePlanText('Minutos 0-5\nVelocidade: 3', { speedUnit: 'mph' }).segments[0].speed).toBe(4.8)
    expect(parsePlanText('Minutos 0-5\nVelocidade: 3').segments[0].speed).toBe(3)
  })
  it('counts what it could not read instead of guessing', () => {
    const { segments, skipped } = parsePlanText('Minutos 0-3\nInclinação: 4\n\nMinutos 3-3\nVelocidade: 5 km/h\n\nMinutos 3-6\nVelocidade: 5 km/h')
    expect(segments).toEqual([{ min: 3, speed: 5 }])
    expect(skipped).toBe(2)
  })
  it('reads nothing from prose, and caps a long list', () => {
    expect(parsePlanText('Great workout today, walked a lot').segments).toEqual([])
    expect(parsePlanText('').segments).toEqual([])
    const long = Array.from({ length: 50 }, () => '2 min @ 5 km/h').join('\n')
    const r = parsePlanText(long)
    expect(r.segments).toHaveLength(PLAN_MAX_SEGMENTS)
    expect(r.tooMany).toBe(true)
  })
})
