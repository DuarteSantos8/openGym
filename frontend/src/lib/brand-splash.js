// The splash: the G draws itself, then "gains" arrives letter by letter, each letter settling into
// its weight (Jost 200, 350, 500, 650, 800). The brand kit's timing and layout (gains-logo.js),
// drawn in the CSS colour of the canvas (brand-motion.js), over a transparent
// canvas: the page behind it is the background.
//
// The letters are outlines (brand-glyphs.js, 31 KB gzipped) and load only when a splash is going to
// play, through loadGlyphs().
import { drawMark, ease, run } from './brand-motion.js'

const WEIGHTS = [200, 350, 500, 650, 800]
const LETTERS = 'gains'
// The timeline, as fractions of SPLASH_LOOP: the G is drawn by 0.29, the first letter starts at 0.30,
// each next one STAGGER later, and each takes SETTLE to reach its weight. The splash ends when the
// last letter has settled: no hold after it, the app is not kept waiting for a tail.
const LETTERS_FROM = 0.30, STAGGER = 0.04, SETTLE = 0.10, FADE_IN = 0.04
export const SPLASH_LOOP = 1.8
export const G_DONE = 0.29 * SPLASH_LOOP
export const SPLASH_END = SPLASH_LOOP * (LETTERS_FROM + (LETTERS.length - 1) * STAGGER + SETTLE)
// Layout in css px: the G's box is 100 wide, its centre 38 above the middle of the screen (the
// place index.html and BootMark hold it), the letters' baseline 48 below the middle.
const G_UP = 38, BASE_DOWN = 48, EM = 42, TRACK = 5

const easeOut = x => { x = x < 0 ? 0 : x > 1 ? 1 : x; return 1 - Math.pow(1 - x, 3.2) }
const seg = (t, a, b) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a))

let glyphs = null
export async function loadGlyphs() {
  if (!glyphs) glyphs = (await import('./brand-glyphs.js')).default
  return glyphs
}

const paths = {}
function glyphPath(GLY, w, ch) {
  const k = w + ch
  return paths[k] || (paths[k] = new Path2D(GLY.w[w][ch].d))
}

// One letter at weight `wt`, between the two outlines either side of it.
function drawLetter(ctx, GLY, ch, wt, x, y, em, alpha, ink) {
  const w0 = Math.max(100, Math.min(800, Math.floor(wt / 50) * 50)), w1 = Math.min(800, w0 + 50), f = (wt - w0) / 50
  for (const [w, share] of [[w0, 1 - f], [w1, f]]) {
    if (share <= 0.001) continue
    ctx.save(); ctx.globalAlpha = alpha * share
    ctx.translate(x, y); ctx.scale(em / 1000, -em / 1000)
    ctx.fillStyle = ink; ctx.fill(glyphPath(GLY, w, ch)); ctx.restore()
  }
}

// The frame at time t (seconds into the splash's loop) on a w x h css px canvas at `dpr`.
export function drawSplash(ctx, GLY, t, w, h, dpr, ink) {
  const p = Math.min(1, t / SPLASH_LOOP)
  const stage = p < 0.04 ? p / 0.04 : 1
  const cx = w * dpr / 2, cy = h * dpr / 2 - G_UP * dpr
  const gf = ease(seg(p, 0.04, 0.29))
  if (gf > 0.001) drawMark(ctx, 0, gf, 100 * dpr, cx - 50 * dpr, cy - 50 * dpr, ink, stage)

  const em = EM * dpr, base = h * dpr / 2 + BASE_DOWN * dpr
  const adv = LETTERS.split('').map((ch, i) => GLY.w[WEIGHTS[i]][ch].a)
  let x = cx - (adv.reduce((n, a) => n + a, 0) + TRACK * (LETTERS.length - 1)) * em / 1000 / 2
  for (let j = 0; j < LETTERS.length; j++) {
    const s0 = LETTERS_FROM + j * STAGGER, q = easeOut(seg(p, s0, s0 + SETTLE))
    const wt = 100 + (WEIGHTS[j] - 100) * q
    const alpha = stage * Math.min(1, seg(p, s0, s0 + FADE_IN))
    if (alpha > 0.001) {
      // Centre the letter on its own advance as its weight (and so its width) changes.
      const a0 = GLY.w[Math.min(800, Math.max(100, Math.round(wt / 50) * 50))][LETTERS[j]].a
      drawLetter(ctx, GLY, LETTERS[j], wt, x + (adv[j] - a0) * em / 1000 / 2, base + (1 - q) * 8 * dpr, em, alpha, ink)
    }
    x += (adv[j] + TRACK) * em / 1000
  }
  ctx.globalAlpha = 1
}

// The splash on a canvas, ending at SPLASH_END with its last frame held and `onComplete` called.
// `fromG`: start with the G already drawn, for a launch that has already shown it (index.html's
// first frame, the native launch image), so it does not vanish and redraw.
export function createSplash(canvas, GLY, { fromG = false, reduced = false, onComplete, maxDpr } = {}) {
  return run(canvas, (ctx, t, w, h, dpr, ink) => drawSplash(ctx, GLY, t, w, h, dpr, ink),
    { startAt: fromG ? G_DONE : 0, endAt: SPLASH_END, stillAt: SPLASH_END, reduced, onComplete, maxDpr })
}
