import { describe, it, expect } from 'vitest'
import { C128, C39, encodeBars, decodeBarsRow, decodeBarcodeImage, drawBarsToCanvas } from './barcode.js'

// The tables are typed in by hand, so check the properties the specs guarantee before trusting
// any round trip (a typo would encode and decode "fine" with itself).
describe('symbol tables', () => {
  it('Code 128: every symbol is 11 modules, an even number of them dark, and unique', () => {
    const syms = C128.slice(0, 106)
    for (const s of syms) {
      const w = s.split('').map(Number)
      expect(w.reduce((a, b) => a + b, 0)).toBe(11)
      expect((w[0] + w[2] + w[4]) % 2).toBe(0)
    }
    expect(new Set(syms).size).toBe(106)
    expect(C128[106]).toBe('2331112')
  })

  it('Code 39: 44 unique characters, three wide elements each', () => {
    const all = Object.values(C39).map(w => w.join(''))
    expect(all).toHaveLength(44)
    expect(new Set(all).size).toBe(44)
    for (const w of Object.values(C39)) expect(w.filter(x => x === 3)).toHaveLength(3)
    expect(C39['*'].join('')).toBe('131131311')   // n w n n w n w n n
    expect(C39.A.join('')).toBe('311113113')
  })
})

const bits = m => m.join('')

describe('encodeBars', () => {
  it('draws the EAN-13 example 5901234123457 bar for bar', () => {
    const m = bits(encodeBars('5901234123457', 'ean13')).replace(/^0+|0+$/g, '')
    // start guard, then 9 (L), 0 (G): first digit 5 is parity LGGLLG
    expect(m.startsWith('101' + '0001011' + '0100111')).toBe(true)
    expect(m.endsWith('1000100' + '101')).toBe(true)   // check digit 7 in R form, end guard
    expect(m).toHaveLength(95)
  })

  it('UPC-A is EAN-13 with a leading zero', () => {
    expect(encodeBars('036000291452', 'upca')).toEqual(encodeBars('0036000291452', 'ean13'))
  })

  it('Code 128 picks set C for even digit runs and B otherwise, with the mod-103 check', () => {
    const c = bits(encodeBars('1234', 'code128')).replace(/^0+|0+$/g, '')
    // start C (105), 12, 34, check (105 + 12 + 2*34) % 103 = 82, stop
    const w = s => s.split('').map((n, i) => (i % 2 ? '0' : '1').repeat(n)).join('')
    expect(c).toBe(w(C128[105]) + w(C128[12]) + w(C128[34]) + w(C128[82]) + w(C128[106]))
    expect(encodeBars('A1', 'code128')).not.toBeNull()
  })

  it('refuses values that symbology cannot carry', () => {
    expect(encodeBars('5901234123458', 'ean13')).toBeNull()   // wrong check digit
    expect(encodeBars('123', 'ean13')).toBeNull()
    expect(encodeBars('abc', 'code39')).toBeNull()             // lower case is not in Code 39
    expect(encodeBars('A*B', 'code39')).toBeNull()
    expect(encodeBars('café', 'code128')).toBeNull()
    expect(encodeBars('', 'code128')).toBeNull()
    expect(encodeBars('123', 'pdf417')).toBeNull()
  })
})

// Modules → a luminance row the way a camera might see it: `scale` px per module, an uneven
// edge (every 3rd module a pixel wider) and some grey noise.
function toRow(mods, scale = 3) {
  const row = []
  mods.forEach((m, i) => {
    const n = scale + (i % 3 === 0 ? 1 : 0)
    for (let k = 0; k < n; k++) row.push((m ? 30 : 220) + ((row.length * 37) % 25))
  })
  return Uint8Array.from(row)
}

const CASES = [
  ['MEMBER-0042', 'code128'],
  ['00123456789012', 'code128'],
  ['Fit Zone #7', 'code128'],
  ['GYM 4471', 'code39'],
  ['5901234123457', 'ean13'],
  ['96385074', 'ean8'],
]

describe('decodeBarsRow', () => {
  it.each(CASES)('reads back %s (%s)', (value, fmt) => {
    expect(decodeBarsRow(toRow(encodeBars(value, fmt)))).toEqual({ value, fmt })
  })

  it.each(CASES)('reads %s (%s) upside down too', (value, fmt) => {
    expect(decodeBarsRow(toRow(encodeBars(value, fmt)).reverse())).toEqual({ value, fmt })
  })

  it('a UPC-A comes back as its EAN-13 form, which draws the same bars', () => {
    expect(decodeBarsRow(toRow(encodeBars('036000291452', 'upca')))).toEqual({ value: '0036000291452', fmt: 'ean13' })
  })

  it('finds nothing in a flat row or in random stripes', () => {
    expect(decodeBarsRow(new Uint8Array(300).fill(200))).toBeNull()
    const junk = Uint8Array.from({ length: 600 }, (_, i) => ((i * 7919) % 13) > 6 ? 20 : 230)
    expect(decodeBarsRow(junk)).toBeNull()
  })
})

describe('decodeBarcodeImage', () => {
  // A barcode across the middle band of a white image, the rest left blank.
  function image(value, fmt) {
    const row = toRow(encodeBars(value, fmt), 2)
    const width = row.length + 40, height = 120
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    for (let y = 30; y < 90; y++) {
      for (let x = 0; x < row.length; x++) {
        const i = (y * width + x + 20) * 4
        data[i] = data[i + 1] = data[i + 2] = row[x]
      }
    }
    return { data, width, height }
  }

  it('reads a code from an image', () => {
    expect(decodeBarcodeImage(image('MEMBER-0042', 'code128'))).toEqual({ value: 'MEMBER-0042', fmt: 'code128' })
    expect(decodeBarcodeImage(image('GYM4471', 'code39'))).toEqual({ value: 'GYM4471', fmt: 'code39' })
  })

  it('returns null for a blank image and junk input', () => {
    expect(decodeBarcodeImage({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 })).toBeNull()
    expect(decodeBarcodeImage(null)).toBeNull()
  })
})

describe('drawBarsToCanvas', () => {
  // A canvas stand-in that records the dark rectangles drawn on it.
  const fakeCanvas = () => {
    const rects = []
    const ctx = { fillStyle: '', fillRect: (x, y, w, h) => { if (ctx.fillStyle === '#000000') rects.push([x, w]) } }
    return { rects, width: 0, height: 0, getContext: () => ctx }
  }

  it('gives every module the same whole number of pixels, so no bar comes out wider than another', () => {
    const c = fakeCanvas()
    const mods = encodeBars('MEMBER-0042', 'code128')
    expect(drawBarsToCanvas(c, 'MEMBER-0042', 'code128', 604)).toBe(mods.length)
    const k = Math.floor(604 / mods.length)                     // 3 on a 2.625 dpr phone at 230 px
    expect(c.width).toBe(mods.length * k)
    expect(c.rects.every(([x, w]) => w === k && x % k === 0)).toBe(true)
  })

  it('falls back to 1 px per module when the space is smaller than the code, and draws nothing it cannot encode', () => {
    const c = fakeCanvas()
    expect(drawBarsToCanvas(c, '5901234123457', 'ean13', 50)).toBe(c.width)
    expect(drawBarsToCanvas(fakeCanvas(), '123', 'ean13', 600)).toBe(0)
  })
})
