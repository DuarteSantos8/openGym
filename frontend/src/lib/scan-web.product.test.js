import { describe, expect, it } from 'vitest'
import { generate } from 'lean-qr'
import { decodeProductImageData } from './scan-web.js'

// The decoder the browser path falls back to (iOS Safari has no BarcodeDetector), fed pixels drawn
// from a barcode encoded here by the book (ZXing ships no EAN writer): left digits in the L and G
// sets chosen by the first digit's parity, right digits in R, guard bars between. No canvas, as
// scan-web.test.js does for QR.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = L.map(code => [...code].map(b => (b === '0' ? '1' : '0')).join(''))
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function ean13Modules(code) {
  const d = [...code].map(Number)
  const left = d.slice(1, 7).map((n, i) => (PARITY[d[0]][i] === 'L' ? L[n] : G[n])).join('')
  return '101' + left + '01010' + d.slice(7).map(n => R[n]).join('') + '101'
}
const ean8Modules = code => {
  const d = [...code].map(Number)
  return '101' + d.slice(0, 4).map(n => L[n]).join('') + '01010' + d.slice(4).map(n => R[n]).join('') + '101'
}

// Bars as pixels: `scale` pixels a module, 10 modules of white either side, `height` rows.
function draw(modules, { scale = 3, height = 90 } = {}) {
  const quiet = 10
  const width = (modules.length + quiet * 2) * scale
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = Math.floor(x / scale) - quiet
      if (m >= 0 && m < modules.length && modules[m] === '1') {
        const i = (y * width + x) * 4
        data[i] = data[i + 1] = data[i + 2] = 0
      }
    }
  }
  return { data, width, height }
}

describe('decodeProductImageData', () => {
  it('reads an EAN-13', async () => {
    expect(await decodeProductImageData(draw(ean13Modules('3017620422003')))).toEqual({ value: '3017620422003', fmt: 'ean13' })
  })

  it('reads an EAN-8', async () => {
    expect(await decodeProductImageData(draw(ean8Modules('96385074')))).toEqual({ value: '96385074', fmt: 'ean8' })
  })

  it('reads a UPC-A, which is an EAN-13 with a leading 0', async () => {
    const hit = await decodeProductImageData(draw(ean13Modules('0036000291452')))
    expect(hit?.value).toBe('036000291452')
    expect(hit?.fmt).toBe('upca')
  })

  it('reads a barcode at the size a phone frame gives it', async () => {
    for (const scale of [3, 4, 6]) {
      expect((await decodeProductImageData(draw(ean13Modules('5012345678900'), { scale })))?.value).toBe('5012345678900')
    }
  })

  it('refuses a code whose check digit is wrong, rather than naming another product', async () => {
    expect(await decodeProductImageData(draw(ean13Modules('5012345678901')))).toBeNull()
  })

  it('does not read a QR code: the product scanner is for product barcodes', async () => {
    const code = generate('https://example.com/card')
    const scale = 4
    const quiet = 4
    const width = (code.size + quiet * 2) * scale
    const data = new Uint8ClampedArray(width * width * 4)
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const mx = Math.floor(x / scale) - quiet
        const my = Math.floor(y / scale) - quiet
        const i = (y * width + x) * 4
        data[i] = data[i + 1] = data[i + 2] = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my) ? 0 : 255
        data[i + 3] = 255
      }
    }
    expect(await decodeProductImageData({ data, width, height: width })).toBeNull()
  })

  it('returns null for blank pixels and for junk input', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decodeProductImageData(blank)).toBeNull()
    expect(await decodeProductImageData(null)).toBeNull()
    expect(await decodeProductImageData({ data: null, width: 1, height: 1 })).toBeNull()
  })
})
