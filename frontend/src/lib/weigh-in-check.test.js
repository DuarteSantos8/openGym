import { describe, expect, it } from 'vitest'
import { weighInOff } from './weigh-in-check.js'

describe('weighInOff', () => {
  it('asks about a slip of a digit', () => {
    expect(weighInOff(7.8, 78)).toBe(true)
    expect(weighInOff(87, 74)).toBe(true)
    expect(weighInOff(780, 78)).toBe(true)
  })
  it('leaves an ordinary change alone, up to 15 % either way', () => {
    expect(weighInOff(80, 78)).toBe(false)
    expect(weighInOff(85, 74)).toBe(false)   // 14.9 %
    expect(weighInOff(63, 74)).toBe(false)   // 14.9 % down
  })
  it('has nothing to say without a last weigh-in', () => {
    expect(weighInOff(78, null)).toBe(false)
    expect(weighInOff(78, 0)).toBe(false)
  })
})
