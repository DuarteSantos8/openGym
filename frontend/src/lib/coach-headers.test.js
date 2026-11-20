// The textarea format for extra static headers, one `Name: value` per line. The server admin's card
// and the phone's own setup both read and write it (issue #385, #1292), so it is one parser here and
// not two that can drift. Parsing only: the caps and the reserved names are validateHeaders()'s job
// in api/coach/core/providers.js, which both screens call.
import { describe, it, expect } from 'vitest'
import { headersToText, parseHeadersText } from './coach-headers.js'

describe('the extra-headers textarea format', () => {
  it('round-trips a map through the textarea format', () => {
    expect(headersToText({ 'x-opencode-session': 'sess-1' })).toBe('x-opencode-session: sess-1')
    expect(headersToText(null)).toBe('')
    expect(parseHeadersText('x-opencode-session: sess-1\nX-Title: demo')).toEqual({ headers: { 'x-opencode-session': 'sess-1', 'X-Title': 'demo' } })
  })

  it('treats empty as clear and junk as an error, not a request', () => {
    expect(parseHeadersText('')).toEqual({ headers: null })
    expect(parseHeadersText('   \n  ')).toEqual({ headers: null })
    expect(parseHeadersText('no-colon-here').error).toBeTruthy()
    expect(parseHeadersText('name-only:').error).toBeTruthy()
  })

  it('splits on the first colon only, so a URL or a port survives in the value', () => {
    expect(parseHeadersText('X-Endpoint: https://gw.example.com:443/v1')).toEqual({ headers: { 'X-Endpoint': 'https://gw.example.com:443/v1' } })
  })

  it('trims the name and the value, and ignores blank lines between them', () => {
    expect(parseHeadersText('  X-Title:  demo  \n\n  X-Region: eu  ')).toEqual({ headers: { 'X-Title': 'demo', 'X-Region': 'eu' } })
  })
})
