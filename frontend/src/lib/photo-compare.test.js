import { describe, expect, it } from 'vitest'
import { compareRows, cellAspect, coverCrop, panBy, daysApart, byDate, COMPARE_MAX } from './photo-compare.js'

describe('compareRows', () => {
  it('rows of at most three, as even as they go, the fuller first', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(compareRows)).toEqual([
      [1], [2], [3], [2, 2], [3, 2], [3, 3], [3, 2, 2], [3, 3, 2], [3, 3, 3],
    ])
  })
  it('never more than nine, nothing for none', () => {
    expect(compareRows(12)).toEqual(compareRows(COMPARE_MAX))
    expect(compareRows(0)).toEqual([])
    expect(compareRows('x')).toEqual([])
  })
})

describe('cellAspect', () => {
  it('the middle shape of the set, held between 1:2 and 2:1', () => {
    expect(cellAspect([{ width: 3, height: 4 }, { width: 3, height: 4 }, { width: 16, height: 9 }])).toBeCloseTo(0.75)
    expect(cellAspect([{ width: 1, height: 1 }, { width: 1, height: 2 }])).toBeCloseTo(0.75)
    expect(cellAspect([{ width: 10, height: 1 }])).toBe(2)
    expect(cellAspect([])).toBe(0.75)
    expect(cellAspect([{ width: 0, height: 5 }])).toBe(0.75)
  })
})

describe('coverCrop and panBy', () => {
  it('crops like object-fit: cover, at the position asked', () => {
    expect(coverCrop(1600, 900, 0.75)).toEqual({ sx: (1600 - 675) / 2, sy: 0, sw: 675, sh: 900 })
    expect(coverCrop(1600, 900, 0.75, { x: 0 })).toMatchObject({ sx: 0 })
    expect(coverCrop(1600, 900, 0.75, { x: 1 })).toMatchObject({ sx: 925 })
    expect(coverCrop(900, 1600, 16 / 9, { y: 0.25 })).toMatchObject({ sx: 0, sw: 900, sh: 900 / (16 / 9), sy: (1600 - 506.25) * 0.25 })
  })
  it('a drag moves only the side that overflows, and stops at the edges', () => {
    // A 1600x900 photo in a 300x400 cell: drawn 711x400, 411 px too wide.
    const p = panBy({ x: 0.5, y: 0.5 }, -100, 50, 1600, 900, 300, 400)
    expect(p.x).toBeCloseTo(0.5 + 100 / (1600 * (400 / 900) - 300))
    expect(p.y).toBe(0.5)
    expect(panBy({ x: 0.9, y: 0.5 }, -1000, 0, 1600, 900, 300, 400).x).toBe(1)
    expect(panBy(undefined, 0, 0, 300, 400, 300, 400)).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('daysApart and byDate', () => {
  it('whole days either way, oldest first', () => {
    expect(daysApart('2026-01-01', '2026-03-01')).toBe(59)
    expect(daysApart('2026-03-01', '2026-01-01')).toBe(59)
    expect(daysApart('x', '2026-01-01')).toBe(0)
    expect(byDate([{ d: '2026-02-01' }, { d: '2026-01-01', start: 2 }, { d: '2026-01-01', start: 1 }]).map(p => p.start || p.d))
      .toEqual([1, 2, '2026-02-01'])
  })
})
