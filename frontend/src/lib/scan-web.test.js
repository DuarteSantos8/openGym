import { afterEach, describe, it, expect, vi } from 'vitest'
import { generate } from 'lean-qr'
import JsBarcode from 'jsbarcode'
import { decodeImageData } from './scan-web.js'
import { renderCodeToCanvas, validateCode } from './qr.js'

// Round trip through the two libraries the browser path relies on: lean-qr draws a code (the
// same renderer the card view uses), ZXing reads it back. Pixels are built by hand from
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

// A tiny raster canvas lets the real JsBarcode renderer draw bars without a browser or a
// native canvas dependency. ZXing then independently checks those pixels, not encoder mocks.
async function barcodeImage(value, fmt, render = renderCodeToCanvas) {
  let xOffset = 0, yOffset = 0
  const rectangles = []
  const ctx = {
    save() {}, restore() {}, clearRect() {},
    translate(x, y) { xOffset += x; yOffset += y },
    fillRect(x, y, w, h) { rectangles.push({ x: x + xOffset, y: y + yOffset, w, h, dark: this.fillStyle === '#000000' }) },
  }
  const canvas = { width: 0, height: 0, getContext: () => ctx }
  await render(canvas, value, fmt)
  const { width, height } = canvas
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const r of rectangles) {
    for (let y = Math.max(0, r.y); y < Math.min(height, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(width, r.x + r.w); x++) {
        const i = (y * width + x) * 4, v = r.dark ? 0 : 255
        data[i] = v; data[i + 1] = v; data[i + 2] = v
      }
    }
  }
  return { data, width, height }
}

function rotateImage({ data, width, height }) {
  const rotated = new Uint8ClampedArray(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (x * height + height - y - 1) * 4
      rotated.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), target)
    }
  }
  return { data: rotated, width: height, height: width }
}

describe('decodeImageData', () => {
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

  it.each([
    ['code128', ' 00123456789\t'], ['code39', ' 00123 ABC '], ['code93', 'Gym-lowercase-123'],
    ['ean13', '5901234123457'], ['ean8', '96385074'], ['upca', '012345678905'],
    ['itf', '001234567890'], ['codabar', 'A0012345B'],
  ])('reads back %s with the original value and format', async (fmt, value) => {
    expect(await decodeImageData(await barcodeImage(value, fmt))).toEqual({ value, fmt })
  })

  it('reads a barcode photographed sideways', async () => {
    const value = 'MEMBER-0042'
    const image = rotateImage(await barcodeImage(value, 'code128'))
    expect(await decodeImageData(image)).toEqual({ value, fmt: 'code128' })
  })

  it('preserves GS1-128 markers so an unsupported payload cannot be silently saved', async () => {
    const image = await barcodeImage('010123456789012810ABC\xcf2199', 'code128', (canvas, value) => {
      JsBarcode(canvas, value, { format: 'CODE128', ean128: true, displayValue: false,
        width: 2, height: 90, margin: 20, background: '#ffffff', lineColor: '#000000' })
    })
    const hit = await decodeImageData(image)
    expect(hit).toEqual({ value: ']C1010123456789012810ABC\x1d2199', fmt: 'code128' })
    expect(await validateCode(hit.value, hit.fmt)).toBe(false)
  })

  it('still reads inverted QR codes', async () => {
    const value = 'MEMBER-INVERTED', image = rasterize(generate(value))
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 255 - image.data[i]
      image.data[i + 1] = 255 - image.data[i + 1]
      image.data[i + 2] = 255 - image.data[i + 2]
    }
    expect(await decodeImageData(image)).toEqual({ value, fmt: 'qrcode' })
  })

  it('returns null for blank pixels and for junk input', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decodeImageData(blank)).toBeNull()
    expect(await decodeImageData(null)).toBeNull()
    expect(await decodeImageData({ data: null, width: 1, height: 1 })).toBeNull()
  })
})

describe('native browser detector', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  function mockCanvas() {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
      drawImage() {}, getImageData: () => blank,
    }) }) })
  }

  it('requests only supported, renderable formats and preserves the detected format', async () => {
    const constructed = vi.fn()
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats() { return Promise.resolve(['qr_code', 'code_128', 'aztec']) }
      constructor(options) { constructed(options) }
      detect() { return Promise.resolve([{ rawValue: '001234', format: 'code_128' }]) }
    })
    mockCanvas()
    const { decodeSource } = await import('./scan-web.js')
    expect(await decodeSource({ width: 64, height: 64 })).toEqual({ value: '001234', fmt: 'code128' })
    expect(constructed).toHaveBeenCalledWith({ formats: ['qr_code', 'code_128'] })
  })

  it('does not guess QR when a native detector omits the format', async () => {
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats() { return Promise.resolve(['qr_code']) }
      detect() { return Promise.resolve([{ rawValue: '001234' }]) }
    })
    mockCanvas()
    const { decodeSource } = await import('./scan-web.js')
    expect(await decodeSource({ width: 64, height: 64 })).toBeNull()
  })
})
