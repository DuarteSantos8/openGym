import { describe, it, expect } from 'vitest'
import { MAX_COMPARE, toggleCompareKey, orderForCompare, modesFor, defaultMode, validMode, spanDays } from './photo-compare.js'

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
