import { describe, expect, it } from 'vitest'
import { zoomFor } from './GymMap.jsx'

// The editor's map (1.4.4): the zoom fits the radius circle into the card, with room around it,
// a bigger circle zooms out, and the zoom stays where OpenStreetMap has tiles.
describe('the zoom for a radius', () => {
  it('a bigger circle zooms out', () => {
    const z75 = zoomFor(75, 47.37, 300), z120 = zoomFor(120, 47.37, 300), z200 = zoomFor(200, 47.37, 300)
    expect(z75).toBeGreaterThan(z120)
    expect(z120).toBeGreaterThan(z200)
  })
  it('the circle fits the card height with room to spare', () => {
    const lat = 47.37, px = 300, r = 120
    const z = zoomFor(r, lat, px)
    const mPerPx = 156543.034 * Math.cos(lat * Math.PI / 180) / 2 ** z
    expect(2 * r / mPerPx).toBeLessThan(px)
    expect(2 * r / mPerPx).toBeGreaterThan(px / 3)
  })
  it('kept between 3 and 18', () => {
    expect(zoomFor(1, 0, 4000)).toBe(18)
    expect(zoomFor(5e6, 0, 100)).toBe(3)
  })
})
