import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ZXing is the fallback for browsers whose BarcodeDetector is missing or cannot read the product
// formats. A browser that can read them, and sees nothing in a frame, must not pay for a ZXing
// pass on every frame (NOTICE.md says ZXing is the fallback only).
const zxing = vi.hoisted(() => ({ reads: 0 }))
vi.mock('@zxing/library', () => {
  class MultiFormatReader {
    setHints() {}
    decodeWithState() { zxing.reads++; throw new Error('not found') }
  }
  return {
    MultiFormatReader,
    DecodeHintType: { POSSIBLE_FORMATS: 1, TRY_HARDER: 2 },
    BarcodeFormat: { EAN_13: 1, EAN_8: 2, UPC_A: 3, UPC_E: 4 },
    BinaryBitmap: class {},
    HybridBinarizer: class {},
    RGBLuminanceSource: class {},
  }
})

const { decodeSource, resetProductDetector } = await import('./scan-web.js')

const ALL = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
const frame = { width: 64, height: 64 }
const detects = { result: [] }

function installDetector(formats) {
  vi.stubGlobal('BarcodeDetector', class {
    static getSupportedFormats() { return Promise.resolve(formats) }
    detect() { return Promise.resolve(detects.result) }
  })
}

beforeEach(() => {
  zxing.reads = 0
  detects.result = []
  resetProductDetector()
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }) }),
    }),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('decodeSource for product barcodes', () => {
  it('with a native detector that reads all four formats, an empty frame is null and ZXing never loads', async () => {
    installDetector(ALL)
    expect(await decodeSource(frame, { product: true })).toBeNull()
    expect(zxing.reads).toBe(0)
  })

  it('returns what the native detector reads', async () => {
    installDetector(ALL)
    detects.result = [{ rawValue: '3017620422003', format: 'ean_13' }]
    expect((await decodeSource(frame, { product: true })).value).toBe('3017620422003')
    expect(zxing.reads).toBe(0)
  })

  it('with a native detector missing a format, ZXing reads the frame', async () => {
    installDetector(['ean_13', 'qr_code'])
    expect(await decodeSource(frame, { product: true })).toBeNull()
    expect(zxing.reads).toBe(1)
  })

  it('without BarcodeDetector, ZXing reads the frame', async () => {
    expect(await decodeSource(frame, { product: true })).toBeNull()
    expect(zxing.reads).toBe(1)
  })
})
