import { describe, expect, it } from 'vitest'
import {
  kgFromStored,
  storedFromKg,
  unitRound,
  migrateWorkoutsToKg,
  kgBodyweight,
} from './units.js'

const LB_TO_KG = 0.45359237

const legacyWorkouts = () => [{
  id: 'workout-1',
  unit: 'lb',
  bw: 180,
  bodyweight: [{ d: '2026-01-01', w: 180, unit: 'lb' }],
  entries: [{
    id: 'squat',
    unit: 'lb',
    topW: 200,
    fallbackWeight: 150,
    sets: [
      { phase: 'warmup', w: 50 },
      { phase: 'work', w: 200, r: 5, done: true },
    ],
    warmup: [{ unit: 'lb', w: 40, r: 8, done: true }],
    target: {
      unit: 'lb',
      weight: 200,
      weightPrescription: { unit: 'lb', fallbackWeight: 175 },
      warmup: [{
        unit: 'lb',
        weight: 50,
        weightPrescription: { unit: 'lb', fallbackWeight: 25 },
      }],
    },
    plan: { unit: 'lb', weight: 180, fallbackWeight: 160 },
  }],
}]

describe('canonical weight conversions', () => {
  it('converts stored pounds to kilograms with the specified factor', () => {
    expect(kgFromStored(100, 'lb')).toBe(100 * LB_TO_KG)
    expect(kgFromStored(60, 'kg')).toBe(60)
  })

  it('round-trips kilograms through pounds without display rounding', () => {
    const kg = 60
    const stored = storedFromKg(kg, 'lb')
    expect(kgFromStored(stored, 'lb')).toBeCloseTo(kg, 12)
    expect(storedFromKg(kg, 'kg')).toBe(kg)
  })

  it('rounds display values to the profile unit precision', () => {
    expect(unitRound(62.24, 'kg')).toBe(62)
    expect(unitRound(62.26, 'kg')).toBe(62.5)
    expect(unitRound(132.49, 'lb')).toBe(132)
    expect(unitRound(132.5, 'lb')).toBe(133)
  })

  it('keeps an already-canonical bodyweight in kilograms', () => {
    expect(kgBodyweight(72.5, 'kg')).toBe(72.5)
    expect(kgBodyweight(72.5, 'lb')).toBe(72.5)
  })
})

describe('workout migration', () => {
  it('converts legacy pounds across workout, bodyweight, target, warm-up, and prescription fields', () => {
    const source = legacyWorkouts()
    const migrated = migrateWorkoutsToKg(source)
    const workout = migrated[0]
    const entry = workout.entries[0]

    expect(workout.bw).toBe(180 * LB_TO_KG)
    expect(workout.bodyweight[0].w).toBe(180 * LB_TO_KG)
    expect(entry.topW).toBe(200 * LB_TO_KG)
    expect(entry.fallbackWeight).toBe(150 * LB_TO_KG)
    expect(entry.sets.map(set => set.w)).toEqual([50 * LB_TO_KG, 200 * LB_TO_KG])
    expect(entry.warmup[0].w).toBe(40 * LB_TO_KG)
    expect(entry.target.weight).toBe(200 * LB_TO_KG)
    expect(entry.target.weightPrescription.fallbackWeight).toBe(175 * LB_TO_KG)
    expect(entry.target.warmup[0].weight).toBe(50 * LB_TO_KG)
    expect(entry.target.warmup[0].weightPrescription.fallbackWeight).toBe(25 * LB_TO_KG)
    expect(entry.plan.weight).toBe(180 * LB_TO_KG)
    expect(entry.plan.fallbackWeight).toBe(160 * LB_TO_KG)
  })

  it('returns a new array without mutating the source and is idempotent', () => {
    const source = legacyWorkouts()
    const migrated = migrateWorkoutsToKg(source)

    expect(migrated).not.toBe(source)
    expect(source[0].entries[0].sets[0].w).toBe(50)
    expect(migrateWorkoutsToKg(migrated)).toEqual(migrated)
  })

  it('leaves unannotated kg-era values numerically unchanged and removes consumed stamps', () => {
    const source = [{
      unit: 'kg',
      entries: [{
        unit: 'kg',
        sets: [{ w: 60, unit: 'kg', r: 5 }],
        target: { unit: 'kg', weight: 60 },
      }],
    }]
    const migrated = migrateWorkoutsToKg(source)

    expect(migrated[0].entries[0].sets[0].w).toBe(60)
    expect(migrated[0].entries[0].target.weight).toBe(60)
    expect(migrated[0].unit).toBeUndefined()
    expect(migrated[0].entries[0].unit).toBeUndefined()
    expect(migrated[0].entries[0].sets[0].unit).toBeUndefined()
  })
})
