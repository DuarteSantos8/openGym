import { describe, expect, it } from 'vitest'
import { BODYPARTS, EXDB, EXIDX, registerCustom } from './exercises.js'
import { COMPOUND_LIFT_BATCH_1 } from './exercise-muscle-batch-1.js'
import { MUSCLES, musclesOf } from './muscles.js'

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
