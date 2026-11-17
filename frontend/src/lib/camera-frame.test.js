import { describe, expect, it } from 'vitest'
import { containRect, captureSize, overlayOpacity, captureName } from './camera-frame.js'

describe('camera frame', () => {
  it('shows the whole frame in the box, centred', () => {
    expect(containRect(1280, 720, 400, 800)).toEqual({ x: 0, y: (800 - 225) / 2, w: 400, h: 225 })
    expect(containRect(720, 1280, 400, 400)).toEqual({ x: (400 - 225) / 2, y: 0, w: 225, h: 400 })
    expect(containRect(0, 0, 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })
  it('saves at the camera size, no edge past the cap', () => {
    expect(captureSize(1280, 720)).toEqual({ w: 1280, h: 720 })
    expect(captureSize(3840, 2160)).toEqual({ w: 1600, h: 900 })
    expect(captureSize(0, 720)).toBeNull()
  })
  it('keeps the overlay visible but never solid', () => {
    expect(overlayOpacity(0)).toBe(0.1)
    expect(overlayOpacity(1)).toBe(0.9)
    expect(overlayOpacity('0.5')).toBe(0.5)
    expect(overlayOpacity(undefined)).toBe(0.4)
    expect(captureName('2026-11-06')).toBe('progress-2026-11-06.jpg')
  })
})
