import { describe, expect, it } from 'vitest'
import { compareCanvasLayout } from './compare-image.js'
import { compareRows } from './photo-compare.js'

describe('compareCanvasLayout', () => {
  it('lays rows out centred, every cell the same shape', () => {
    const L = compareCanvasLayout(compareRows(5), 0.75)
    expect(L.width).toBe(1080)
    expect(L.cells).toHaveLength(5)
    const [a, , , d, e] = L.cells
    expect(new Set(L.cells.map(c => Math.round(c.w)))).toEqual(new Set([Math.round(a.w)]))
    expect(a.h).toBeCloseTo(a.w / 0.75)
    // The row of two is centred under the row of three.
    expect(d.x - 0).toBeCloseTo(1080 - (e.x + e.w))
    expect(d.y).toBeGreaterThan(a.y + a.h)
    expect(L.height).toBeGreaterThan(e.y + e.h)
  })
  it('the slider is one cell across the whole width', () => {
    const L = compareCanvasLayout([2], 0.75, 'slider')
    expect(L.cells).toHaveLength(1)
    expect(L.cells[0].x).toBe(36)
    expect(L.cells[0].w).toBe(1080 - 72)
  })
  it('copes with a bad aspect', () => {
    expect(compareCanvasLayout([1], 0).cells[0].h).toBeCloseTo((1080 - 72) / 0.75)
  })
})
