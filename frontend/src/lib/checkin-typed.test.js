import { describe, expect, it } from 'vitest'
import { checkTyped, hasCheckDigit, normalizeTyped, TYPED_FMTS } from './checkin-typed.js'

describe('typing a gym card by hand', () => {
  it('EAN-13, EAN-8 and UPC-A must pass their check digit, no second entry', () => {
    expect(checkTyped('4006381333931', 'ean13')).toEqual({ ok: true, value: '4006381333931' })
    expect(checkTyped('4006 3813-3393 1', 'ean13')).toEqual({ ok: true, value: '4006381333931' })
    expect(checkTyped('4006381333932', 'ean13')).toEqual({ ok: false, why: 'check' })      // one digit off
    expect(checkTyped('4006381333391', 'ean13').why).toBe('check')                        // two swapped
    expect(checkTyped('400638133393', 'ean13')).toEqual({ ok: false, why: 'length', want: 13 })
    expect(checkTyped('40063813339a1', 'ean13').why).toBe('digits')
    expect(checkTyped('96385074', 'ean8')).toEqual({ ok: true, value: '96385074' })
    expect(checkTyped('96385075', 'ean8').why).toBe('check')
    expect(checkTyped('036000291452', 'upca')).toEqual({ ok: true, value: '036000291452' })
    expect(checkTyped('036000291453', 'upca').why).toBe('check')
    for (const f of ['ean13', 'ean8', 'upca']) expect(hasCheckDigit(f)).toBe(true)
  })

  it('Code 128, Code 39 and QR text are typed twice and must match', () => {
    expect(checkTyped('M-10442', 'code128')).toEqual({ ok: false, why: 'again' })
    expect(checkTyped('M-10442', 'code128', 'M-10424')).toEqual({ ok: false, why: 'mismatch' })
    expect(checkTyped(' M-10442 ', 'code128', 'M-10442')).toEqual({ ok: true, value: 'M-10442' })
    expect(checkTyped('ab-12', 'code39', 'AB-12')).toEqual({ ok: true, value: 'AB-12' })        // Code 39 is upper case
    expect(checkTyped('AB_12', 'code39', 'AB_12').why).toBe('chars')
    expect(checkTyped('Grüezi', 'code128', 'Grüezi').why).toBe('chars')
    expect(checkTyped('member:4711?gym=fitbox', 'qrcode', 'member:4711?gym=fitbox').ok).toBe(true)
    expect(checkTyped('x'.repeat(513), 'qrcode', 'x'.repeat(513))).toEqual({ ok: false, why: 'long', max: 512 })
    expect(checkTyped('', 'qrcode').why).toBe('empty')
    for (const f of ['code128', 'code39', 'qrcode']) expect(hasCheckDigit(f)).toBe(false)
  })

  it('offers every format the card screen can draw', () => {
    expect(TYPED_FMTS.sort()).toEqual(['code128', 'code39', 'ean13', 'ean8', 'qrcode', 'upca'])
    expect(normalizeTyped('12 34-5', 'upca')).toBe('12345')
  })
})
