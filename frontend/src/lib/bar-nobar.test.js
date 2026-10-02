// Issue #138: a Smith machine that counterbalances its carriage puts nothing in your hands, but
// 0 in the bar field meant "clear the override" and snapped back to the 9 kg default — so the
// plate math and the drop-set steps were computed from a bar that is not there.
import { describe, it, expect } from 'vitest'
import { barWeightFor, hasBarOverride, isNoBar, plateSplit, defaultBarWeight } from './bar.js'

const smith = { id: 'sm', eq: 'smith machine' }
const bb = { id: 'bb', eq: 'barbell' }
const S = over => ({ unit: 'kg', barWeights: { ...over } })

describe('no bar at all', () => {
  it('keeps a stored 0 instead of falling back to the bar type default', () => {
    expect(barWeightFor(S({ sm: 0 }), smith)).toBe(0)
    expect(defaultBarWeight('smith machine', 'kg')).toBe(9)
    expect(barWeightFor(S({}), smith)).toBe(9)          // no entry still means "use the default"
  })

  it('tells "no bar" apart from "nothing set"', () => {
    expect(isNoBar(S({ sm: 0 }), 'sm')).toBe(true)
    expect(isNoBar(S({ sm: 15 }), 'sm')).toBe(false)
    expect(isNoBar(S({}), 'sm')).toBe(false)
    expect(hasBarOverride(S({ sm: 0 }), 'sm')).toBe(true)
    expect(hasBarOverride(S({}), 'sm')).toBe(false)
  })

  it('counts every plate when there is no bar', () => {
    expect(plateSplit(100, 0)).toBe(50)
    expect(plateSplit(100, 20)).toBe(40)
    expect(plateSplit(0, 0)).toBe(null)
    expect(plateSplit(100, null)).toBe(null)            // not a bar exercise at all
  })

  it('leaves an ordinary barbell alone', () => {
    expect(barWeightFor(S({ bb: 25 }), bb)).toBe(25)
    expect(barWeightFor(S({}), bb)).toBe(20)
  })
})
