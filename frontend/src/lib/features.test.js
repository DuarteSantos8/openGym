import { describe, expect, it } from 'vitest'
import { bodyScaleOn, featureOn, qrScanOn, workoutScanOn } from './features.js'

describe('instance features', () => {
  it('each is on unless the server says it is off', () => {
    for (const config of [null, {}, { features: {} }]) {
      expect(qrScanOn(config)).toBe(true)
      expect(bodyScaleOn(config)).toBe(true)
    }
    expect(featureOn({ features: { qr: true } }, 'qr')).toBe(true)
    expect(qrScanOn({ features: { qr: false } })).toBe(false)
  })

  it('switch independently, and the workout scan stays while any is on', () => {
    const config = { features: { qr: false } }
    expect(qrScanOn(config)).toBe(false)
    expect(bodyScaleOn(config)).toBe(true)
    expect(workoutScanOn(config)).toBe(true)
    expect(workoutScanOn({ features: { qr: false, bodyScale: false } })).toBe(false)
  })
})
