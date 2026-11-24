import { describe, expect, it } from 'vitest'
import { clampView, pinchTo, dragTo, ZOOM_MAX } from './photo-zoom.js'

describe('photo zoom', () => {
  it('cannot drag a photo that is not zoomed in', () => {
    expect(dragTo({ z: 1, x: 0, y: 0 }, 50, -30, 300, 400)).toEqual({ z: 1, x: 0, y: 0 })
  })
  it('pinches in from where it was, and stops at the edges and the limits', () => {
    const v = pinchTo({ z: 1, x: 0, y: 0 }, 100, 200, 300, 400)
    expect(v).toEqual({ z: 2, x: 0, y: 0 })
    // twice as big: half a width of room on each side, so 150 px at most
    expect(dragTo(v, 500, -10, 300, 400)).toEqual({ z: 2, x: 150, y: -10 })
    expect(pinchTo(v, 100, 1000, 300, 400).z).toBe(ZOOM_MAX)
    expect(pinchTo(v, 100, 10, 300, 400)).toEqual({ z: 1, x: 0, y: 0 })
  })
  it('a pinch out pulls a shifted photo back inside', () => {
    expect(pinchTo({ z: 2, x: 150, y: 0 }, 100, 75, 300, 400)).toEqual({ z: 1.5, x: 75, y: 0 })
  })
  it('takes junk without breaking', () => {
    expect(clampView(null, 300, 400)).toEqual({ z: 1, x: 0, y: 0 })
    expect(clampView({ z: NaN, x: 'a' }, 300, 400)).toEqual({ z: 1, x: 0, y: 0 })
  })
})
