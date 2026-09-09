import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { STRETCHES, STRETCH_GROUPS, stretchingImagePaths } from './stretching.js'

const stretchingView = readFileSync(new URL('../views/Stretching.jsx', import.meta.url), 'utf8')

describe('stretching catalogue', () => {
  it('covers each requested major muscle group exactly once', () => {
    const groups = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'hip-flexors', 'neck', 'lower-back']
    expect(STRETCHES).toHaveLength(groups.length)
    expect(STRETCHES.map(stretch => stretch.group)).toEqual(groups)
    expect(STRETCH_GROUPS.map(group => group.id)).toEqual(groups)
  })

  it('keeps every guide self-contained and points at a local image', () => {
    expect(new Set(STRETCHES.map(stretch => stretch.id)).size).toBe(STRETCHES.length)
    STRETCHES.forEach(stretch => {
      expect(stretch.name).toBeTruthy()
      expect(stretch.muscle).toBeTruthy()
      expect(stretch.target).toBeTruthy()
      expect(stretch.instructions.length).toBeGreaterThanOrEqual(3)
      expect(stretch.es.name).toBeTruthy()
      expect(stretch.es.muscle).toBeTruthy()
      expect(stretch.es.target).toBeTruthy()
      expect(stretch.es.instructions.length).toBeGreaterThanOrEqual(3)
      expect(stretch.image).toMatch(/^\/stretching\/[a-z0-9-]+\.png$/)
      expect(stretch.width).toBeGreaterThan(0)
      expect(stretch.height).toBeGreaterThan(0)
      const assetPath = new URL('../../public' + stretch.image, import.meta.url)
      expect(existsSync(assetPath)).toBe(true)
      const png = readFileSync(assetPath)
      expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
      expect(png.readUInt32BE(16)).toBe(stretch.width)
      expect(png.readUInt32BE(20)).toBe(stretch.height)
    })
    expect(stretchingImagePaths).toHaveLength(12)
  })

  it('renders the dedicated section with all image elements and a muscle filter', () => {
    expect(stretchingView).toContain("t('Stretching')")
    expect(stretchingView).toContain('stretch.es')
    expect(stretchingView).toContain('STRETCH_GROUPS.map')
    expect(stretchingView).toContain('<img className="stretch-image"')
    expect(stretchingView).toContain('data-resolution="1K"')
    expect(stretchingView).toContain('aria-pressed')
    expect(stretchingView).toContain('onError')
  })
})
