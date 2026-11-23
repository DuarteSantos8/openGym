import { describe, it, expect } from 'vitest'
import { weighInOff } from './weigh-in-check.js'

describe('weighInOff', () => {
  it('flags a weigh-in more than 15% off the last, either way', () => {
    expect(weighInOff(82.6, 70)).toBeCloseTo(0.18, 2)
    expect(weighInOff(805, 80.5)).toBeCloseTo(9, 5)
    expect(weighInOff(59, 70)).toBeCloseTo(0.157, 2)
  })
  it('leaves a normal change, and a first weigh-in, alone', () => {
    expect(weighInOff(80, 70)).toBeNull()   // 14%
    expect(weighInOff(70, 70)).toBeNull()
    expect(weighInOff(70, undefined)).toBeNull()
    expect(weighInOff(70, 0)).toBeNull()
  })
})
