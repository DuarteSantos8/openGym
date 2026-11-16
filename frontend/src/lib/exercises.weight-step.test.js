import { describe, expect, it } from 'vitest'
import { stepWeight } from './exercises.js'
import { shownWeight, storedWeight, withExUnit } from './ex-unit.js'

describe('weight stepping across exercise units', () => {
  it('keeps pinned values exact and uses the main one-decimal off-grid step after unpinning', () => {
    const S = { unit: 'kg', exUnit: withExUnit({}, '0025', 'lb', 1) }
    const stored = storedWeight(S, '0025', 45)
    expect(stored).toBe(20.4117)
    expect(shownWeight(S, '0025', stored)).toBe(45)
    expect(stepWeight(stored, 2.5, 1)).toBe(22.9)
    expect(stepWeight(20, 1.25, 1)).toBe(21.25)
  })
})
