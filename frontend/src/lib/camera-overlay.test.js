import { describe, expect, it } from 'vitest'
import { MIN_SCALE, MAX_SCALE, defaultOverlay, clampScale, clampPan, pinchScale, distance, overlayTransform, captureSize, photoFileName } from './camera-overlay.js'

describe('defaultOverlay', () => {
  it('is the newest photo, which is the first of the list', () => {
    const photos = [{ d: '2026-10-30' }, { d: '2026-10-01' }]
    expect(defaultOverlay(photos)).toBe(photos[0])
  })
  it('is none for no photos', () => {
    expect(defaultOverlay([])).toBeNull()
    expect(defaultOverlay(undefined)).toBeNull()
  })
})

describe('clampScale', () => {
  it('keeps the scale within its limits', () => {
    expect(clampScale(1)).toBe(1)
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
  })
  it('falls back to 1 for something that is not a number', () => {
    expect(clampScale(NaN)).toBe(1)
    expect(clampScale(undefined)).toBe(1)
  })
})

describe('clampPan', () => {
  it('lets the overlay move up to nearly its own size away, either way', () => {
    expect(clampPan(50, 400)).toBe(50)
    expect(clampPan(1000, 400)).toBe(360)
    expect(clampPan(-1000, 400)).toBe(-360)
  })
  it('stays put for no size or no number', () => {
    expect(clampPan(30, 0)).toBe(0)
    expect(clampPan(NaN, 400)).toBe(0)
  })
})

describe('pinchScale', () => {
  it('grows and shrinks with the fingers', () => {
    expect(pinchScale(1, 100, 200)).toBe(2)
    expect(pinchScale(1, 100, 50)).toBe(0.5)
    expect(pinchScale(2, 100, 100)).toBe(2)
  })
  it('stays within the limits and survives a zero distance', () => {
    expect(pinchScale(2, 10, 1000)).toBe(MAX_SCALE)
    expect(pinchScale(1, 1000, 1)).toBe(MIN_SCALE)
    expect(pinchScale(1.5, 0, 50)).toBe(1.5)
    expect(pinchScale(1.5, 50, 0)).toBe(1.5)
  })
})

describe('distance', () => {
  it('is the distance between two points', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('overlayTransform', () => {
  it('moves, then scales', () => {
    expect(overlayTransform({ x: 10.4, y: -20.6, scale: 1.5 })).toBe('translate(10px, -21px) scale(1.500)')
  })
  it('is the plain picture by default and clamps a wild scale', () => {
    expect(overlayTransform()).toBe('translate(0px, 0px) scale(1.000)')
    expect(overlayTransform({ scale: 50 })).toBe(`translate(0px, 0px) scale(${MAX_SCALE.toFixed(3)})`)
  })
})

describe('captureSize', () => {
  it('leaves a small frame alone', () => {
    expect(captureSize(1280, 720)).toEqual({ width: 1280, height: 720 })
  })
  it('brings a large one down on its longer side, keeping its shape', () => {
    expect(captureSize(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(captureSize(3024, 4032)).toEqual({ width: 1200, height: 1600 })
  })
  it('is empty for no frame', () => {
    expect(captureSize(0, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('photoFileName', () => {
  it('names the photo after its day', () => {
    expect(photoFileName('2026-10-31')).toBe('progress-2026-10-31.jpg')
  })
})
