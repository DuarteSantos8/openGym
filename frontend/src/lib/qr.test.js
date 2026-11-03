import { describe, it, expect } from 'vitest'
import { normalizeFmt, canRenderFmt } from './qr.js'

// The QR helpers decide which scanned/typed codes the check-in feature will store: it can read
// many symbologies but only redraw QR and a few 1D barcodes, so canRenderFmt is the gate, and
// normalizeFmt is what folds every spelling mlkit might report into the single token everything
// else compares on.

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
  it('accepts QR, in any spelling', () => {
    expect(canRenderFmt('QR_CODE')).toBe(true)
    expect(canRenderFmt('QrCode')).toBe(true)
    expect(canRenderFmt('qr')).toBe(true)
  })

  it('accepts the 1D barcodes lib/barcode.js can draw, as ML Kit and BarcodeDetector name them', () => {
    for (const fmt of ['EAN_13', 'EAN_8', 'CODE_128', 'CODE_39', 'UPC_A', 'ean_13', 'code_128', 'upc_a']) {
      expect(canRenderFmt(fmt)).toBe(true)
    }
  })

  it('rejects symbologies we cannot faithfully redraw', () => {
    // Readable by the scanner, but a card stored in one of these would display as the wrong
    // bars at the turnstile.
    for (const fmt of ['ITF', 'UPC_E', 'CODABAR', 'CODE_93', 'PDF_417', 'AZTEC', 'DATA_MATRIX']) {
      expect(canRenderFmt(fmt)).toBe(false)
    }
  })

  it('rejects empty / unknown formats', () => {
    expect(canRenderFmt('')).toBe(false)
    expect(canRenderFmt(null)).toBe(false)
    expect(canRenderFmt('something-else')).toBe(false)
  })
})
