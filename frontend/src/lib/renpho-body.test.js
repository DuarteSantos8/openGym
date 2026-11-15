import { describe, expect, it } from 'vitest'
import { renphoRows, renphoValue, renphoLabel, renphoFieldLabel, renphoSegments, segType, RENPHO_KINDS } from './renpho-body.js'

describe('RENPHO under Body measurements', () => {
  it('lists the kinds it knows, in its own order, and nothing else', () => {
    const rows = renphoRows([
      { type: 'bmr', v: 1700, t: 3 }, { type: 'bodyFat', v: 21.4, t: 3 }, { type: 'imp20Trunk', v: 22, t: 3 },
      { type: 'weight', v: 80, t: 3 }, { type: 'muscleMass', v: NaN, t: 3 }, { type: 'boneMass', v: 3.2, t: 3 },
    ])
    expect(rows.map(r => r.type)).toEqual(['bodyFat', 'boneMass', 'bmr'])
    expect(renphoRows(null)).toEqual([])
    expect(RENPHO_KINDS[0].type).toBe('bodyFat')
  })

  it('reads each value in its unit: masses in the profile\'s kg or lb, the age without one', () => {
    expect(renphoValue('fatMass', 17.82, 'kg')).toEqual({ v: 17.8, unit: 'kg' })
    expect(renphoValue('fatMass', 10, 'lb')).toEqual({ v: 22, unit: 'lb' })
    expect(renphoValue('bodyFat', 21.44, 'lb')).toEqual({ v: 21.4, unit: '%' })
    expect(renphoValue('bmr', 1702.6, 'kg')).toEqual({ v: 1703, unit: 'kcal' })
    expect(renphoValue('metabolicAge', 33.6, 'kg')).toEqual({ v: 34, unit: '' })
    expect(renphoValue('visceralFat', 8, 'kg')).toEqual({ v: 8, unit: '' })
    expect(renphoValue('weight', 80, 'kg')).toBeNull()
  })

  it('names the values Settings lists, the card\'s and the weight', () => {
    expect(renphoLabel('bodyWater')).toBe('Body water')
    expect(renphoLabel('weight')).toBeNull()
    expect(renphoFieldLabel('weight')).toBe('Weight')
    expect(renphoFieldLabel('segFatLeftArm')).toBeNull()
  })

  it('takes the segmental values apart, with the newest time among them', () => {
    expect(segType('segMuscle', 'leftArm')).toBe('segMuscleLeftArm')
    expect(renphoSegments([{ type: 'bodyFat', v: 20, t: 1 }])).toBeNull()
    expect(renphoSegments([
      { type: 'segFatLeftArm', v: 1.2, t: 5 }, { type: 'imp100Trunk', v: 21, t: 7 }, { type: 'bodyFat', v: 20, t: 9 },
    ])).toEqual({ t: 7, values: { segFatLeftArm: 1.2, imp100Trunk: 21 } })
  })
})
