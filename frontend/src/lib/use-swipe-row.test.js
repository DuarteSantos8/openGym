import { describe, it, expect } from 'vitest'
import { commitFor, shapeOffset, armedFor, axisOf, inEdgeZone, velocityOf, REVEAL, OPEN_MIN, EDGE, BAND } from './use-swipe-row.js'

// Offsets and velocities are logical (negative = toward the start of the line: left in English,
// right in Arabic), so one table covers both directions; the component turns them into pixels.
const W = 360

describe('commitFor', () => {
  it('deletes past 60 % of the row, or a flick toward the start past 40 %', () => {
    expect(commitFor(-0.6 * W, W, 0)).toBe('delete')
    expect(commitFor(-0.59 * W, W, 0)).toBe('open-delete')
    expect(commitFor(-0.4 * W, W, -0.6)).toBe('delete')
    expect(commitFor(-0.39 * W, W, -0.6)).toBe('open-delete')
    expect(commitFor(-0.4 * W, W, -0.5)).toBe('open-delete')   // a flick has to beat 0.5 px/ms
  })

  it('copies past 40 % of the row, or a flick toward the end past 25 %', () => {
    expect(commitFor(0.4 * W, W, 0)).toBe('copy')
    expect(commitFor(0.39 * W, W, 0)).toBe('open-copy')
    expect(commitFor(0.25 * W, W, 0.6)).toBe('copy')
    expect(commitFor(0.24 * W, W, 0.6)).toBe('open-copy')
  })

  it('leaves the row open on its button from 40 px, shut below', () => {
    expect(commitFor(-OPEN_MIN, W)).toBe('open-delete')
    expect(commitFor(-(OPEN_MIN - 1), W)).toBe('close')
    expect(commitFor(OPEN_MIN, W)).toBe('open-copy')
    expect(commitFor(OPEN_MIN - 1, W)).toBe('close')
    expect(commitFor(0, W, 3)).toBe('close')
  })

  it('a flick back the other way closes', () => {
    expect(commitFor(-REVEAL, W, 0.8)).toBe('close')
    expect(commitFor(REVEAL, W, -0.8)).toBe('close')
  })
})

describe('shapeOffset', () => {
  it('follows the finger up to the commit point, then at a third of the pace', () => {
    expect(shapeOffset(-100, W)).toBe(-100)
    expect(shapeOffset(-0.6 * W, W)).toBeCloseTo(-0.6 * W)
    expect(shapeOffset(-0.6 * W - 100, W)).toBeCloseTo(-0.6 * W - 35)
    expect(shapeOffset(0.4 * W + 100, W)).toBeCloseTo(0.4 * W + 35)
    expect(shapeOffset(5 * W, W)).toBe(W)
  })
})

describe('armedFor', () => {
  it('names the side that acts if let go now', () => {
    expect(armedFor(-0.6 * W, W)).toBe('delete')
    expect(armedFor(-0.5 * W, W)).toBeNull()
    expect(armedFor(0.4 * W, W)).toBe('copy')
    expect(armedFor(0.3 * W, W)).toBeNull()
  })
})

describe('axisOf', () => {
  it('waits for 8 px, and sideways has to beat vertical 1.5 to 1', () => {
    expect(axisOf(7, 0)).toBeNull()
    expect(axisOf(8, 0)).toBe('x')
    expect(axisOf(15, 10)).toBe('y')     // a 34° diagonal is a scroll
    expect(axisOf(16, 10)).toBe('x')
    expect(axisOf(0, 9)).toBe('y')
  })
})

describe('inEdgeZone', () => {
  it('leaves the 24 px at either screen edge to the back gestures', () => {
    expect(inEdgeZone(EDGE - 1, 390)).toBe(true)
    expect(inEdgeZone(EDGE, 390)).toBe(false)
    expect(inEdgeZone(390 - EDGE, 390)).toBe(false)
    expect(inEdgeZone(390 - EDGE + 1, 390)).toBe(true)
  })
})

describe('velocityOf', () => {
  it('reads px/ms between the first and last sample', () => {
    expect(velocityOf([[0, 0]])).toBe(0)
    expect(velocityOf([[0, 0], [50, -40], [100, -80]])).toBeCloseTo(-0.8)
  })
})

// Plan's remove-only rows (v1.3.11): the loop and a routine's exercises have nothing to copy.
describe('a row with nothing on the end side', () => {
  it('gives a short rubber band toward the end, and never more', () => {
    expect(shapeOffset(10, W, false)).toBeGreaterThan(0)
    expect(shapeOffset(10, W, false)).toBeLessThan(10)
    expect(shapeOffset(300, W, false)).toBe(BAND)
    expect(shapeOffset(-100, W, false)).toBe(shapeOffset(-100, W))   // the start side is untouched
  })
  it('never arms, opens or acts toward the end, however far or fast', () => {
    expect(armedFor(W, W, false)).toBeNull()
    expect(commitFor(BAND, W, 0, false)).toBe('close')
    expect(commitFor(W, W, 5, false)).toBe('close')
    expect(commitFor(-W * 0.7, W, 0, false)).toBe('delete')
    expect(commitFor(-REVEAL, W, 0, false)).toBe('open-delete')
  })
})
