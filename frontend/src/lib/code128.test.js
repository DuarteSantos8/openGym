import { describe, it, expect } from 'vitest'
import { CODE128_PATTERNS, code128Symbols, encodeCode128 } from './code128.js'

const modules = runs => runs.reduce((a, b) => a + b, 0)

describe('Code 128 patterns', () => {
  it('has 107 symbols, 11 modules each and 13 for stop', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    CODE128_PATTERNS.forEach((p, i) => {
      const w = [...p].map(Number).reduce((a, b) => a + b, 0)
      expect(w, `symbol ${i}`).toBe(i === 106 ? 13 : 11)
    })
  })

  it('has no duplicate patterns', () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
  })
})

describe('code128Symbols', () => {
  it('packs an even-length number into code set C', () => {
    // 10 00 00 97 79: checksum (105 + 1*10 + 2*0 + 3*0 + 4*97 + 5*79) % 103 = 898 % 103 = 74
    expect(code128Symbols('1000009779')).toEqual([105, 10, 0, 0, 97, 79, 74, 106])
  })

  it('uses code set B for text and odd-length numbers', () => {
    // (104 + 55 + 2*73 + 3*75 + 4*73 + 5*80 + 6*69 + 7*68 + 8*73 + 9*65) % 103 = 3281 % 103 = 88
    expect(code128Symbols('Wikipedia')).toEqual([104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, 106])
    expect(code128Symbols('123')[0]).toBe(104)
  })

  it('refuses what it cannot carry', () => {
    expect(code128Symbols('')).toBeNull()
    expect(code128Symbols('tab\there')).toBeNull()
    expect(code128Symbols('café')).toBeNull()
  })
})

describe('encodeCode128', () => {
  it('is start + data + checksum symbols of 11 modules plus a 13-module stop', () => {
    const runs = encodeCode128('1000009779')
    expect(modules(runs)).toBe(7 * 11 + 13)
    expect(runs.length % 2).toBe(1)   // starts and ends on a bar
  })
})
