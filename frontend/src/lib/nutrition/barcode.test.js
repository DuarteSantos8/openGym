// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { normalizeBarcode, upcEToUpcA } from './barcode.js'

describe('normalizeBarcode', () => {
  it('keeps an EAN-13 and an EAN-8 as they are', () => {
    expect(normalizeBarcode('3017620422003')).toBe('3017620422003')
    expect(normalizeBarcode('96385074')).toBe('96385074')
  })

  it('files a UPC-A under its EAN-13', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452')
  })

  it('refuses what is not 8 to 14 digits', () => {
    expect(normalizeBarcode('1234567')).toBeNull()
    expect(normalizeBarcode('hello')).toBeNull()
  })

  it('expands a UPC-E to the UPC-A it compresses, then to its EAN-13', () => {
    expect(upcEToUpcA('01234565')).toBe('012345000065')
    expect(normalizeBarcode('01234565')).toBe('0012345000065')
  })

  it.each([
    ['04252614', '042100005264'], // last digit 4
    ['01234537', '012300000457'], // last digit 3
    ['01234565', '012345000065'], // last digit 5-9
  ])('expands every UPC-E form (%s)', (e, a) => {
    expect(upcEToUpcA(e)).toBe(a)
  })

  it('leaves an 8-digit code whose UPC-A check fails as an EAN-8', () => {
    expect(normalizeBarcode('01234560')).toBe('01234560')
  })
})
