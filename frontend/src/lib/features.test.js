import { describe, expect, it } from 'vitest'
import { qrScanOn } from './features.js'

describe('instance features', () => {
  it('QR scanning is on unless the server says it is off', () => {
    expect(qrScanOn(null)).toBe(true)
    expect(qrScanOn({})).toBe(true)
    expect(qrScanOn({ features: {} })).toBe(true)
    expect(qrScanOn({ features: { qr: true } })).toBe(true)
    expect(qrScanOn({ features: { qr: false } })).toBe(false)
  })
})
