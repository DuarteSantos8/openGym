import { describe, expect, it } from 'vitest'
import { addHeart, lastHeart, watchCurve, heartOrigin, onPhoneClock } from './session-heart.js'

// The watch's readings for the heart rate band of the workout in progress.
describe('addHeart', () => {
  it('keeps the readings in time order, once each, without nonsense', () => {
    let s = addHeart(null, 'w1', [[5000, 120], [1000, 100.4]])
    s = addHeart(s, 'w1', [[3000, 110], [5400, 121], [7000, 400], [8000, 'x'], [0, 90]])
    expect(s).toEqual({ wid: 'w1', samples: [[1000, 100], [3000, 110], [5000, 120]], watch: false })
  })
  it('starts again for another workout', () => {
    const s = addHeart(addHeart(null, 'w1', [[1000, 100]]), 'w2', [[9000, 140]])
    expect(s).toEqual({ wid: 'w2', samples: [[9000, 140]], watch: false })
  })
  it('gives back the same state when nothing is new', () => {
    const s = addHeart(null, 'w1', [[1000, 100]])
    expect(addHeart(s, 'w1', [[1200, 101]])).toBe(s)
  })
})

describe('watchCurve', () => {
  it('shows only once the watch itself has sent readings for this workout', () => {
    const health = addHeart(null, 'w1', [[1000, 100]])
    expect(watchCurve(health, 'w1')).toBe(false)
    const live = addHeart(health, 'w1', [[6000, 110]], { watch: true })
    expect(watchCurve(live, 'w1')).toBe(true)
    expect(watchCurve(live, 'w2')).toBe(false)
    // Read back from Apple Health afterwards, it stays the watch's curve.
    expect(watchCurve(addHeart(live, 'w1', [[9000, 120]]), 'w1')).toBe(true)
    // Nothing new but the flag: a new state all the same.
    expect(addHeart(health, 'w1', [], { watch: true })).not.toBe(health)
  })
})

describe('heartOrigin', () => {
  it('is the start before any pause moved it on', () => {
    expect(heartOrigin({ start: 100000, pausedMs: 30000 })).toBe(70000)
    expect(heartOrigin({ start: 100000 })).toBe(100000)
    expect(heartOrigin(null)).toBe(0)
  })
})

describe('onPhoneClock', () => {
  it('puts the watch readings on the phone clock', () => {
    expect(onPhoneClock([[10000, 120]], 2000)).toEqual([[8000, 120]])
    expect(onPhoneClock([[10000, 120]], -2000)).toEqual([[12000, 120]])
  })
  it('leaves them as they are without a gap, or with one that makes no sense', () => {
    const r = [[10000, 120]]
    expect(onPhoneClock(r, 0)).toBe(r)
    expect(onPhoneClock(r, undefined)).toBe(r)
    expect(onPhoneClock(r, 13 * 3600e3)).toBe(r)
    expect(onPhoneClock(undefined, 2000)).toBeUndefined()
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
