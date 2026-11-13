import { describe, it, expect } from 'vitest'
import { jointAngle, createRepCounter, landmarkProblem } from './pose-core.js'

const pt = (x, y, visibility = 0.99) => ({ x, y, visibility })

describe('jointAngle', () => {
  it('measures a straight line as 180 and a right angle as 90', () => {
    expect(jointAngle(pt(0, 0), pt(1, 0), pt(2, 0))).toBeCloseTo(180)
    expect(jointAngle(pt(0, 1), pt(0, 0), pt(1, 0))).toBeCloseTo(90)
  })
  it('returns null for missing or low-visibility landmarks', () => {
    expect(jointAngle(pt(0, 0, 0.2), pt(1, 0), pt(2, 0))).toBeNull()
    expect(jointAngle(null, pt(1, 0), pt(2, 0))).toBeNull()
  })
})

describe('createRepCounter (squat-style angle stream)', () => {
  const feed = (counter, angles) => angles.map(a => counter.push(a))

  it('counts a full down-up cycle once, with hysteresis', () => {
    const c = createRepCounter({ downBelow: 100, upAbove: 160 })
    const events = feed(c, [175, 150, 95, 80, 95, 150, 172])
    expect(events.filter(x => x.type === 'rep')).toHaveLength(1)
    expect(c.count()).toBe(1)
  })

  it('does not count partial dips or jitter around one threshold', () => {
    const c = createRepCounter({ downBelow: 100, upAbove: 160 })
    feed(c, [175, 120, 165, 118, 170])
    expect(c.count()).toBe(0)
  })

  it('ignores null frames without resetting the phase', () => {
    const c = createRepCounter({ downBelow: 100, upAbove: 160 })
    feed(c, [175, null, 90, null, 170])
    expect(c.count()).toBe(1)
  })

  it('rejects inverted thresholds', () => {
    expect(() => createRepCounter({ downBelow: 160, upAbove: 100 })).toThrow(/threshold/i)
  })
})

describe('landmarkProblem', () => {
  it('flags missing landmarks and low visibility, accepts a usable frame', () => {
    expect(landmarkProblem([pt(0, 0), null])).toMatch(/missing/i)
    expect(landmarkProblem([pt(0, 0, 0.1)])).toMatch(/visibility/i)
    expect(landmarkProblem([pt(0, 0), pt(1, 1)])).toBeNull()
    expect(landmarkProblem([])).toMatch(/missing/i)
  })
})
