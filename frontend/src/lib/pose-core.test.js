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

  it('rejects malformed, nonfinite, or out-of-range thresholds instead of coercing', () => {
    expect(() => createRepCounter({ downBelow: '100', upAbove: '160' })).toThrow(/threshold/i)
    expect(() => createRepCounter({ downBelow: true, upAbove: 160 })).toThrow(/threshold/i)
    expect(() => createRepCounter({ downBelow: NaN, upAbove: 160 })).toThrow(/threshold/i)
    expect(() => createRepCounter({ downBelow: 100, upAbove: Infinity })).toThrow(/threshold/i)
    expect(() => createRepCounter({ downBelow: -1, upAbove: 160 })).toThrow(/threshold/i)
    expect(() => createRepCounter({ downBelow: 100, upAbove: 181 })).toThrow(/threshold/i)
  })

  it('ignores malformed, nonfinite, or out-of-range angle inputs without coercing', () => {
    const c = createRepCounter({ downBelow: 100, upAbove: 160 })
    expect(c.push('90')).toEqual({ type: 'ignored' })
    expect(c.push(true)).toEqual({ type: 'ignored' })
    expect(c.push(NaN)).toEqual({ type: 'ignored' })
    expect(c.push(-5)).toEqual({ type: 'ignored' })
    expect(c.push(200)).toEqual({ type: 'ignored' })
    feed(c, [175, 90, 170])
    expect(c.count()).toBe(1)
  })
})

describe('landmarkProblem', () => {
  it('flags missing landmarks and low visibility, accepts a usable frame', () => {
    expect(landmarkProblem([pt(0, 0), null])).toMatch(/missing/i)
    expect(landmarkProblem([pt(0, 0, 0.1)])).toMatch(/visibility/i)
    expect(landmarkProblem([pt(0, 0), pt(1, 1)])).toBeNull()
    expect(landmarkProblem([])).toMatch(/missing/i)
  })

  it('flags nonfinite visibility and nonfinite coordinates as unusable', () => {
    expect(landmarkProblem([pt(0, 0, NaN)])).toMatch(/visibility/i)
    expect(landmarkProblem([pt(0, 0, Infinity)])).toMatch(/visibility/i)
    expect(landmarkProblem([{ x: Infinity, y: 0, visibility: 0.99 }])).toMatch(/missing/i)
    expect(landmarkProblem([{ x: 0, y: NaN, visibility: 0.99 }])).toMatch(/missing/i)
  })

  it('accepts landmarks that omit visibility', () => {
    expect(landmarkProblem([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull()
  })
})

describe('jointAngle nonfinite geometry', () => {
  it('never returns NaN for degenerate or nonfinite geometry', () => {
    expect(jointAngle(pt(1, 1), pt(1, 1), pt(2, 2))).toBeNull()
    expect(jointAngle(pt(NaN, 0), pt(1, 0), pt(2, 0))).toBeNull()
    expect(jointAngle(pt(0, 0), pt(1, Infinity), pt(2, 0))).toBeNull()
    const angle = jointAngle(pt(0, 0), pt(1, 0), pt(2, 0))
    expect(Number.isFinite(angle)).toBe(true)
  })

  it('returns null for finite-but-huge coordinates that overflow vector math', () => {
    const angle = jointAngle(
      { x: 1e308, y: 0, visibility: 0.99 },
      { x: -1e308, y: 0, visibility: 0.99 },
      { x: 0, y: 1e308, visibility: 0.99 },
    )
    expect(angle).toBeNull()
    expect(Number.isNaN(angle)).toBe(false)
  })
})
