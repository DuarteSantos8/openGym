// Plan > Scan a QR code: what a scanned text is, and so which handler it goes to.
import { describe, it, expect } from 'vitest'
import { routeScannedText, shownText } from './scan-route.js'

describe('routing a scanned code', () => {
  it('sends a friend’s routine link to its preview', () => {
    expect(routeScannedText('https://opengym.ch/r#1.j.e30')).toEqual({ kind: 'routine-link', payload: '1.j.e30' })
    expect(routeScannedText('  opengym.ch/r#1.d.abc  ')).toEqual({ kind: 'routine-link', payload: '1.d.abc' })
    expect(routeScannedText('opengym://r#1.j.e30')).toEqual({ kind: 'routine-link', payload: '1.j.e30' })
  })

  it('sends a library page to the library', () => {
    expect(routeScannedText('https://opengym.ch/routines/bar-and-floor/#copy')).toMatchObject({ kind: 'library', link: { kind: 'routine', slug: 'bar-and-floor' } })
    expect(routeScannedText('www.opengym.ch/routines/ppl-six-days/')).toMatchObject({ kind: 'library', link: { slug: 'ppl-six-days' } })
    expect(routeScannedText('https://opengym.ch/routines/submit/')).toMatchObject({ kind: 'library', link: { kind: 'page' } })
    expect(routeScannedText('https://lib.example/routines/a/', { indexAddress: 'https://lib.example/routines/index.json' })).toMatchObject({ kind: 'library', link: { slug: 'a' } })
  })

  it('sends sticker links to the sticker handler', () => {
    expect(routeScannedText('https://opengym.ch/nfc?do=checkin&card=c1')).toEqual({ kind: 'tag', url: 'https://opengym.ch/nfc?do=checkin&card=c1' })
    expect(routeScannedText('opengym.ch/nfc?ex=0025')).toEqual({ kind: 'tag', url: 'https://opengym.ch/nfc?ex=0025' })
    expect(routeScannedText('opengym://start')).toEqual({ kind: 'tag', url: 'opengym://start' })
  })

  it('shows anything else back as it was read', () => {
    expect(routeScannedText('4006381333931')).toEqual({ kind: 'unknown', text: '4006381333931' })
    expect(routeScannedText('https://example.com/routines/a/')).toEqual({ kind: 'unknown', text: 'https://example.com/routines/a/' })
    expect(routeScannedText('https://opengym.ch/r#not-a-payload')).toMatchObject({ kind: 'unknown' })
    expect(routeScannedText('')).toEqual({ kind: 'unknown', text: '' })
    expect(routeScannedText(undefined)).toEqual({ kind: 'unknown', text: '' })
  })

  it('keeps what it shows short', () => {
    expect(shownText('a\n b')).toBe('a b')
    const long = shownText('x'.repeat(200))
    expect(long.length).toBe(80)
    expect(long.endsWith('…')).toBe(true)
  })
})
