import { describe, expect, it, vi } from 'vitest'
import { fitSize, photoStore, detectPose, toLandmarks } from './body-photo.js'

describe('body-photo', () => {
  it('shrinks a photo to fit, never enlarges one', () => {
    expect(fitSize(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 })
    expect(fitSize(3024, 4032, 1280)).toEqual({ w: 960, h: 1280 })
    expect(fitSize(800, 600, 1280)).toEqual({ w: 800, h: 600 })
  })

  it('keeps the landmarks it needs, rounded, and nothing else', () => {
    const out = toLandmarks([{ x: 0.123456789, y: 0.5, z: -0.3, visibility: 0.98765, presence: 1 }])
    expect(out).toEqual([{ x: 0.12346, y: 0.5, visibility: 0.988 }])
    expect(toLandmarks(null)).toBe(null)
  })

  it('falls back to memory when the browser has no IndexedDB, and still works', async () => {
    const store = photoStore({ idb: undefined })
    expect(await store.open()).toBe(false)
    const rec = { view: 'front', data: new Uint8Array([1, 2, 3]).buffer, mime: 'image/jpeg', w: 3, h: 1, lm: [], at: 1 }
    await store.put(rec)
    expect((await store.get('front')).w).toBe(3)
    expect(await store.get('back')).toBe(null)
    await store.remove('front')
    expect(await store.get('front')).toBe(null)
  })

  it('finds the body in a still image with the model this build ships, and lets it go after', async () => {
    const close = vi.fn()
    const detect = vi.fn(() => ({ landmarks: [[{ x: 0.5, y: 0.25, visibility: 0.9 }]] }))
    const createFromOptions = vi.fn(async () => ({ detect, close }))
    const loadVision = async () => ({
      FilesetResolver: { forVisionTasks: async path => ({ path }) },
      PoseLandmarker: { createFromOptions },
    })
    const lm = await detectPose('canvas', { base: './', loadVision })
    expect(lm).toEqual([{ x: 0.5, y: 0.25, visibility: 0.9 }])
    expect(createFromOptions.mock.calls[0][1]).toMatchObject({
      baseOptions: { modelAssetPath: './mediapipe/pose_landmarker_lite.task' }, runningMode: 'IMAGE', numPoses: 1,
    })
    expect(detect).toHaveBeenCalledWith('canvas')
    expect(close).toHaveBeenCalled()
  })

  it('tries the CPU when the GPU will not start, and answers null when there is no body', async () => {
    const createFromOptions = vi.fn(async (_, o) => {
      if (o.baseOptions.delegate === 'GPU') throw new Error('no webgl')
      return { detect: () => ({ landmarks: [] }), close() {} }
    })
    const loadVision = async () => ({ FilesetResolver: { forVisionTasks: async () => ({}) }, PoseLandmarker: { createFromOptions } })
    expect(await detectPose('img', { base: './', loadVision })).toBe(null)
    expect(createFromOptions.mock.calls.map(c => c[1].baseOptions.delegate)).toEqual(['GPU', 'CPU'])
  })
})
