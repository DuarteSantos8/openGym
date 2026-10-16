// The Gains G in motion on a canvas: the part of the splash that draws the G. Canvas 2D, no
// dependencies. The geometry and timing are the brand kit's (gains-logo.js); what is different is
// that the colour is not a parameter but the CSS `color` of the canvas, read on every frame, so the
// mark follows the theme (the light ink on the dark theme, the dark one on the light) without a
// prop having to say so, and a theme switched while it plays is picked up on the next frame.
// BrandMark.jsx draws the same G still, from the same numbers (brand-motion.test.js keeps them in
// step); the loader is BrandMark animated in CSS. The letters of the splash are lib/brand-splash.js.

// Units of a 100 box with y up: the ring's centre line has radius R and is drawn from A0 degrees
// round to 360, then the bar runs back along y = 50 to BAR_END. The groove is a second line, GR out
// from the centre, that steps up to the bar's level and ends at GBAR.
export const GEO = { R: 24, W: 8.4, A0: 40, BAR_END: 51, GR: 25.2, GW: 1.1, GBAR: 52.5 }

// Cubic ease in and out, clamped.
export function ease(x) {
  x = x < 0 ? 0 : x > 1 ? 1 : x
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

// A path as arc and line pieces with their lengths, so a fraction of it can be drawn.
export function pathSpec(r, endX, lift) {
  const arcLen = r * (360 - GEO.A0) * Math.PI / 180
  const x0 = 50 + r
  const segs = [{ type: 'arc', r, len: arcLen }]
  if (lift) segs.push({ type: 'line', x0, y0: 50, x1: x0, y1: 50 + lift, len: Math.abs(lift) })
  segs.push({ type: 'line', x0, y0: 50 + (lift || 0), x1: endX, y1: 50 + (lift || 0), len: x0 - endX })
  return { segs, total: segs.reduce((n, s) => n + s.len, 0) }
}
export const CENTRE = pathSpec(GEO.R, GEO.BAR_END, 0)
export const GROOVE = pathSpec(GEO.GR, GEO.GBAR, GEO.GR - GEO.R)

// Adds the part of `spec` between fractions f0 and f1 to the current path. S is px per unit, ox/oy
// the px position of the 100 box. Returns whether anything was added.
export function tracePortion(ctx, spec, f0, f1, S, ox, oy) {
  const d0 = f0 * spec.total, d1 = f1 * spec.total
  const P = (x, y) => [ox + x * S, oy + (100 - y) * S]
  let acc = 0, started = false
  ctx.beginPath()
  for (const s of spec.segs) {
    const a = Math.max(d0, acc), b = Math.min(d1, acc + s.len)
    if (b > a) {
      const ta = (a - acc) / s.len, tb = (b - acc) / s.len
      if (s.type === 'arc') {
        const ang0 = GEO.A0 + (360 - GEO.A0) * ta, ang1 = GEO.A0 + (360 - GEO.A0) * tb
        const rad = deg => deg * Math.PI / 180
        const st = P(50 + s.r * Math.cos(rad(ang0)), 50 + s.r * Math.sin(rad(ang0)))
        if (!started) { ctx.moveTo(st[0], st[1]); started = true } else ctx.lineTo(st[0], st[1])
        // The canvas y axis points down, so counter-clockwise in the box is clockwise on screen:
        // the angles are negated and the arc runs the other way round.
        ctx.arc(ox + 50 * S, oy + 50 * S, s.r * S, -rad(ang0), -rad(ang1), true)
      } else {
        const pa = P(s.x0 + (s.x1 - s.x0) * ta, s.y0 + (s.y1 - s.y0) * ta)
        const pb = P(s.x0 + (s.x1 - s.x0) * tb, s.y0 + (s.y1 - s.y0) * tb)
        if (!started) { ctx.moveTo(pa[0], pa[1]); started = true } else ctx.lineTo(pa[0], pa[1])
        ctx.lineTo(pb[0], pb[1])
      }
    }
    acc += s.len
  }
  return started
}

// The G from fraction f0 to f1 of its stroke, in `ink`, with the groove cut out of it. `size` is the
// side of the 100 box in px. The cut is destination-out, so whatever is already on the canvas
// under the groove goes too: draw the G before anything that should show through.
export function drawMark(ctx, f0, f1, size, ox, oy, ink, alpha = 1) {
  const S = size / 100
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.miterLimit = 4
  ctx.strokeStyle = ink; ctx.lineWidth = GEO.W * S
  if (tracePortion(ctx, CENTRE, f0, f1, S, ox, oy)) ctx.stroke()
  ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1
  ctx.lineWidth = GEO.GW * S; ctx.lineJoin = 'round'
  if (tracePortion(ctx, GROOVE, Math.max(0, f0 - 0.01), Math.min(1, f1 + 0.01), S, ox, oy)) ctx.stroke()
  ctx.restore()
}

// Runs `draw(ctx, t, w, h, dpr, ink)` on a canvas: sized from its CSS box, scaled for the screen
// (to maxDpr), `ink` read from its CSS colour. Ends at `endAt` seconds with a last frame and
// `onComplete`, or runs until destroyed. `reduced` draws the one frame at `stillAt` and stops.
// Without a 2D context (a test, an old webview) it does nothing and says so with ok: false.
export function run(canvas, draw, { maxDpr = 2, startAt = 0, endAt = null, stillAt = 0, reduced = false, onComplete } = {}) {
  const ctx = canvas.getContext && canvas.getContext('2d')
  if (!ctx) return { ok: false, destroy() {} }
  let raf = null, t0 = null, done = false
  const frame = t => {
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1)
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
    const ink = getComputedStyle(canvas).color
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    draw(ctx, t, w, h, dpr, ink)
  }
  const finish = () => { if (done) return; done = true; if (onComplete) onComplete() }
  const step = now => {
    if (t0 === null) t0 = now
    const t = startAt + (now - t0) / 1000
    if (endAt !== null && t >= endAt) { frame(endAt); raf = null; finish(); return }
    frame(t); raf = requestAnimationFrame(step)
  }
  // The first frame is drawn now, not on the next one: a mark that was on screen a moment ago (the
  // splash taking over from the still G) must not blink off in between.
  if (reduced) { frame(stillAt); finish() } else { frame(startAt); raf = requestAnimationFrame(step) }
  return { ok: true, destroy() { if (raf !== null) cancelAnimationFrame(raf); raf = null; done = true } }
}
