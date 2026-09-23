import { describe, it, expect } from 'vitest'
import { convertWeight, convertStateUnit } from './units.js'
import { workoutVolume } from './history.js'

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
    exWeights: { '0025': { w: 80, d: '2026-01-01' }, legacy: 100 }, barWeights: { '0025': 20 },
    routines: [{ id: 'r', ex: [{ id: '0025', sets: 3, reps: 5, weight: 80, inc: 2.5, warmup: [{ weight: 40, reps: 8 }] }, { id: 'plank', mode: 'time', sec: 30, inc: 5 }] }],
    workouts: [{ id: 'w', entries: [{ id: '0025', topW: 80, target: { weight: 80 }, sets: [{ w: 80, r: 5, done: true, drops: [{ w: 60, r: 5 }] }] }] }],
    active: { id: 'a', entries: [{ id: '0025', sets: [{ w: 82.5, r: 5, done: false }] }] },
    workoutView: 'list',
  }
  it('converts every stored weight and keeps everything else', () => {
    const out = convertStateUnit(S, 'lb')
    expect(out.unit).toBe('lb')
    expect(out.targetW).toBe(176.4)                 // body weight keeps its 0.1, see below
    expect(out.bodyweight[0]).toEqual({ d: '2026-01-01', w: 181.7, t: 1 })
    expect(out.exWeights['0025'].w).toBe(176.5)
    expect(out.exWeights.legacy).toBe(220.5)
    expect(out.barWeights['0025']).toBe(44)
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
  // History rows, the detail header, the month calendar and the heatmap tooltips read the
  // cached `vol` and `bw` off the saved workout rather than summing sets, so a conversion that
  // skips them shows kg totals under an lb label (QA C11).
  it('converts each workout\'s cached volume and session body weight, and the active session\'s (QA C11)', () => {
    const drop = { id: '0025', sets: [{ w: 80, r: 5, done: true, type: 'dropset', drops: [{ w: 60, r: 5 }] }, { w: 40, r: 8, done: true, phase: 'warmup' }] }
    const state = { ...S,
      workouts: [{ id: 'w', vol: 700, bw: 82.4, entries: [drop] }, { id: 'x', entries: [] }],
      active: { ...S.active, bw: 82.4 } }
    const out = convertStateUnit(state, 'lb')
    // 176.5 × 5 plus the 132.5 × 5 drop, warm-up left out — what the converted set list adds up to.
    expect(out.workouts[0].vol).toBe(1545)
    expect(workoutVolume(out.workouts[0])).toBe(1545)
    expect(out.workouts[0].bw).toBe(181.7)
    expect(out.active.bw).toBe(181.7)
    // A workout that never had a cached volume does not grow one.
    expect(out.workouts[1]).not.toHaveProperty('vol')
    expect(state.workouts[0].vol).toBe(700)          // the input is not mutated
  })
  // Body weight is weighed in and edited at 0.1, not loaded on a bar: rounding it to plate steps
  // moved 22 of 24 weigh-ins on a kg → lb → kg round trip (QA C15). The goal weight is one too.
  it('keeps body weight at 0.1 resolution and brings a kg → lb → kg round trip home (QA C15)', () => {
    const state = { unit: 'kg', targetW: 77, bodyweight: [78.6, 82.1, 82.2, 81.8, 81.4].map((w, i) => ({ d: `2026-01-0${i + 1}`, w, t: i })),
      workouts: [{ id: 'w', bw: 78.6, entries: [] }], active: { id: 'a', bw: 78.6, entries: [] } }
    const lb = convertStateUnit(state, 'lb')
    expect(lb.bodyweight.map(b => b.w)).toEqual([173.3, 181, 181.2, 180.3, 179.5])
    expect(lb.targetW).toBe(169.8)
    const back = convertStateUnit(lb, 'kg')
    expect(back.bodyweight.map(b => b.w)).toEqual([78.6, 82.1, 82.2, 81.8, 81.4])
    expect(back.targetW).toBe(77)
    expect(back.workouts[0].bw).toBe(78.6)
    expect(back.active.bw).toBe(78.6)
  })
})
