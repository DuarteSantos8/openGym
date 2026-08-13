import { describe, expect, it } from 'vitest'
import { linkTokenFromSearch } from './device-link.js'

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
