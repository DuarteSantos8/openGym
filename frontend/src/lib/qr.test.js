import { describe, it, expect } from 'vitest'
import { normalizeFmt, canRenderFmt, validateCode, renderCodeToCanvas } from './qr.js'

// The QR helpers decide which scanned/typed codes the check-in feature will store: it can read
// many symbologies but must redraw the same format, so canRenderFmt is the gate, and normalizeFmt is what
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
  it('accepts QR, in any spelling', () => {
    expect(canRenderFmt('QR_CODE')).toBe(true)
    expect(canRenderFmt('QrCode')).toBe(true)
    expect(canRenderFmt('qr')).toBe(true)
  })

  it('accepts the 1D formats supported by both the scanners and renderer', () => {
    for (const fmt of ['EAN_13', 'EAN_8', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'UPC_A', 'CODABAR']) {
      expect(canRenderFmt(fmt)).toBe(true)
    }
  })

  it('rejects formats we cannot redraw', () => {
    for (const fmt of ['PDF_417', 'AZTEC', 'DATA_MATRIX', 'MSI', 'UPC_E']) {
      expect(canRenderFmt(fmt)).toBe(false)
    }
  })

  it('rejects empty / unknown formats', () => {
    expect(canRenderFmt('')).toBe(false)
    expect(canRenderFmt(null)).toBe(false)
    expect(canRenderFmt('something-else')).toBe(false)
  })
})

describe('validateCode', () => {
  it('accepts exact values including leading zeroes, whitespace and control characters', async () => {
    expect(await validateCode(' 00123\t', 'CODE_128')).toBe(true)
    expect(await validateCode(' 00123 ', 'CODE_39')).toBe(true)
    expect(await validateCode('lowercase\n123', 'CODE_93')).toBe(true)
    expect(await validateCode(' 00123 ', 'QR_CODE')).toBe(true)
  })

  it('rejects invalid check digits and incomplete numeric codes', async () => {
    for (const [value, fmt] of [['5901234123458', 'ean13'], ['590123412345', 'ean13'],
      ['96385075', 'ean8'], ['012345678906', 'upca'], ['04252615', 'upce'], ['425261', 'upce'], ['123', 'itf']]) {
      expect(await validateCode(value, fmt), `${fmt}: ${value}`).toBe(false)
    }
  })

  it('rejects values the renderer would change or cannot encode', async () => {
    for (const [value, fmt] of [['lowercase', 'code39'], ['é', 'code128'], ['é', 'code93'],
      ['', 'qrcode'], ['123', 'aztec'], [null, 'qrcode'], [123, 'code128']]) {
      expect(await validateCode(value, fmt), `${fmt}: ${value}`).toBe(false)
    }
  })

  it('refuses GS1-128 markers instead of generating a different plain Code 128', async () => {
    expect(await validateCode(']C10101234567890128', 'code128')).toBe(false)
    expect(await validateCode('010123456789012810ABC\x1d2199', 'code128')).toBe(false)
  })
})

describe('renderCodeToCanvas', () => {
  it('never silently converts an unsupported barcode to QR', async () => {
    await expect(renderCodeToCanvas({}, '123456', 'PDF_417')).rejects.toThrow('Unsupported barcode format')
  })
})
