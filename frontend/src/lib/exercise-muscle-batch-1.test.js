import { describe, expect, it } from 'vitest'
import { BODYPARTS, EXDB, EXIDX, registerCustom } from './exercises.js'
import { COMPOUND_LIFT_BATCH_1, USER_EXERCISE_MUSCLE_OVERRIDES } from './exercise-muscle-batch-1.js'
import { MUSCLES, musclesOf, muscleWeightsOf } from './muscles.js'

const ids = Object.keys(COMPOUND_LIFT_BATCH_1)
const catalogueIds = new Set(EXDB.map(ex => ex.id))

const duplicateFree = values => values.length === new Set(values).size

describe('compound-lift muscle metadata batch 1', () => {
  it('contains a bounded first batch of compound-lift catalogue entries', () => {
    expect(ids.length).toBeGreaterThanOrEqual(60)
    expect(ids.length).toBeLessThanOrEqual(120)
    expect(ids.every(id => catalogueIds.has(id))).toBe(true)
  })

  it('stores canonical primary and secondary arrays for every batch entry', () => {
    for (const [id, metadata] of Object.entries(COMPOUND_LIFT_BATCH_1)) {
      expect(metadata.primaries.length, id).toBeGreaterThan(0)
      expect(duplicateFree(metadata.primaries), id).toBe(true)
      expect(duplicateFree(metadata.secondaries), id).toBe(true)
      expect(metadata.primaries.some(muscle => metadata.secondaries.includes(muscle)), id).toBe(false)
      expect(metadata.primaries.every(muscle => MUSCLES.includes(muscle)), id).toBe(true)
      expect(metadata.secondaries.every(muscle => MUSCLES.includes(muscle)), id).toBe(true)
      expect(EXIDX[id]).toMatchObject(metadata)
    }
  })

  it('follows the documented ExRx family templates and preserves source-known muscles', () => {
    expect(COMPOUND_LIFT_BATCH_1['0043']).toEqual({
      bp: 'upper legs',
      primaries: ['quadriceps', 'gluteal', 'adductors'],
      secondaries: ['hamstring', 'calves', 'lower-back', 'abs', 'obliques']
    })
    expect(COMPOUND_LIFT_BATCH_1['0032']).toEqual({
      bp: 'full body',
      primaries: ['gluteal', 'hamstring', 'lower-back'],
      secondaries: ['quadriceps', 'adductors', 'calves', 'abs', 'obliques']
    })
    expect(COMPOUND_LIFT_BATCH_1['0025']).toEqual({
      bp: 'chest', primaries: ['chest'], secondaries: ['triceps', 'deltoids', 'biceps']
    })
    expect(COMPOUND_LIFT_BATCH_1['0091']).toEqual({
      bp: 'shoulders', primaries: ['deltoids'],
      secondaries: ['chest', 'triceps', 'trapezius', 'serratus']
    })
    expect(COMPOUND_LIFT_BATCH_1['0027']).toEqual({
      bp: 'back', primaries: ['upper-back'],
      secondaries: ['biceps', 'deltoids', 'forearm']
    })
    expect(COMPOUND_LIFT_BATCH_1['0652']).toEqual({
      bp: 'back', primaries: ['upper-back'], secondaries: ['biceps', 'deltoids', 'forearm']
    })
    expect(musclesOf(EXDB.find(exercise => exercise.id === '0587'))).toMatchObject({ chest: 0.4 })
    expect(musclesOf(EXIDX['0587'])).toMatchObject({ chest: 0.4 })
  })

  it('keeps torso bracing secondary and does not label the twisting press full body', () => {
    expect(COMPOUND_LIFT_BATCH_1['0414']).toEqual({
      bp: 'shoulders', primaries: ['deltoids'], secondaries: ['triceps', 'trapezius', 'abs']
    })
    expect(COMPOUND_LIFT_BATCH_1['1012']).toEqual({
      bp: 'shoulders', primaries: ['deltoids'],
      secondaries: ['triceps', 'trapezius', 'abs', 'obliques']
    })
    expect(COMPOUND_LIFT_BATCH_1['1012'].primaries).not.toContain('abs')
    expect(COMPOUND_LIFT_BATCH_1['1012'].secondaries).toContain('obliques')
  })

  it('marks the cross-region lifts as Full body while keeping classic areas available', () => {
    expect(EXIDX['0069']).toMatchObject({ bp: 'full body', primaries: ['quadriceps', 'gluteal', 'adductors'] })
    expect(EXIDX['0032'].bp).toBe('full body')
    expect(BODYPARTS).toContain('full body')
    expect(EXIDX['0025'].bp).toBe('chest')
    expect(EXIDX['0652'].bp).toBe('back')
  })

  it('lets an explicit user exercise override the batch and restores the catalogue afterward', () => {
    registerCustom([{ id: '0025', n: 'Owner bench correction', bp: 'chest', primaries: ['triceps'], secondaries: [] }])
    expect(EXIDX['0025']).toMatchObject({ primaries: ['triceps'], secondaries: [] })
    registerCustom([])
    expect(EXIDX['0025']).toMatchObject(COMPOUND_LIFT_BATCH_1['0025'])
  })
})

describe('owner-approved zero-credit overrides', () => {
  const cases = [
    [
      ['1429', '1432', '0652', '0651', '0017', '0015', '0970', '0841'],
      { 'upper-back': 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4, triceps: 0 },
    ],
    [
      ['1325', '1347', '2330', '2616', '2736', '3563', '0007', '0150', '0153', '0177', '0198', '0197', '0205', '0245', '0579', '0673', '0818'],
      { 'upper-back': 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4, trapezius: 0.4, triceps: 0 },
    ],
    [
      ['3418'],
      { 'upper-back': 1, abs: 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4, 'hip-flexors': 0.4, triceps: 0 },
    ],
    [
      ['1349', '0606'],
      { 'upper-back': 1, biceps: 0.4, deltoids: 0.4, forearm: 0.4, trapezius: 0.4, chest: 0, triceps: 0 },
    ],
    [
      ['1254', '1256', '1257', '1299', '1300', '1301', '1479', '2144', '3758', '0025', '0033', '0045', '0047', '0122', '0151', '0169', '0289', '0301', '0314', '0748', '0577', '0576'],
      { chest: 1, deltoids: 0.4, triceps: 0.4, biceps: 0 },
    ],
    [['0030', '0751'], { triceps: 1, chest: 0.4, deltoids: 0.4, biceps: 0 }],
    [['2289', '2335', '0738'], { calves: 1, hamstring: 0 }],
    [['1391'], { calves: 1, quadriceps: 0.4, hamstring: 0 }],
    [['2334', '1392'], { calves: 1, gluteal: 0.4, hamstring: 0 }],
    [['0597', '3006'], { gluteal: 1, hamstring: 0 }],
    [
      ['1425', '1463', '1464', '2287', '2611', '0739', '0741', '0743', '0760'],
      { quadriceps: 1, gluteal: 1, adductors: 1, hamstring: 0.4, calves: 0 },
    ],
    [
      ['0755'],
      { quadriceps: 1, gluteal: 1, adductors: 1, hamstring: 0.4, 'lower-back': 0.4, abs: 0.4, obliques: 0.4, calves: 0 },
    ],
    [['0596'], { chest: 1, deltoids: 0.4, serratus: 0.4, biceps: 0 }],
    [['0607'], { triceps: 1, deltoids: 0 }],
  ]

  it.each(cases)('keeps the complete reviewed map for %s', (ids, expected) => {
    for (const id of ids) {
      expect(USER_EXERCISE_MUSCLE_OVERRIDES[id]).toEqual({ muscleWeights: expected })
      expect(EXIDX[id].muscleWeights).toEqual(expected)
      expect(muscleWeightsOf(EXIDX[id])).toEqual(expected)
    }
  })

  it('retains every explicit zero through the runtime catalogue', () => {
    expect(Object.keys(USER_EXERCISE_MUSCLE_OVERRIDES).sort())
      .toEqual(cases.flatMap(([ids]) => ids).sort())
    for (const [id, override] of Object.entries(USER_EXERCISE_MUSCLE_OVERRIDES)) {
      const zeros = Object.entries(override.muscleWeights).filter(([, weight]) => weight === 0)
      expect(zeros.length, id).toBeGreaterThan(0)
      for (const [muscle] of zeros) expect(EXIDX[id].muscleWeights[muscle], `${id}:${muscle}`).toBe(0)
    }
  })

  it('retains every positive weight outside the reviewed zero-credit corrections', () => {
    for (const [id, override] of Object.entries(USER_EXERCISE_MUSCLE_OVERRIDES)) {
      const withoutOverride = { ...EXIDX[id] }
      delete withoutOverride.muscleWeights
      const previousPositive = musclesOf(withoutOverride)
      const completePositive = { ...override.muscleWeights }
      for (const [muscle, weight] of Object.entries(override.muscleWeights)) {
        if (weight === 0) {
          delete previousPositive[muscle]
          delete completePositive[muscle]
        }
      }
      expect(completePositive, id).toEqual(previousPositive)
    }
  })
})
