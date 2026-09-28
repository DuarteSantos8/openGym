// Issue #139: a per-side figure off kg plates lands on .25 and .75, and one decimal reported
// those as .3 and .8. The setting adds precision that is already in the number — it changes
// nothing about what is stored.
import { describe, it, expect, afterEach } from 'vitest'
import { fmtNum, setWeightDecimals, weightDecimals } from './format.js'

afterEach(() => setWeightDecimals(1))

describe('weight decimals', () => {
  it('rounds to one decimal by default, exactly as before', () => {
    expect(weightDecimals()).toBe(1)
    expect(fmtNum(62.75)).toBe('62.8')
    expect(fmtNum(20.25)).toBe('20.3')
  })

  it('keeps the quarter when asked for two', () => {
    setWeightDecimals(2)
    expect(fmtNum(62.75)).toBe('62.75')
    expect(fmtNum(20.25)).toBe('20.25')
  })

  it('never invents precision that is not there', () => {
    setWeightDecimals(2)
    expect(fmtNum(100)).toBe('100')
    expect(fmtNum(62.5)).toBe('62.5')
    expect(fmtNum(0)).toBe('0')
  })

  it('ignores anything that is not 1 or 2', () => {
    setWeightDecimals(5); expect(weightDecimals()).toBe(1)
    setWeightDecimals(undefined); expect(weightDecimals()).toBe(1)
    setWeightDecimals(2); expect(weightDecimals()).toBe(2)
  })
})
