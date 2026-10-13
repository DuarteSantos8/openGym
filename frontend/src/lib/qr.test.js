import { describe, it, expect } from 'vitest'
import { normalizeFmt, canRenderFmt } from './qr.js'

// The QR helpers decide which scanned/typed codes the check-in feature will store: it can read
// many symbologies but only redraw QR, so canRenderFmt is the gate, and normalizeFmt is what
// folds every spelling mlkit might report into the single token everything else compares on.

describe('normalizeFmt', () => {
  it('folds every QR spelling to "qrcode"', () => {
    // mlkit's BarcodeFormat, the enum-ish casings, and the casual 'qr' all mean the same thing.
    expect(normalizeFmt('QR_CODE')).toBe('qrcode')
    expect(normalizeFmt('QrCode')).toBe('qrcode')
    expect(normalizeFmt('qrcode')).toBe('qrcode')
    expect(normalizeFmt('qr')).toBe('qrcode')
    expect(normalizeFmt('QR')).toBe('qrcode')
  })

  it('lower-cases and strips separators for other formats', () => {
    expect(normalizeFmt('EAN_13')).toBe('ean13')
    expect(normalizeFmt('Code128')).toBe('code128')
    expect(normalizeFmt('CODE_128')).toBe('code128')
  })

  it('treats empty / nullish as an empty token rather than throwing', () => {
    expect(normalizeFmt('')).toBe('')
    expect(normalizeFmt(null)).toBe('')
    expect(normalizeFmt(undefined)).toBe('')
  })
})

describe('canRenderFmt', () => {
  it.each(['CODE_128', 'CODE_39', 'CODE_93', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'ITF', 'CODABAR'])('accepts supported barcode %s', fmt => {
    expect(canRenderFmt(fmt)).toBe(true)
  })
  it('accepts QR, in any spelling', () => {
    expect(canRenderFmt('QR_CODE')).toBe(true)
    expect(canRenderFmt('QrCode')).toBe(true)
    expect(canRenderFmt('qr')).toBe(true)
  })

  it('rejects unsupported 2D symbologies', () => {
    // These are readable by the scanner but lean-qr can't reproduce them, so a card in one of
    // these formats must never be stored — it would display as the wrong bars at the turnstile.
    for (const fmt of ['PDF_417', 'AZTEC', 'DATA_MATRIX']) {
      expect(canRenderFmt(fmt)).toBe(false)
    }
  })

  it('rejects empty / unknown formats', () => {
    expect(canRenderFmt('')).toBe(false)
    expect(canRenderFmt(null)).toBe(false)
    expect(canRenderFmt('something-else')).toBe(false)
  })
})
