import { describe, expect, it } from 'vitest'
import { addHeart, lastHeart } from './session-heart.js'

// The watch's readings for the heart rate band of the workout in progress.
describe('addHeart', () => {
  it('keeps the readings in time order, once each, without nonsense', () => {
    let s = addHeart(null, 'w1', [[5000, 120], [1000, 100.4]])
    s = addHeart(s, 'w1', [[3000, 110], [5400, 121], [7000, 400], [8000, 'x'], [0, 90]])
    expect(s).toEqual({ wid: 'w1', samples: [[1000, 100], [3000, 110], [5000, 120]] })
  })
  it('starts again for another workout', () => {
    const s = addHeart(addHeart(null, 'w1', [[1000, 100]]), 'w2', [[9000, 140]])
    expect(s).toEqual({ wid: 'w2', samples: [[9000, 140]] })
  })
  it('gives back the same state when nothing is new', () => {
    const s = addHeart(null, 'w1', [[1000, 100]])
    expect(addHeart(s, 'w1', [[1200, 101]])).toBe(s)
  })
})

describe('lastHeart', () => {
  it('is the last reading while it is under a minute old', () => {
    const s = { wid: 'w1', samples: [[1000, 100], [2000, 130]] }
    expect(lastHeart(s, 50000)).toEqual({ bpm: 130, at: 2000 })
    expect(lastHeart(s, 70000)).toBeNull()
    expect(lastHeart(null)).toBeNull()
  })
})
