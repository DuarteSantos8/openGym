// @vitest-environment node
/* The G in motion (brand-motion.js) and the splash (brand-splash.js): the geometry agrees with the
 * still mark, the timing is the kit's, the colour is the canvas's own CSS colour read on every frame,
 * and the runner starts, ends, stops and stays still the way the app relies on. The canvas is a
 * recorder: what is checked is what would be drawn, not how it looks. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MARK } from './brand-mark.js'
import {
  CENTRE, GEO, GROOVE, drawMark, ease, pathSpec, run, tracePortion,
} from './brand-motion.js'
import { G_DONE, SPLASH_END, SPLASH_LOOP, createSplash, drawSplash, loadGlyphs } from './brand-splash.js'

const rad = d => d * Math.PI / 180
const near = (a, b, tol = 0.011) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol)

// A 2D context that writes down what it is asked to do.
function recorder() {
  const log = []
  const ctx = {
    log,
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineCap: '', lineJoin: '', miterLimit: 0,
  }
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'arc', 'save', 'restore', 'setTransform', 'clearRect', 'translate', 'scale']) {
    ctx[m] = (...a) => log.push([m, ...a])
  }
  ctx.stroke = () => log.push(['stroke', ctx.strokeStyle, ctx.lineWidth, ctx.globalCompositeOperation, ctx.globalAlpha])
  ctx.fill = p => log.push(['fill', ctx.fillStyle, p && p.d, ctx.globalAlpha])
  return ctx
}
const ops = (ctx, name) => ctx.log.filter(l => l[0] === name)

describe('the geometry is the still mark', () => {
  // The still mark is an SVG path in y-down units; the motion's path is arcs in a y-up box.
  const c = MARK.centre.match(/^M([\d.]+) ([\d.]+)A([\d.]+) ([\d.]+) 0 1 0 ([\d.]+) ([\d.]+)H([\d.]+)$/).slice(1).map(Number)
  const g = MARK.groove.match(/^M([\d.]+) ([\d.]+)A([\d.]+) ([\d.]+) 0 1 0 ([\d.]+) ([\d.]+)V([\d.]+)H([\d.]+)$/).slice(1).map(Number)

  it('the ring starts where the ring of the still mark starts, has its radius and ends on the bar line', () => {
    const [x0, y0, rx, ry, x1, y1, bar] = c
    near(x0, 50 + GEO.R * Math.cos(rad(GEO.A0)))
    near(y0, 100 - (50 + GEO.R * Math.sin(rad(GEO.A0))))
    expect([rx, ry]).toEqual([GEO.R, GEO.R])
    expect([x1, y1]).toEqual([50 + GEO.R, 50])
    expect(bar).toBe(GEO.BAR_END)
  })

  it('the groove is the same arc further out, steps up to the bar and ends where the motion ends it', () => {
    const [x0, y0, rx, , x1, y1, lifted, end] = g
    near(x0, 50 + GEO.GR * Math.cos(rad(GEO.A0)))
    near(y0, 100 - (50 + GEO.GR * Math.sin(rad(GEO.A0))))
    expect(rx).toBe(GEO.GR)
    expect([x1, y1]).toEqual([50 + GEO.GR, 50])
    near(lifted, 50 - (GEO.GR - GEO.R))
    expect(end).toBe(GEO.GBAR)
  })

  it('stroke and groove widths are the still mark\'s', () => {
    expect(GEO.W).toBe(MARK.width)
    expect(GEO.GW).toBe(MARK.grooveWidth)
  })

  it('path lengths: the ring is 320 degrees of arc and the bar runs back to BAR_END', () => {
    near(CENTRE.total, GEO.R * rad(360 - GEO.A0) + (50 + GEO.R - GEO.BAR_END), 1e-9)
    near(GROOVE.total, GEO.GR * rad(360 - GEO.A0) + (GEO.GR - GEO.R) + (50 + GEO.GR - GEO.GBAR), 1e-9)
    expect(pathSpec(10, 20, 0).segs).toHaveLength(2)
    expect(pathSpec(10, 20, 3).segs).toHaveLength(3)
  })
})

describe('tracePortion', () => {
  const S = 2, ox = 10, oy = 20

  it('the whole ring and bar: starts at the ring start, one arc the long way round, ends on the bar end', () => {
    const ctx = recorder()
    expect(tracePortion(ctx, CENTRE, 0, 1, S, ox, oy)).toBe(true)
    const [mv] = ops(ctx, 'moveTo'), [arc] = ops(ctx, 'arc'), lines = ops(ctx, 'lineTo')
    near(mv[1], ox + S * (50 + GEO.R * Math.cos(rad(GEO.A0))))
    near(mv[2], oy + S * (100 - (50 + GEO.R * Math.sin(rad(GEO.A0)))))
    // canvas y points down: the angles are negated and the arc is counter-clockwise on the canvas
    expect(arc.slice(1)).toEqual([ox + 50 * S, oy + 50 * S, GEO.R * S, -rad(GEO.A0), -rad(360), true])
    const last = lines[lines.length - 1]
    near(last[1], ox + GEO.BAR_END * S)
    near(last[2], oy + 50 * S)
  })

  it('half the stroke ends partway round the ring, at the angle that fraction of the length gives', () => {
    const ctx = recorder()
    tracePortion(ctx, CENTRE, 0, 0.5, S, ox, oy)
    const [arc] = ops(ctx, 'arc')
    const turn = (0.5 * CENTRE.total) / (GEO.R * rad(360 - GEO.A0))   // fraction of the arc
    near(arc[5], -rad(GEO.A0 + (360 - GEO.A0) * turn), 1e-9)
    expect(ops(ctx, 'lineTo')).toHaveLength(0)
  })

  it('draws nothing for an empty range, and a range inside the bar draws only a line', () => {
    expect(tracePortion(recorder(), CENTRE, 0.5, 0.5, S, ox, oy)).toBe(false)
    const ctx = recorder()
    const arcShare = (GEO.R * rad(360 - GEO.A0)) / CENTRE.total
    expect(tracePortion(ctx, CENTRE, arcShare + 0.01, 1, S, ox, oy)).toBe(true)
    expect(ops(ctx, 'arc')).toHaveLength(0)
  })
})

describe('drawMark', () => {
  it('strokes the ring in the ink at the kit\'s width, then cuts the groove out of it', () => {
    const ctx = recorder()
    drawMark(ctx, 0, 1, 100, 0, 0, 'rgb(1, 2, 3)')
    const strokes = ops(ctx, 'stroke')
    expect(strokes).toHaveLength(2)
    expect(strokes[0]).toEqual(['stroke', 'rgb(1, 2, 3)', GEO.W, 'source-over', 1])
    expect(strokes[1][2]).toBe(GEO.GW)
    expect(strokes[1][3]).toBe('destination-out')
    expect(ops(ctx, 'save')).toHaveLength(1)
    expect(ops(ctx, 'restore')).toHaveLength(1)
  })

  it('scales the stroke with the box and applies the alpha to the ring only', () => {
    const ctx = recorder()
    drawMark(ctx, 0, 1, 200, 0, 0, 'red', 0.5)
    const strokes = ops(ctx, 'stroke')
    expect(strokes[0][2]).toBeCloseTo(GEO.W * 2)
    expect(strokes[0][4]).toBe(0.5)
    expect(strokes[1][4]).toBe(1)
  })
})

describe('ease', () => {
  it('eases in and out and stays inside 0..1', () => {
    expect([ease(-1), ease(0), ease(0.5), ease(1), ease(2)]).toEqual([0, 0, 0.5, 1, 1])
    expect(ease(0.25)).toBeLessThan(0.25)
    expect(ease(0.75)).toBeGreaterThan(0.75)
  })
})

describe('run: a canvas, a clock and a colour', () => {
  let frames, cancelled, now, colour
  const canvasWith = ctx => ({
    getContext: () => ctx, clientWidth: 100, clientHeight: 80, width: 0, height: 0,
  })
  beforeEach(() => {
    frames = []; cancelled = []; now = 0; colour = 'rgb(247, 245, 242)'
    globalThis.window = globalThis
    globalThis.devicePixelRatio = 2
    globalThis.getComputedStyle = () => ({ color: colour })
    globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length }
    globalThis.cancelAnimationFrame = id => cancelled.push(id)
  })
  afterEach(() => { delete globalThis.window; delete globalThis.devicePixelRatio; delete globalThis.getComputedStyle; delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame })
  const tick = ms => { now += ms; const fn = frames.shift(); fn(now) }

  it('does nothing, and says so, without a 2D context', () => {
    const r = run({ getContext: () => null }, () => { throw new Error('drew') })
    expect(r.ok).toBe(false)
    expect(() => r.destroy()).not.toThrow()
    expect(run({}, () => {}).ok).toBe(false)
  })

  it('draws the first frame at once, sizes the canvas for the screen and clears before every frame', () => {
    const ctx = recorder(), canvas = canvasWith(ctx), seen = []
    run(canvas, (c, t, w, h, dpr, ink) => seen.push([t, w, h, dpr, ink]), { startAt: 1 })
    expect(seen).toEqual([[1, 100, 80, 2, 'rgb(247, 245, 242)']])
    expect([canvas.width, canvas.height]).toEqual([200, 160])
    expect(ops(ctx, 'clearRect')[0].slice(1)).toEqual([0, 0, 200, 160])
    tick(0)    // the first animation frame starts the clock
    tick(500)
    expect(seen[seen.length - 1][0]).toBeCloseTo(1.5)
  })

  it('caps the pixel ratio', () => {
    globalThis.devicePixelRatio = 4
    const canvas = canvasWith(recorder())
    run(canvas, () => {}, { maxDpr: 2 })
    expect(canvas.width).toBe(200)
  })

  it('reads the ink again on every frame, so a theme switched meanwhile is followed', () => {
    const seen = []
    run(canvasWith(recorder()), (c, t, w, h, dpr, ink) => seen.push(ink))
    colour = 'rgb(26, 24, 20)'
    tick(0)
    expect(seen).toEqual(['rgb(247, 245, 242)', 'rgb(26, 24, 20)'])
  })

  it('ends at endAt with that frame, calls onComplete once and asks for no more frames', () => {
    const seen = []; let done = 0
    run(canvasWith(recorder()), (c, t) => seen.push(t), { endAt: 1, onComplete: () => done++ })
    tick(0); tick(400); expect(done).toBe(0)
    tick(700)
    expect(seen[seen.length - 1]).toBe(1)
    expect(done).toBe(1)
    expect(frames).toHaveLength(0)
  })

  it('destroy cancels the pending frame and keeps onComplete from firing', () => {
    let done = 0
    const r = run(canvasWith(recorder()), () => {}, { endAt: 1, onComplete: () => done++ })
    r.destroy()
    expect(cancelled).toHaveLength(1)
    expect(done).toBe(0)
  })

  it('reduced: one frame at stillAt, no animation, and onComplete at once', () => {
    const seen = []; let done = 0
    run(canvasWith(recorder()), (c, t) => seen.push(t), { reduced: true, stillAt: 3.2, onComplete: () => done++ })
    expect(seen).toEqual([3.2])
    expect(frames).toHaveLength(0)
    expect(done).toBe(1)
  })

})

describe('the splash', () => {
  class FakePath { constructor(d) { this.d = d } }
  const GLY = { upm: 1000, w: {} }
  for (let w = 100; w <= 800; w += 50) GLY.w[w] = Object.fromEntries([...'gains'].map(ch => [ch, { a: 500, d: `${ch}${w}` }]))
  beforeEach(() => { globalThis.Path2D = FakePath })
  afterEach(() => { delete globalThis.Path2D })
  const frame = t => { const ctx = recorder(); drawSplash(ctx, GLY, t, 400, 800, 1, 'INK'); return ctx }

  it('the timeline: about a second end to end, the last letter (stagger 0.04, settle 0.10 of the loop) ends it with no hold', () => {
    expect(SPLASH_END).toBeCloseTo(SPLASH_LOOP * (0.30 + 4 * 0.04 + 0.10), 9)
    expect(SPLASH_END).toBeGreaterThan(0.95)
    expect(SPLASH_END).toBeLessThan(1.1)
    expect(G_DONE).toBeLessThan(SPLASH_END)
    // from the handover (the G already on screen) the animation itself is about half a second
    expect(SPLASH_END - G_DONE).toBeLessThan(0.6)
  })

  it('the last letter has settled exactly at the end: nothing moves after it', () => {
    const a = frame(SPLASH_END), b = frame(SPLASH_END + 5)
    expect(ops(b, 'fill')).toEqual(ops(a, 'fill'))
    expect(ops(b, 'translate')).toEqual(ops(a, 'translate'))
  })

  it('opens empty, draws the G first and the letters after it', () => {
    expect(ops(frame(0), 'stroke')).toHaveLength(0)
    const g = frame(G_DONE)
    expect(ops(g, 'stroke')).toHaveLength(2)
    expect(ops(g, 'fill')).toHaveLength(0)
    const mid = frame(SPLASH_LOOP * 0.4)
    expect(ops(mid, 'fill').length).toBeGreaterThan(0)
  })

  it('ends with the whole G and all five letters, drawn in the ink it was given', () => {
    const end = frame(SPLASH_END)
    expect(ops(end, 'stroke')[0][1]).toBe('INK')
    const fills = ops(end, 'fill')
    expect(fills.every(f => f[1] === 'INK')).toBe(true)
    // each letter: the outline of its weight (800 for the last: one outline), neighbours in between
    for (const ch of 'gains') expect(fills.some(f => f[2].startsWith(ch)), ch).toBe(true)
    expect(fills.find(f => f[2] === 's800')).toBeTruthy()
  })

  it('puts the G\'s centre 38 above the middle and the letters 48 below it', () => {
    const end = frame(SPLASH_END)
    const [mv] = ops(end, 'moveTo')
    near(mv[1], 200 + (GEO.R * Math.cos(rad(GEO.A0))), 0.01)           // box centre x = w/2
    near(mv[2], 400 - 38 - GEO.R * Math.sin(rad(GEO.A0)), 0.01)        // box centre y = h/2 - 38
    const [tr] = ops(end, 'translate')
    near(tr[2], 400 + 48, 8.5)                                         // baseline, less the settle offset
  })

  it('createSplash starts from the G when asked, and ends at SPLASH_END', () => {
    globalThis.window = globalThis; globalThis.devicePixelRatio = 1
    globalThis.getComputedStyle = () => ({ color: 'INK' })
    const frames = []
    globalThis.requestAnimationFrame = fn => frames.push(fn)
    globalThis.cancelAnimationFrame = () => {}
    const ctx = recorder(); let done = 0
    createSplash({ getContext: () => ctx, clientWidth: 400, clientHeight: 800, width: 0, height: 0 }, GLY, { fromG: true, onComplete: () => done++ })
    expect(ops(ctx, 'stroke')).toHaveLength(2)   // the G already there on the first frame
    expect(ops(ctx, 'fill')).toHaveLength(0)
    frames.shift()(0); frames.shift()(5000)
    expect(done).toBe(1)
    for (const k of ['window', 'devicePixelRatio', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) delete globalThis[k]
  })
})

describe('the letters', () => {
  it('are outlined at every weight from 100 to 800 in steps of 50, for g, a, i, n and s', async () => {
    const GLY = await loadGlyphs()
    expect(GLY.upm).toBe(1000)
    const weights = Object.keys(GLY.w).map(Number)
    expect(weights).toEqual(Array.from({ length: 15 }, (_, i) => 100 + i * 50))
    for (const w of weights) for (const ch of 'gains') {
      expect(typeof GLY.w[w][ch].a, `${w}${ch}`).toBe('number')
      expect(GLY.w[w][ch].d, `${w}${ch}`).toMatch(/^M/)
    }
  })

  it('load once', async () => {
    expect(await loadGlyphs()).toBe(await loadGlyphs())
  })
})
