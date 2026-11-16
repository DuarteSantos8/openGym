import { describe, expect, it } from 'vitest'
import { defaultOverlay, frameRatio, isMirrored, captureSize, photoFileName } from './camera-overlay.js'

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

describe('frameRatio', () => {
  it('is width over height', () => {
    expect(frameRatio(1080, 1440)).toBe(0.75)
    expect(frameRatio(1920, 1080)).toBeCloseTo(16 / 9)
  })
  it('is null while the camera has sent no frame', () => {
    expect(frameRatio(0, 0)).toBeNull()
    expect(frameRatio(undefined, 480)).toBeNull()
    expect(frameRatio(640, NaN)).toBeNull()
  })
})

describe('isMirrored', () => {
  it('follows the camera when it says which it is', () => {
    expect(isMirrored('user', 'environment')).toBe(true)
    expect(isMirrored('environment', 'user')).toBe(false)
  })
  it('follows what was asked for when the camera does not say', () => {
    expect(isMirrored(undefined, 'user')).toBe(true)
    expect(isMirrored(undefined, 'environment')).toBe(false)
    expect(isMirrored('', 'environment')).toBe(false)
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
