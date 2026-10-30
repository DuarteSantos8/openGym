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

  it('keeps each photo in its own shape and centres the shorter ones against the tallest', () => {
    const L = compareLayout([item(300, 600), item(300, 300)])
    expect(L.rects[0].h).toBeCloseTo(L.rects[0].w * 2)
    expect(L.rects[1].h).toBeCloseTo(L.rects[1].w)
    expect(L.rects[1].y).toBeGreaterThan(L.rects[0].y)
    expect(L.rects[1].y + L.rects[1].h / 2).toBeCloseTo(L.rects[0].y + L.rects[0].h / 2)
  })

  it('puts each date centred under its photo and grows the picture to fit', () => {
    const L = compareLayout([item(300, 400, '1 Jun'), item(300, 400, '1 Jul')])
    expect(L.labels.map(l => l.text)).toEqual(['1 Jun', '1 Jul'])
    L.labels.forEach((l, i) => {
      expect(l.align).toBe('center')
      expect(l.x).toBeCloseTo(L.rects[i].x + L.rects[i].w / 2)
      expect(l.y).toBeGreaterThan(L.rects[i].y + L.rects[i].h)
    })
    expect(L.height).toBeGreaterThan(L.labels[0].y)
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
