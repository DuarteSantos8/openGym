import { describe, it, expect } from 'vitest'
import { convertWeight, convertStateUnit } from './units.js'

describe('convertWeight', () => {
  it('rounds lb to a half and kg to a quarter', () => {
    expect(convertWeight(60, 'kg', 'lb')).toBe(132.5)
    expect(convertWeight(135, 'lb', 'kg')).toBe(61.25)
    expect(convertWeight(2.5, 'kg', 'lb')).toBe(5.5)
  })
  it('leaves the value alone for the same unit, nothing, or garbage', () => {
    expect(convertWeight(60, 'kg', 'kg')).toBe(60)
    expect(convertWeight(null, 'kg', 'lb')).toBe(null)
    expect(convertWeight('', 'kg', 'lb')).toBe('')
    expect(convertWeight('abc', 'kg', 'lb')).toBe('abc')
  })
  it('round-trips plate-loadable numbers', () => {
    for (const kg of [20, 42.5, 60, 100, 142.5]) {
      expect(convertWeight(convertWeight(kg, 'kg', 'lb'), 'lb', 'kg')).toBe(kg)
    }
  })
})

describe('convertStateUnit', () => {
  const S = {
    unit: 'kg', targetW: 80, bodyweight: [{ d: '2026-01-01', w: 82.4, t: 1 }],
    exWeights: { '0025': { w: 80, d: '2026-01-01' }, legacy: 100 }, barWeights: { '0025': 15 },
    routines: [{ id: 'r', ex: [{ id: '0025', sets: 3, reps: 5, weight: 80, inc: 2.5, warmup: [{ weight: 40, reps: 8 }] }, { id: 'plank', mode: 'time', sec: 30, inc: 5 }] }],
    workouts: [{ id: 'w', entries: [{ id: '0025', topW: 80, target: { weight: 80 }, sets: [{ w: 80, r: 5, done: true, drops: [{ w: 60, r: 5 }] }] }] }],
    active: { id: 'a', entries: [{ id: '0025', sets: [{ w: 82.5, r: 5, done: false }] }] },
    workoutView: 'list',
  }
  it('converts every stored weight and keeps everything else', () => {
    const out = convertStateUnit(S, 'lb')
    expect(out.unit).toBe('lb')
    expect(out.targetW).toBe(176.5)
    expect(out.bodyweight[0]).toEqual({ d: '2026-01-01', w: 181.5, t: 1 })
    expect(out.exWeights['0025'].w).toBe(176.5)
    expect(out.exWeights.legacy).toBe(220.5)
    expect(out.barWeights['0025']).toBe(33)     // a custom 15 kg bar is the 33 lb bar
    expect(out.routines[0].ex[0]).toMatchObject({ weight: 176.5, inc: 5.5, warmup: [{ weight: 88, reps: 8 }] })
    expect(out.routines[0].ex[1]).toEqual({ id: 'plank', mode: 'time', sec: 30, inc: 5 })   // seconds stay seconds
    expect(out.workouts[0].entries[0]).toMatchObject({ topW: 176.5, target: { weight: 176.5 } })
    expect(out.workouts[0].entries[0].sets[0]).toMatchObject({ w: 176.5, done: true, drops: [{ w: 132.5, r: 5 }] })
    expect(out.active.entries[0].sets[0].w).toBe(182)
    expect(out.workoutView).toBe('list')
    expect(S.unit).toBe('kg')                       // the input is not mutated
    expect(S.workouts[0].entries[0].sets[0].w).toBe(80)
  })
  it('is a no-op for the unit already in use', () => {
    expect(convertStateUnit(S, 'kg')).toBe(S)
  })
})

describe('convertStateUnit: bar weights', () => {
  // 0025 barbell bench press (barbell), 1344 an EZ-bar exercise, 1383 a sled (not a bar).
  const conv = (barWeights, from, to) => convertStateUnit({ unit: from, barWeights }, to).barWeights

  it('an override equal to the old default drops out, so the new default applies (45 lb IS the 20 kg bar)', () => {
    expect(conv({ '0025': 45 }, 'lb', 'kg')).toEqual({})
    expect(conv({ '0025': 20 }, 'kg', 'lb')).toEqual({})
    expect(conv({ 1344: 25 }, 'lb', 'kg')).toEqual({})        // EZ bar 25 lb ↔ 10 kg
    expect(conv({ 1344: 10 }, 'kg', 'lb')).toEqual({})
  })

  it('an explicit 0 ("no bar") stays 0', () => {
    expect(conv({ '0025': 0 }, 'lb', 'kg')).toEqual({ '0025': 0 })
    expect(conv({ '0025': 0 }, 'kg', 'lb')).toEqual({ '0025': 0 })
  })

  it('a custom bar converts like any weight, and drops out when it lands on the new default', () => {
    expect(conv({ '0025': 33 }, 'lb', 'kg')).toEqual({ '0025': 15 })      // women's bar
    expect(conv({ '0025': 15 }, 'kg', 'lb')).toEqual({ '0025': 33 })
    expect(conv({ '0025': 44 }, 'lb', 'kg')).toEqual({})                  // 44 lb → 20 kg = the kg default
    expect(conv({ 1383: 100 }, 'lb', 'kg')).toEqual({ 1383: 45.25 })      // a sled's own weight is not a bar
    expect(conv({ 'no-such-id': 45 }, 'lb', 'kg')).toEqual({ 'no-such-id': 20.5 })
  })

  it('junk in the map is dropped', () => {
    expect(conv({ '0025': '45', 1344: -1, 1383: null }, 'lb', 'kg')).toEqual({})
  })
})

