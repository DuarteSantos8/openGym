// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { normalizeServerUrl } from './remote.js'

// The pairing flow lives or dies on this being forgiving about what someone types on a phone
// keyboard, while still refusing input that can't possibly be a server address.
describe('normalizeServerUrl', () => {
  it('accepts a bare host and adds https://', () => {
    expect(normalizeServerUrl('gym.example.com')).toBe('https://gym.example.com')
  })

  it('keeps an explicit scheme, including http for LAN testing', () => {
    expect(normalizeServerUrl('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080')
    expect(normalizeServerUrl('https://gym.example.com')).toBe('https://gym.example.com')
  })

  it('trims whitespace and a trailing path/slash down to the origin', () => {
    expect(normalizeServerUrl('  gym.example.com/  ')).toBe('https://gym.example.com')
    expect(normalizeServerUrl('https://gym.example.com/some/path')).toBe('https://gym.example.com')
  })

  it('rejects empty or unusable input', () => {
    for (const v of ['', '   ', null, undefined, 'not a url at all!!']) {
      expect(normalizeServerUrl(v)).toBe(null)
    }
  })
})
