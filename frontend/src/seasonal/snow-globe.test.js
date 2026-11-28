// The snow globe's physics (seasonal/snow-globe.js): flung up by a shake, swirling, back on the
// floor, melted, and gone. A fixed random source so every run is the same.
import { describe, expect, it } from 'vitest'
import { makeGlobe, stir, stepGlobe, fitGlobe, flakeAlpha, MAX_CALM_S } from './snow-globe.js'

const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const run = (G, s, dt = 1 / 60) => { let alive = true; for (let t = 0; t < s && alive; t += dt) alive = stepGlobe(G, dt); return alive }
const inside = G => G.flakes.every(f => f.x >= 0 && f.x <= G.w && f.y >= 0 && f.y <= G.h)

describe('the snow globe', () => {
  it('starts with the snow lying at the bottom', () => {
    const G = makeGlobe(400, 800, 150, seeded())
    expect(G.flakes).toHaveLength(150)
    expect(G.flakes.every(f => f.y > 780)).toBe(true)
  })

  it('a shake throws it all over the screen and it keeps turning a while', () => {
    const G = stir(makeGlobe(400, 800, 150, seeded()), { x: 0, y: -12, strength: 2 }, seeded(3))
    run(G, 0.6)
    const high = G.flakes.filter(f => f.y < 400).length
    expect(high).toBeGreaterThan(40)
    expect(G.swirl).toBeGreaterThan(1)
    expect(inside(G)).toBe(true)
  })

  it('the snow flies against the push: phone jerked right, snow goes left', () => {
    const G = makeGlobe(400, 800, 150, seeded())
    const before = G.flakes.reduce((n, f) => n + f.x, 0)
    stir(G, { x: 20, y: 0, strength: 1 }, seeded(5))
    stepGlobe(G, 1 / 60)
    expect(G.flakes.reduce((n, f) => n + f.x, 0)).toBeLessThan(before)
  })

  it('settles, melts and is gone within the calm limit, never leaving the glass', () => {
    const G = stir(makeGlobe(400, 800, 150, seeded()), { x: 5, y: 5, strength: 3 }, seeded(9))
    let alive = true, t = 0
    while (alive && t < MAX_CALM_S + 1) { alive = stepGlobe(G, 1 / 30); t += 1 / 30; expect(inside(G)).toBe(true) }
    expect(alive).toBe(false)
    expect(G.flakes.every(f => f.gone && flakeAlpha(f) === 0)).toBe(true)
    // A real globe takes its time: not over in a blink.
    expect(t).toBeGreaterThan(5)
  })

  it('shaking again wakes the snow lying on the floor', () => {
    const G = stir(makeGlobe(400, 800, 80, seeded()), {}, seeded(2))
    run(G, 14)
    const lying = G.flakes.filter(f => f.lie > 0 && !f.gone).length
    expect(lying).toBeGreaterThan(0)
    stir(G, { x: 0, y: 10 }, seeded(4))
    expect(G.flakes.every(f => f.lie === 0 && !f.gone)).toBe(true)
    expect(run(G, 1)).toBe(true)
  })

  it('a long frame (back from the background) is one small step, not a leap out of the glass', () => {
    const G = stir(makeGlobe(400, 800, 50, seeded()), { strength: 3 }, seeded(6))
    stepGlobe(G, 30)
    expect(inside(G)).toBe(true)
    expect(G.calm).toBeLessThan(0.1)
  })

  it('a turned phone keeps the snow on the new glass', () => {
    const G = stir(makeGlobe(400, 800, 50, seeded()), {}, seeded(8))
    run(G, 0.5)
    fitGlobe(G, 800, 400)
    expect(inside(G)).toBe(true)
  })
})
