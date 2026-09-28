import { describe, expect, it } from 'vitest'
import { linkTokenFromSearch, deviceLinkUrl, deviceLabel } from './device-link.js'

describe('linkTokenFromSearch', () => {
  it('reads ?link= from the query string', () => {
    expect(linkTokenFromSearch('?link=abc123')).toBe('abc123')
  })

  it('returns empty when there is no link', () => {
    expect(linkTokenFromSearch('')).toBe('')
    expect(linkTokenFromSearch('?foo=1')).toBe('')
  })

  it('decodes a percent-encoded token', () => {
    expect(linkTokenFromSearch('?link=abc%2B1')).toBe('abc+1')
  })
})

describe('deviceLinkUrl', () => {
  it('puts the code on the app’s own address as ?link=, and reads back to the same code', () => {
    const url = deviceLinkUrl('K7WQ-2MZP-4HXA', { origin: 'https://gym.example.com', pathname: '/' })
    expect(url).toBe('https://gym.example.com/?link=K7WQ-2MZP-4HXA')
    expect(linkTokenFromSearch(new URL(url).search)).toBe('K7WQ-2MZP-4HXA')
  })

  it('keeps a subpath deployment’s path and drops whatever query or route the page had', () => {
    expect(deviceLinkUrl('A+B', { origin: 'https://example.com', pathname: '/gym/', search: '?x=1', hash: '#/settings' }))
      .toBe('https://example.com/gym/?link=A%2BB')
  })
})

describe('deviceLabel', () => {
  const cases = [
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1', 'Chrome · iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0', 'Edge · Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox · Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari · Mac'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Samsung Internet · Android'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 'Chrome · ChromeOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox · Linux']
  ]
  it.each(cases)('names %s', (ua, label) => expect(deviceLabel(ua)).toBe(label))

  it('says nothing about a browser it does not recognise', () => {
    expect(deviceLabel('curl/8.0')).toBe('')
    expect(deviceLabel('')).toBe('')
  })
})
