import { describe, it, expect } from 'vitest'
import { MAX_COMPARE, toggleCompareKey, orderForCompare, modesFor, defaultMode, validMode, spanDays, cellRatio, coverCrop, dragPan, CENTRED } from './photo-compare.js'

describe('toggleCompareKey', () => {
  it('adds a key, and takes it off again on a second tap', () => {
    expect(toggleCompareKey([], 'a')).toEqual(['a'])
    expect(toggleCompareKey(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleCompareKey(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('takes more than two photos', () => {
    expect(toggleCompareKey(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('lets the oldest pick go when the list is full', () => {
    const full = ['a', 'b', 'c', 'd', 'e']
    expect(full).toHaveLength(MAX_COMPARE)
    expect(toggleCompareKey(full, 'f')).toEqual(['b', 'c', 'd', 'e', 'f'])
    expect(toggleCompareKey(['a', 'b'], 'c', 2)).toEqual(['b', 'c'])
  })

  it('does not change the list it was given', () => {
    const cur = ['a', 'b']
    toggleCompareKey(cur, 'c')
    expect(cur).toEqual(['a', 'b'])
  })
})

describe('orderForCompare', () => {
  it('puts the earliest first, whatever order they were picked in', () => {
    const out = orderForCompare([{ d: '2026-03-01', k: 3 }, { d: '2026-01-01', k: 1 }, { d: '2026-02-01', k: 2 }])
    expect(out.map(p => p.k)).toEqual([1, 2, 3])
  })

  it('breaks a same-day tie by the workout start', () => {
    const out = orderForCompare([{ d: '2026-01-01', start: 200, k: 'late' }, { d: '2026-01-01', start: 100, k: 'early' }, { d: '2026-01-01', k: 'none' }])
    expect(out.map(p => p.k)).toEqual(['none', 'early', 'late'])
  })

  it('leaves the list it was given alone', () => {
    const src = [{ d: '2026-02-01' }, { d: '2026-01-01' }]
    orderForCompare(src)
    expect(src[0].d).toBe('2026-02-01')
  })
})

describe('modesFor', () => {
  it('offers side by side and the slider for exactly two photos, side by side alone for more', () => {
    expect(modesFor(2)).toEqual(['side', 'slider'])
    expect(modesFor(3)).toEqual(['side'])
    expect(modesFor(5)).toEqual(['side'])
  })

  it('opens on side by side', () => {
    expect(defaultMode(2)).toBe('side')
    expect(defaultMode(4)).toBe('side')
  })

  it('falls back when a mode no longer fits the count', () => {
    expect(validMode('slider', 2)).toBe('slider')
    expect(validMode('slider', 3)).toBe('side')
    expect(validMode('nope', 2)).toBe('side')
  })
})

it('takes at most five photos', () => {
  expect(MAX_COMPARE).toBe(5)
})

describe('spanDays', () => {
  it('counts from the earliest to the latest, in any order', () => {
    expect(spanDays([{ d: '2026-01-15' }, { d: '2026-01-01' }, { d: '2026-01-08' }])).toBe(14)
  })

  it('is zero for one photo, none, or one day', () => {
    expect(spanDays([{ d: '2026-01-01' }])).toBe(0)
    expect(spanDays([])).toBe(0)
    expect(spanDays([{ d: '2026-01-01' }, { d: '2026-01-01' }])).toBe(0)
  })
})

describe('cellRatio', () => {
  it('is the shape of the photos when they all have it', () => {
    expect(cellRatio([{ w: 3, h: 4 }, { w: 300, h: 400 }, { w: 6, h: 8 }])).toBeCloseTo(4 / 3)
  })
  it('is the middle shape of mixed ones, so most are shown whole', () => {
    expect(cellRatio([{ w: 3, h: 4 }, { w: 3, h: 4 }, { w: 4, h: 3 }])).toBeCloseTo(4 / 3)
    expect(cellRatio([{ w: 4, h: 3 }, { w: 4, h: 3 }, { w: 3, h: 4 }])).toBeCloseTo(3 / 4)
  })
  it('is between the two middle ones for an even number', () => {
    expect(cellRatio([{ w: 1, h: 1 }, { w: 1, h: 2 }])).toBeCloseTo(1.5)
  })
  it('leaves out photos with no size, and is 4:3 portrait with none', () => {
    expect(cellRatio([{ w: 1, h: 2 }, {}, { w: 0, h: 5 }, null])).toBe(2)
    expect(cellRatio([])).toBeCloseTo(4 / 3)
    expect(cellRatio(undefined)).toBeCloseTo(4 / 3)
  })
})

describe('coverCrop', () => {
  it('shows the whole photo in a box of its own shape', () => {
    expect(coverCrop(300, 400, 150, 200)).toEqual({ sx: 0, sy: 0, sw: 300, sh: 400, overflowX: 0, overflowY: 0 })
  })
  it('crops the sides of a wide photo in a tall box, from the middle by default', () => {
    const c = coverCrop(400, 300, 150, 200)
    expect(c.sh).toBeCloseTo(300)
    expect(c.sw).toBeCloseTo(225)
    expect(c.sx).toBeCloseTo((400 - 225) / 2)
    expect(c.overflowX).toBeCloseTo(400 * (200 / 300) - 150)
    expect(c.overflowY).toBe(0)
  })
  it('crops the top and bottom of a tall photo in a wide box', () => {
    const c = coverCrop(300, 600, 200, 100)
    expect(c.sw).toBeCloseTo(300)
    expect(c.sh).toBeCloseTo(150)
    expect(c.overflowX).toBe(0)
    expect(c.overflowY).toBeGreaterThan(0)
  })
  it('follows the pan position to either edge', () => {
    expect(coverCrop(400, 300, 150, 200, 0).sx).toBe(0)
    const right = coverCrop(400, 300, 150, 200, 1)
    expect(right.sx + right.sw).toBeCloseTo(400)
    expect(coverCrop(400, 300, 150, 200, 7).sx).toBe(right.sx)       // past the edge it stops
    expect(coverCrop(400, 300, 150, 200, NaN).sx).toBeCloseTo((400 - 225) / 2)
  })
  it('does not break on a photo or a box with no size', () => {
    expect(coverCrop(0, 0, 100, 100)).toMatchObject({ sx: 0, sy: 0, overflowX: 0, overflowY: 0 })
    expect(coverCrop(100, 100, 0, 0)).toMatchObject({ overflowX: 0, overflowY: 0 })
  })
})

describe('dragPan', () => {
  it('moves the position the other way, by the share of what can be dragged', () => {
    expect(dragPan(CENTRED, 30, 0, 60, 0)).toEqual({ x: 0, y: 0.5 })           // 30 of 60 px to the right: now at the left edge
    expect(dragPan(CENTRED, -15, 0, 60, 0).x).toBeCloseTo(0.75)
  })
  it('stops at the edges', () => {
    expect(dragPan({ x: 0.9, y: 0.5 }, -500, 0, 60, 0).x).toBe(1)
    expect(dragPan({ x: 0.1, y: 0.5 }, 500, 0, 60, 0).x).toBe(0)
  })
  it('leaves an axis with nothing to drag where it is', () => {
    expect(dragPan({ x: 0.3, y: 0.6 }, 99, 99, 0, 0)).toEqual({ x: 0.3, y: 0.6 })
    expect(dragPan(CENTRED, 10, 20, 0, 40)).toEqual({ x: 0.5, y: 0 })
  })
})

