import { describe, it, expect } from 'vitest'
import { generate } from 'lean-qr'
import { decodeImageData } from './scan-web.js'
import JsBarcode from 'jsbarcode'

function barcodePixels(value, format) {
  const target = {}
  JsBarcode(target, value, { format, displayValue: false })
  const bits = target.encodings.map(e => e.data).join('')
  const width = (bits.length + 40) * 3, height = 120
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 10; y < height - 10; y++) {
    for (let x = 0; x < width; x++) {
      if (bits[Math.floor(x / 3) - 20] === '1') {
        const p = (y * width + x) * 4
        data[p] = data[p + 1] = data[p + 2] = 0
      }
    }
  }
  return { data, width, height }
}

// Round trip through the two libraries the browser path relies on: lean-qr draws a code (the
// same renderer the card view uses), jsQR reads it back. Pixels are built by hand from
// code.get(x, y) — no canvas in this environment — scaled 4× with a 4-module quiet zone, which
// is what a phone camera would roughly see.
function rasterize(code, scale = 4, quiet = 4) {
  const n = code.size + quiet * 2
  const w = n * scale
  const data = new Uint8ClampedArray(w * w * 4)
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet
      const dark = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my)
      const v = dark ? 0 : 255
      const i = (y * w + x) * 4
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  return { data, width: w, height: w }
}

describe('decodeImageData', () => {
  it.each([['CODE128', 'code128', '000123456789'], ['CODE39', 'code39', 'YMCA12345'],
    ['EAN13', 'ean13', '5901234123457'], ['ITF', 'itf', '00123456']])(
    'reads rendered %s bars without changing the value or format', async (format, fmt, value) => {
      expect(await decodeImageData(barcodePixels(value, format))).toEqual({ value, fmt })
    })
  it('reads back a code lean-qr generated', async () => {
    const value = 'MEMBER-0042-FITZONE'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit).toEqual({ value, fmt: 'qrcode' })
  })

  it('reads a URL-shaped code, the other common gym format', async () => {
    const value = 'https://checkin.example.com/m/8f3a1c?v=2'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit?.value).toBe(value)
  })

  it('returns null for blank pixels and for junk input', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decodeImageData(blank)).toBeNull()
    expect(await decodeImageData(null)).toBeNull()
    expect(await decodeImageData({ data: null, width: 1, height: 1 })).toBeNull()
  })
})
