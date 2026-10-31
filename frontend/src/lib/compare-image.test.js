import { describe, it, expect } from 'vitest'
import { compareLayout, IMAGE_WIDTH } from './compare-image.js'

const item = (w, h, label = '') => ({ w, h, label })

describe('compareLayout, side by side', () => {
  it('puts the photos in one row, left to right, inside the margins', () => {
    const L = compareLayout([item(300, 400, 'a'), item(300, 400, 'b'), item(300, 400, 'c')], { title: '5 days apart' })
    expect(L.width).toBe(IMAGE_WIDTH)
    expect(L.rects).toHaveLength(3)
    expect(L.rects[0].x).toBeLessThan(L.rects[1].x)
    expect(L.rects[1].x).toBeLessThan(L.rects[2].x)
    const last = L.rects[2]
    expect(last.x + last.w).toBeLessThanOrEqual(IMAGE_WIDTH - 39)
    expect(L.title.text).toBe('5 days apart')
  })

  it('gives every photo the same height, whatever its own shape', () => {
    const L = compareLayout([item(300, 600), item(300, 300), item(300, 450)])
    const hs = L.cells.map(c => Math.round(c.h))
    expect(new Set(hs).size).toBe(1)
    expect(L.cells[0].y).toBe(L.cells[1].y)
    expect(L.cells[0].h).toBeCloseTo(L.cells[0].w * 1.5)                   // the middle shape (450 / 300)
  })

  it('crops a photo of another shape to the cell, and shows a photo of the common shape whole', () => {
    const L = compareLayout([item(300, 400), item(300, 400), item(400, 300)])
    expect(L.cells[0].crop).toMatchObject({ sx: 0, sy: 0, sw: 300, sh: 400 })
    expect(L.cells[2].crop.sw).toBeLessThan(400)
    expect(L.cells[2].crop.sh).toBe(300)
  })

  it('moves the crop with where the photo was dragged to', () => {
    const wide = [item(300, 400), item(300, 400), { ...item(400, 300), px: 0 }]
    const left = compareLayout(wide).cells[2].crop
    const right = compareLayout([item(300, 400), item(300, 400), { ...item(400, 300), px: 1 }]).cells[2].crop
    expect(left.sx).toBe(0)
    expect(right.sx).toBeGreaterThan(left.sx)
    expect(right.sx + right.sw).toBeCloseTo(400)
  })

  it('puts each date in a pill on its photo, at the bottom left', () => {
    const L = compareLayout([item(300, 400, '1 Jun'), item(300, 400, '1 Jul')])
    expect(L.labels.map(l => l.text)).toEqual(['1 Jun', '1 Jul'])
    L.labels.forEach((l, i) => {
      expect(l.align).toBe('left')
      expect(l.x).toBeGreaterThan(L.cells[i].x)
      expect(l.x).toBeLessThan(L.cells[i].x + L.cells[i].w / 2)
      expect(l.y).toBeLessThan(L.cells[i].y + L.cells[i].h)            // inside the photo, not under it
      expect(l.y).toBeGreaterThan(L.cells[i].y + L.cells[i].h / 2)
    })
  })

  it('grows the picture to the height of the cells and no more', () => {
    const L = compareLayout([item(300, 400), item(300, 400)])
    expect(L.height).toBeCloseTo(L.cells[0].y + L.cells[0].h + 40, 0)
  })

  it('treats a slider asked for with more than two photos as side by side', () => {
    expect(compareLayout([item(1, 1), item(1, 1), item(1, 1)], { mode: 'slider' }).mode).toBe('side')
  })
})

describe('compareLayout, slider', () => {
  const two = [item(300, 400, 'before'), item(300, 400, 'after')]

  it('splits the frame where the handle is', () => {
    const L = compareLayout(two, { mode: 'slider', pct: 25 })
    expect(L.mode).toBe('slider')
    expect(L.splitX).toBeCloseTo(L.frame.x + L.frame.w * 0.25)
  })

  it('keeps the handle inside the frame', () => {
    expect(compareLayout(two, { mode: 'slider', pct: -10 }).splitX).toBe(compareLayout(two, { mode: 'slider', pct: 0 }).splitX)
    const L = compareLayout(two, { mode: 'slider', pct: 140 })
    expect(L.splitX).toBeCloseTo(L.frame.x + L.frame.w)
  })

  it('puts the earlier date on the left and the later on the right', () => {
    const L = compareLayout(two, { mode: 'slider' })
    expect(L.labels[0]).toMatchObject({ text: 'before', align: 'left' })
    expect(L.labels[1]).toMatchObject({ text: 'after', align: 'right' })
    expect(L.labels[0].x).toBeLessThan(L.labels[1].x)
  })

  it('frames the first photo’s shape and fits a different one inside it', () => {
    const L = compareLayout([item(300, 400), item(400, 400)], { mode: 'slider' })
    expect(L.frame.h).toBeCloseTo(L.frame.w * 4 / 3, 0)
    const r = L.rects[1]
    expect(r.w).toBeLessThanOrEqual(L.frame.w)
    expect(r.h).toBeLessThanOrEqual(L.frame.h)
    expect(r.x).toBeGreaterThanOrEqual(L.frame.x)
  })
})
