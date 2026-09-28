import { describe, expect, it } from 'vitest'
import { BODYPARTS, EXDB, EXIDX, registerCustom } from './exercises.js'
import { MACHINE_BATCH_2 } from './exercise-muscle-batch-2.js'
import { MUSCLES, musclesOf } from './muscles.js'

const ids = Object.keys(MACHINE_BATCH_2)
const catalogue = new Map(EXDB.map(exercise => [exercise.id, exercise]))
const duplicateFree = values => values.length === new Set(values).size

const expectMapping = (id, expected) => {
  expect(MACHINE_BATCH_2[id], id).toEqual(expected)
  expect(EXIDX[id], id).toMatchObject(expected)
}

describe('machine muscle metadata batch 2', () => {
  it('contains a bounded batch of machine and cable catalogue entries', () => {
    expect(ids.length).toBeGreaterThanOrEqual(60)
    expect(ids.length).toBeLessThanOrEqual(120)
    expect(ids.length).toBe(119)
    expect(ids.every(id => catalogue.has(id))).toBe(true)
    expect(ids.every(id => /machine|cable/.test(catalogue.get(id).eq))).toBe(true)
  })

  it('uses only existing body-part keys and canonical drawable muscle slugs', () => {
    for (const [id, metadata] of Object.entries(MACHINE_BATCH_2)) {
      expect(BODYPARTS, id).toContain(metadata.bp)
      expect(metadata.primaries.length, id).toBeGreaterThan(0)
      expect(duplicateFree(metadata.primaries), id).toBe(true)
      expect(duplicateFree(metadata.secondaries), id).toBe(true)
      expect(metadata.primaries.some(muscle => metadata.secondaries.includes(muscle)), id).toBe(false)
      expect(metadata.primaries.every(muscle => MUSCLES.includes(muscle)), id).toBe(true)
      expect(metadata.secondaries.every(muscle => MUSCLES.includes(muscle)), id).toBe(true)
      expect(EXIDX[id]).toMatchObject(metadata)
    }
  })

  it('maps the pec-deck family from the lever seated-fly template', () => {
    expectMapping('0596', {
      bp: 'chest', primaries: ['chest'], secondaries: ['deltoids', 'biceps', 'serratus']
    })
  })

  it('maps chest-press machines to chest with pressing assistants', () => {
    expectMapping('0577', {
      bp: 'chest', primaries: ['chest'], secondaries: ['deltoids', 'triceps', 'biceps']
    })
  })

  it('maps cable crossovers to drawing-ready upper-back support', () => {
    expectMapping('0155', {
      bp: 'chest', primaries: ['chest'], secondaries: ['upper-back', 'trapezius']
    })
  })

  it('maps machine/cable lat pulldowns to upper back with arm-and-shoulder synergy', () => {
    expectMapping('0579', {
      bp: 'back',
      primaries: ['upper-back'],
      secondaries: ['biceps', 'deltoids', 'forearm', 'trapezius', 'triceps']
    })
  })

  it('maps seated rows to upper back with the phase-1 pull template', () => {
    expectMapping('1350', {
      bp: 'back',
      primaries: ['upper-back'],
      secondaries: ['biceps', 'deltoids', 'forearm', 'trapezius', 'chest', 'triceps']
    })
  })

  it('maps assisted triceps dip variants to full synergist support', () => {
    expectMapping('0019', {
      bp: 'upper arms',
      primaries: ['triceps'],
      secondaries: ['deltoids', 'chest', 'upper-back', 'trapezius', 'biceps']
    })
    expectMapping('1451', {
      bp: 'upper arms',
      primaries: ['triceps'],
      secondaries: ['deltoids', 'chest', 'upper-back', 'trapezius', 'biceps']
    })
  })

  it('maps lever triceps extension without ExRx synergist secondaries', () => {
    expectMapping('0607', {
      bp: 'upper arms', primaries: ['triceps'], secondaries: []
    })
  })

  it('maps sled leg presses to the multi-primary lower-body template', () => {
    expectMapping('0739', {
      bp: 'upper legs', primaries: ['quadriceps', 'gluteal', 'adductors'], secondaries: ['hamstring', 'calves']
    })
  })

  it('maps leg extensions as quadriceps isolation', () => {
    expectMapping('0585', {
      bp: 'upper legs', primaries: ['quadriceps'], secondaries: []
    })
  })

  it('maps seated leg curls to hamstrings with calf assistance', () => {
    expectMapping('0599', {
      bp: 'upper legs', primaries: ['hamstring'], secondaries: ['calves', 'adductors']
    })
  })

  it('maps machine shoulder presses to deltoids with direct press support', () => {
    expectMapping('0603', {
      bp: 'shoulders', primaries: ['deltoids'],
      secondaries: ['chest', 'triceps', 'trapezius', 'serratus', 'biceps']
    })
  })

  it('preserves raw dataset metadata while enriching only the runtime catalogue', () => {
    const raw = catalogue.get('0577')
    expect(raw).toMatchObject({ id: '0577', n: 'lever chest press', tg: 'pectorals', mg: 'triceps' })
    expect(raw).not.toHaveProperty('primaries')
    expect(raw).not.toHaveProperty('secondaries')
    expect(musclesOf(raw)).toEqual({ chest: 1, deltoids: 0.4, triceps: 0.4 })
    expect(musclesOf(EXIDX['0577'])).toEqual({ chest: 1, deltoids: 0.4, triceps: 0.4, biceps: 0.4 })
  })

  it('gives an explicit custom collision precedence and restores the machine overlay', () => {
    registerCustom([{
      id: '0577', n: 'Owner machine press correction', bp: 'chest',
      primaries: ['triceps'], secondaries: []
    }])
    expect(EXIDX['0577']).toMatchObject({ primaries: ['triceps'], secondaries: [] })
    expect(musclesOf(EXIDX['0577'])).toEqual({ triceps: 1 })
    registerCustom([])
    expect(EXIDX['0577']).toMatchObject(MACHINE_BATCH_2['0577'])
    expect(musclesOf(EXIDX['0577'])).toEqual({ chest: 1, deltoids: 0.4, triceps: 0.4, biceps: 0.4 })
  })
})
