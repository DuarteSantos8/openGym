import { describe, it, expect } from 'vitest'
import { normalizeFmt, canRenderFmt, canRenderCode, cardCodeValue } from './qr.js'

// The QR helpers decide which scanned/typed codes the check-in feature will store: it can read
// many symbologies but only redraw QR and Code 128, so canRenderFmt is the gate, and normalizeFmt is what
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
  it('accepts QR and Code 128, in any spelling', () => {
    expect(canRenderFmt('QR_CODE')).toBe(true)
    expect(canRenderFmt('QrCode')).toBe(true)
    expect(canRenderFmt('qr')).toBe(true)
    // BarcodeDetector says 'code_128', mlkit 'CODE_128'
    expect(canRenderFmt('code_128')).toBe(true)
    expect(canRenderFmt('CODE_128')).toBe(true)
  })

  it('rejects 1D and other 2D symbologies we cannot faithfully redraw', () => {
    // These are readable by the scanner but we can't reproduce them, so a card in one of
    // these formats must never be stored — it would display as the wrong bars at the turnstile.
    for (const fmt of ['EAN_13', 'EAN_8', 'CODE_39', 'ITF', 'UPC_A', 'PDF_417', 'AZTEC', 'DATA_MATRIX']) {
      expect(canRenderFmt(fmt)).toBe(false)
    }
  })

  it('rejects empty / unknown formats', () => {
    expect(canRenderFmt('')).toBe(false)
    expect(canRenderFmt(null)).toBe(false)
    expect(canRenderFmt('something-else')).toBe(false)
  })
})

describe('cardCodeValue', () => {
  it('trims a QR value, as cards always have been', () => {
    expect(cardCodeValue('  MEMBER-9931  ', 'qrcode')).toBe('MEMBER-9931')
    expect(cardCodeValue(' x ', undefined)).toBe('x')
  })
  it('keeps a Code 128 value byte for byte: the edge spaces are in the bars', () => {
    expect(cardCodeValue(' 42 ', 'CODE_128')).toBe(' 42 ')
  })
  it('treats a missing value as empty', () => {
    expect(cardCodeValue(undefined, 'code128')).toBe('')
    expect(cardCodeValue(null, 'qrcode')).toBe('')
  })
})

describe('canRenderCode', () => {
  it('accepts a QR value and a Code 128 value set B or C can carry', () => {
    expect(canRenderCode('MEMBER\u001d42', 'qrcode')).toBe(true)     // a QR carries any text
    expect(canRenderCode('1000009779', 'code128')).toBe(true)
    expect(canRenderCode(' 42 ', 'code_128')).toBe(true)
  })
  it('refuses a Code 128 value with a control character (a GS1 FNC1 separator) or non-ASCII', () => {
    expect(canRenderCode('MEMBER\u001d42', 'code128')).toBe(false)
    expect(canRenderCode('CAFÉ-1', 'code128')).toBe(false)
  })
  it('refuses an empty value, and a symbology we cannot draw at all', () => {
    expect(canRenderCode('   ', 'qrcode')).toBe(false)
    expect(canRenderCode('', 'code128')).toBe(false)
    expect(canRenderCode('5901234123457', 'ean13')).toBe(false)
  })
})
