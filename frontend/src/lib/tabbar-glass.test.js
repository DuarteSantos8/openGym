import { describe, it, expect } from 'vitest'
import { lensEdges, nextMin, lensDir } from './tabbar-glass.js'

describe('lensEdges', () => {
  it('sits 2 px inside the first and last slot of a 390 pt screen', () => {
    expect(lensEdges({ screenW: 390, tab: 0 })).toEqual([10, 282.5])
    expect(lensEdges({ screenW: 390, tab: 3 })).toEqual([282.5, 10])
  })
  it('skips the 64 px Start slot from the third tab on', () => {
    const [a] = lensEdges({ screenW: 390, tab: 1 }), [b] = lensEdges({ screenW: 390, tab: 2 })
    expect(a).toBe(79.5)
    expect(b).toBe(79.5 + 69.5 + 64)
  })
  it('is the capsule pill when shrunk', () => {
    expect(lensEdges({ screenW: 390, tab: 2, min: true })).toEqual([4, 60])
    expect(lensEdges({ screenW: 390, tab: 2, min: true, ax: true })).toEqual([4, 66])
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

describe('lensDir', () => {
  it('names the direction', () => {
    expect([lensDir(0, 3), lensDir(3, 0), lensDir(2, 2)]).toEqual(['fwd', 'back', ''])
  })
})
