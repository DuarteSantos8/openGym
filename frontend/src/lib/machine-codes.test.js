import { describe, expect, it } from 'vitest'
import { cleanText, codeFromQr, codeFromNfc, isRandomUid, refusal, codesOf, exercisesFor, link, unlink, shownCode, searchHint } from './machine-codes.js'

describe('cleaning', () => {
  it('drops controls and bidi overrides, trims, caps at 512', () => {
    expect(cleanText('  ab\u0000c‮d\n ')).toBe('abcd')
    expect(cleanText('x'.repeat(513))).toBe(null)
    expect(cleanText('   ')).toBe(null)
  })
  it('composed and decomposed text are one code', () => {
    expect(codeFromQr('caf\u00e9')).toBe(codeFromQr('cafe\u0301'))
  })
  it('prefixes text and uid codes', () => {
    expect(codeFromQr(' https://brand.com/m/12 ')).toBe('t:https://brand.com/m/12')
    expect(codeFromNfc({ uid: '04a25b11223344', records: [] })).toBe('uid:04A25B11223344')
    expect(codeFromNfc({ uid: '04a2', records: [{ type: 'text', value: 'T' }, { type: 'uri', value: 'https://a.b/c' }] })).toBe('t:https://a.b/c')
  })
  it('a QR and a tag with the same URL are one code', () => {
    expect(codeFromQr('https://a.b/c')).toBe(codeFromNfc({ records: [{ type: 'uri', value: 'https://a.b/c' }] }))
  })
  it('spots random UIDs', () => {
    expect(isRandomUid('08A1B2C3')).toBe(true)
    expect(isRandomUid('04A25B11223344')).toBe(false)
    expect(isRandomUid('08A25B11223344')).toBe(false)
  })
})

describe('refusal', () => {
  const S = { gymCards: [{ id: 'g1', value: '123456' }] }
  it('refuses openGym codes, gym cards, random UIDs', () => {
    expect(refusal(S, 't:https://opengym.ch/nfc?ex=0150', { own: true })).toBe('own')
    expect(refusal(S, 't:123456')).toBe('gym-card')
    expect(refusal(S, 'uid:08A1B2C3')).toBe('random-uid')
    expect(refusal(S, null)).toBe('empty')
    expect(refusal(S, 't:https://brand.com/m/12')).toBe(null)
  })
})

describe('the map', () => {
  it('links many codes to one exercise and one code to many', () => {
    const S = { machineCodes: {} }
    link(S, '0150', 't:A'); link(S, '0150', 'uid:04'); link(S, '0151', 't:A'); link(S, '0150', 't:A')
    expect(codesOf(S, '0150')).toEqual(['t:A', 'uid:04'])
    expect(exercisesFor(S, 't:A')).toEqual(['0150', '0151'])
  })
  it('only takes the code off every other exercise', () => {
    const S = { machineCodes: { '0150': ['t:A'], '0151': ['t:A', 't:B'] } }
    link(S, '0152', 't:A', { only: true })
    expect(S.machineCodes).toEqual({ '0151': ['t:B'], '0152': ['t:A'] })
  })
  it('removing the last code drops the key', () => {
    const S = { machineCodes: { '0150': ['t:A'] } }
    unlink(S, '0150', 't:A')
    expect(S.machineCodes).toEqual({})
  })
  it('exercisesFor drops unknown ids', () => {
    expect(exercisesFor({ machineCodes: { 'cGONE': ['t:A'], '0150': ['t:A'] } }, 't:A')).toEqual(['0150'])
  })
  it('keeps custom exercises', () => {
    expect(exercisesFor({ customEx: [{ id: 'cMine' }], machineCodes: { cMine: ['t:A'] } }, 't:A')).toEqual(['cMine'])
  })
  it('a code reading __proto__ is plain data', () => {
    const S = { machineCodes: {} }
    link(S, '0150', codeFromQr('__proto__'))
    expect(exercisesFor(S, 't:__proto__')).toEqual(['0150'])
    expect(Object.getPrototypeOf(S.machineCodes)).toBe(Object.prototype)
  })
})

describe('showing and searching', () => {
  it('shortens for lists, never with markup', () => {
    expect(shownCode('t:https://www.brand.com/m/12')).toBe('QR brand.com/m/12')
    expect(shownCode('uid:04A25B11')).toBe('NFC 04:A2:5B:11')
  })
  it('takes search words from a product URL only', () => {
    expect(searchHint('t:https://brand.com/products/lat-pulldown-plate-loaded.html')).toBe('lat pulldown plate loaded')
    expect(searchHint('t:https://x.co/a8F3k')).toBe('')
    expect(searchHint('t:https://brand.com/m/12345')).toBe('')
    expect(searchHint('uid:04A25B11')).toBe('')
    expect(searchHint('t:https://brand.com/%E0%A4%A')).toBe('')
  })
})
