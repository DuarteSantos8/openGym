import { describe, expect, it } from 'vitest'
import { decodeBase64Text, decodeResultQr, isLfCode, parseLfUrl } from './qr.js'

// A summary as a console puts it into its end-of-workout code (format: result.js).
const SUMMARY = { bs: 'BS123', id: 'a1b2c3d4-0000-4000-8000-000000000001', t: 42, et: 1830, c: 312, d: { v: 12.4, u: 1 }, ahr: 142, aw: 180, ar: 85, al: 8, dt: 'Fri Oct 17 18:05:12 CEST 2026' }
const b64 = obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')

describe('isLfCode', () => {
  it('knows LFconnect and Halo Fitness codes, nothing else', () => {
    expect(isLfCode('https://lfconnect.com/q?t=c&a=AB12')).toBe(true)
    expect(isLfCode('https://HALO.fitness/q?t=c')).toBe(true)
    expect(isLfCode('opengym:ex:4f7k')).toBe(false)
    expect(isLfCode('https://example.com/?lf=1')).toBe(false)
    expect(isLfCode(null)).toBe(false)
  })
})

describe('parseLfUrl', () => {
  it('a result code: the summary JSON, decoded', () => {
    const r = parseLfUrl(`https://lfconnect.com/q?t=c&r=${b64(SUMMARY)}`)
    expect(r.kind).toBe('result')
    expect(r.data).toEqual(SUMMARY)
    expect(r.isQa).toBe(false)
  })

  it('keeps a "+" in the Base64 a "+", the way Android reads the parameter', () => {
    // '>>>' encodes to "Pj4+": a + that URLSearchParams would turn into a space
    const data = { id: 'x', et: 60, note: '>>>' }
    const enc = b64(data)
    expect(enc).toContain('+')
    expect(parseLfUrl(`https://lfconnect.com/q?t=c&r=${enc}`).data).toEqual(data)
    expect(parseLfUrl(`https://lfconnect.com/q?t=c&r=${encodeURIComponent(enc)}`).data).toEqual(data)
  })

  it('URL-safe Base64 without padding is read too', () => {
    const enc = b64(SUMMARY).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(parseLfUrl(`https://lfconnect.com/q?t=c&r=${enc}`).data).toEqual(SUMMARY)
  })

  it('a broken payload is an invalid code, not a crash', () => {
    expect(parseLfUrl('https://lfconnect.com/q?t=c&r=%%%').kind).toBe('invalid')
    expect(parseLfUrl(`https://lfconnect.com/q?t=c&r=${Buffer.from('not json').toString('base64')}`).kind).toBe('invalid')
    expect(parseLfUrl(`https://lfconnect.com/q?t=c&r=${Buffer.from('[1,2]').toString('base64')}`).kind).toBe('invalid')
  })

  it('a connect code: the fields the Bluetooth scan matches on', () => {
    expect(parseLfUrl('https://lfconnect.com/q?t=c&a=7F3A&u=9c1e&l=SN0042&x=77&c=1')).toEqual({
      kind: 'ble', a: '7F3A', u: '9c1e', l: 'SN0042', x: '77', online: true, isQa: false,
    })
  })

  it('the QA environment is flagged', () => {
    expect(parseLfUrl('https://vtqa.lfconnect.com/q?t=c&a=1').isQa).toBe(true)
  })

  it('console logins and strength machines are not ours', () => {
    expect(parseLfUrl('https://lfconnect.com/q?t=c&s=abc')).toMatchObject({ kind: 'unsupported', type: 'console-login' })
    expect(parseLfUrl('https://lfconnect.com/q?t=s&m=s360mbr')).toMatchObject({ kind: 'unsupported', type: 'strength' })
    expect(parseLfUrl('http://www.halo.fitness/sbsdip')).toMatchObject({ kind: 'unsupported' })
  })

  it('anything else is not a Life Fitness code', () => {
    expect(parseLfUrl('opengym:ex:abcd')).toBeNull()
  })
})

describe('decodeBase64Text / decodeResultQr', () => {
  it('UTF-8 survives', () => {
    expect(decodeBase64Text(Buffer.from('Größe', 'utf8').toString('base64'))).toBe('Größe')
  })
  it('nothing in, nothing out', () => {
    expect(decodeBase64Text('')).toBeNull()
    expect(decodeResultQr(undefined)).toBeNull()
  })
})
