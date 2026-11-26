import { describe, expect, it } from 'vitest'
import { guideFor } from './exercise-guide.js'
import { cuesFor, easierOf } from './guided.js'

describe('guided workouts use the exercise form guide', () => {
  it('returns the published order of the cue text and no cues for an unknown move', () => {
    expect(cuesFor('1760')).toEqual(guideFor('1760').cues)
    expect(cuesFor('unknown')).toEqual([])
  })
  it('takes one step down the guide ladder and stops at the bottom', () => {
    expect(easierOf('0043')).toBe('1760')
    expect(easierOf('1760')).toBe('1197')
    expect(easierOf('1197')).toBeNull()
    expect(easierOf('unknown')).toBeNull()
  })
})
