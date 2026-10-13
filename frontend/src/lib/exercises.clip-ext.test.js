import { afterEach, describe, expect, it, vi } from 'vitest'

// The Android release shows its animations as animated WebP images (VITE_CLIP_EXT=webp); every
// other build keeps the MP4 loops.
describe('gifSrc and VITE_CLIP_EXT', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  const ex = { id: '0025', img: '0025.webp', gif: '0025.mp4', fv: '9025' }

  it('names MP4 loops by default', async () => {
    const { gifSrc, isVideoSrc } = await import('./exercises.js')
    expect(gifSrc(ex, 'male')).toBe('exercise-media/clip/0025.mp4')
    expect(gifSrc(ex, 'female')).toBe('exercise-media/clip/9025.mp4')
    expect(isVideoSrc(gifSrc(ex, 'male'))).toBe(true)
  })

  it('names animated WebP images in the Android release', async () => {
    vi.stubEnv('VITE_CLIP_EXT', 'webp')
    const { gifSrc, imgSrc, isVideoSrc } = await import('./exercises.js')
    expect(gifSrc(ex, 'male')).toBe('exercise-media/clip/0025.webp')
    expect(gifSrc(ex, 'female')).toBe('exercise-media/clip/9025.webp')
    expect(isVideoSrc(gifSrc(ex, 'male'))).toBe(false)
    expect(imgSrc(ex, 'male')).toBe('exercise-media/still/0025.webp')
    // a fork's GIF stays a GIF
    expect(gifSrc({ ...ex, gif: '0025.gif', fv: undefined }, 'male')).toBe('exercise-media/clip/0025.gif')
  })
})
