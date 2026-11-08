import { describe, it, expect } from 'vitest'
import { lensBox, nextMin } from './tabbar-glass.js'

describe('lensBox', () => {
  it('sits 4 px from both ends of the bar, as from its top and bottom (390 pt screen, bar 358 x 64)', () => {
    expect(lensBox({ screenW: 390, tab: 0 })).toEqual([4, 0, 71.5, 56])
    const [x, , w] = lensBox({ screenW: 390, tab: 3 })
    expect(x + w).toBe(358 - 4)
  })
  it('skips the 64 px Start slot from the third tab on', () => {
    const [a] = lensBox({ screenW: 390, tab: 1 }), [b] = lensBox({ screenW: 390, tab: 2 })
    expect(a).toBe(75.5)
    expect(b).toBe(75.5 + 71.5 + 64)
  })
  it('is the capsule pill when shrunk, lowered by the lost height, the same size at every width', () => {
    for (const screenW of [375, 390, 430, 440]) {
      expect(lensBox({ screenW, tab: 2, min: true })).toEqual([4, 12, 52, 44])
      expect(lensBox({ screenW, tab: 2, min: true, ax: true })).toEqual([4, 18, 56, 50])
    }
  })
})

describe('nextMin', () => {
  const at = (s, y, scrollMax = 2000) => nextMin({ ...s, y, scrollMax })
  const full = { min: false, acc: 0, last: 100 }
  it('shrinks after 24 pt down', () => {
    expect(at(full, 125).min).toBe(true)
    expect(at(full, 124).min).toBe(false)
  })
  it('a turn resets the count', () => {
    const r = at(full, 120)
    expect(at({ ...r, last: 120 }, 115).min).toBe(false)
  })
  it('grows back after 12 pt up, not 11', () => {
    const s = { min: true, acc: 0, last: 113 }
    expect(at(s, 100).min).toBe(false)
    expect(at(s, 102).min).toBe(true)
  })
  it('grows back at the top, and never shrinks above it', () => {
    expect(at({ min: true, acc: 50, last: 40 }, 0)).toEqual({ min: false, acc: 0 })
    expect(at({ min: false, acc: 0, last: 10 }, -5).min).toBe(false)
  })
  it('ignores the bounce at the bottom', () => {
    expect(at({ min: true, acc: 0, last: 2010 }, 1996)).toEqual({ min: true, acc: 0 })
    expect(at({ min: false, acc: 0, last: 1900 }, 1996).min).toBe(false)
  })
})
