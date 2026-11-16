import { describe, expect, it } from 'vitest'
import { findingText } from './progression-copy.js'

describe('findingText', () => {
  it('names the field and direction of each finding', () => {
    expect(findingText({ code: 'below_range', field: 'reps' })).toBe('reps below plan')
    expect(findingText({ code: 'above_range', field: 'load' })).toBe('weight above plan')
    expect(findingText({ code: 'above_cap', field: 'load' })).toBe('Above the target cap')
    expect(findingText({ code: 'missing_reference', field: 'load' })).toBe('Entered without a 1RM')
    expect(findingText({ code: 'completed_track', field: 'track' })).toBe('Progression completed')
  })
})
