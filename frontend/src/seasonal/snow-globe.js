// The snow globe (Christmas): shake the phone hard and the snow lying at the bottom of the screen
// flies up and swirls, the way it does in a glass globe, then drifts down slowly through the
// "water" and melts away. Shaking again while it swirls stirs it some more. Plain numbers here,
// drawn by SnowGlobe in christmas.jsx on one canvas, so it can be tested without a screen.
//
// Units: pixels and seconds. The phone's x points right and y up; the screen's y points down.

export const FLAKE_COUNT = 150
// The water: a flake's own speed gives way to the water's at e^-DRAG per second, so a flake
// thrown at 2000 px/s rides the current within a second or so, and in still water sinks at about
// GRAVITY / DRAG: 40 to 75 px/s, a screen in ten seconds or so, like a real globe.
const DRAG = 1.7
const GRAVITY = 95
// The fastest the turning water moves anywhere, so the corners of a tall screen do not fly off.
const CURRENT_MAX = 750
// The swirl the shake leaves in the water, in turns-ish per second, and how fast it dies down.
const SWIRL_MAX = 3
const SWIRL_FADE = 0.8
// Off the glass: a flake bounces back at this share of its speed.
const BOUNCE = 0.45
// On the floor: slower than this and a flake lies there, then melts over MELT_S after LIE_S.
const SETTLE_SPEED = 90
const LIE_S = 1.4
const MELT_S = 1.2
// However much it is shaken, the globe goes quiet this long after the last shake: whatever still
// floats fades out over FADE_ALL_S before it.
export const MAX_CALM_S = 22
const FADE_ALL_S = 2

/** A globe of `w` × `h` with its snow lying at the bottom, before the first shake. */
export function makeGlobe(w, h, n = FLAKE_COUNT, rand = Math.random) {
  const flakes = Array.from({ length: n }, () => {
    const depth = 0.3 + rand() * 0.7 // near flakes are bigger, brighter and a little heavier
    return { x: rand() * w, y: h - rand() * 14, vx: 0, vy: 0, r: 1 + depth * 2.8, depth, ph: rand() * 6.283, lie: 0, gone: false, floor: rand() * 10 }
  })
  return { w, h, flakes, swirl: 0, spin: rand() < 0.5 ? -1 : 1, calm: 0, t: 0 }
}

/** The globe resized (the phone turned): every flake kept on the glass. */
export function fitGlobe(G, w, h) {
  if (!G || (G.w === w && G.h === h)) return G
  const sx = w / (G.w || w), sy = h / (G.h || h)
  for (const f of G.flakes) { f.x *= sx; f.y *= sy }
  G.w = w; G.h = h
  return G
}

/**
 * A shake: every flake, lying or drifting, is flung. The snow lags behind the glass, so it flies
 * against the push, spread wide, mostly upwards, and the water starts to turn.
 */
export function stir(G, { x = 0, y = 0, strength = 1 } = {}, rand = Math.random) {
  const s = Math.max(0.6, Math.min(3, Number(strength) || 1))
  const len = Math.hypot(x, y)
  const dx = len ? -x / len : 0
  const dy = len ? y / len : 0 // phone y is up, screen y is down: pushed up, the snow goes down
  const kick = Math.max(G.w, G.h) * 1.9 * s
  for (const f of G.flakes) {
    const k = kick * (0.45 + rand() * 0.75) * (1.25 - f.depth * 0.4)
    f.vx += (dx * 0.55 + (rand() - 0.5) * 1.5) * k
    f.vy += (dy * 0.55 + (rand() - 0.5) * 1.2 - 0.45) * k
    f.lie = 0
    f.gone = false
  }
  G.swirl = Math.min(SWIRL_MAX, G.swirl + 1.3 * s)
  if (rand() < 0.25) G.spin = -G.spin
  G.calm = 0
  return G
}

/** One frame of `dt` seconds. Returns false once every flake has melted (the globe can go). */
export function stepGlobe(G, dt) {
  const d = Math.min(0.05, Math.max(0, dt)) // a frame after the app was away is one frame, not a leap
  G.t += d
  G.calm += d
  G.swirl *= Math.exp(-SWIRL_FADE * d)
  const cx = G.w / 2, cy = G.h / 2
  const keep = Math.exp(-DRAG * d)
  const late = G.calm > MAX_CALM_S
  let alive = false
  for (const f of G.flakes) {
    if (f.gone) continue
    if (late) { f.gone = true; continue }
    const floor = G.h - f.r - f.floor
    if (f.lie > 0) {
      f.lie += d
      if (f.lie >= LIE_S + MELT_S) { f.gone = true; continue }
      alive = true
      continue
    }
    alive = true
    // The turning water: it goes round the middle like a stirred glass, carrying the snow along
    // (not flinging it at the glass), with a little wobble so no two flakes take the same path.
    const rx = f.x - cx, ry = f.y - cy
    const om = G.swirl * 0.9 * G.spin
    // A stirred glass also draws its water in towards the middle, which keeps the snow out in the
    // open instead of pressed against the glass.
    const pull = Math.min(1, G.swirl) * 0.5
    let ux = -ry * om - rx * pull, uy = rx * om - ry * pull
    const us = Math.hypot(ux, uy)
    if (us > CURRENT_MAX) { ux *= CURRENT_MAX / us; uy *= CURRENT_MAX / us }
    const wob = Math.min(1, G.swirl) * 80
    ux += Math.sin(G.t * 2.3 + f.ph) * wob
    uy += Math.cos(G.t * 1.9 + f.ph * 1.3) * wob
    const sink = GRAVITY * (0.7 + f.depth * 0.6) / DRAG
    f.vx = ux + (f.vx - ux) * keep
    f.vy = uy + sink + (f.vy - uy - sink) * keep
    // Near the glass the water slides along it: a flake there is eased back in, so none sticks.
    const edge = Math.min(f.x, G.w - f.x)
    if (edge < 28) f.vx += (f.x < G.w / 2 ? 1 : -1) * (1 - edge / 28) * 420 * d
    f.x += f.vx * d
    f.y += f.vy * d
    if (f.x < f.r) { f.x = f.r; f.vx = Math.abs(f.vx) * BOUNCE }
    else if (f.x > G.w - f.r) { f.x = G.w - f.r; f.vx = -Math.abs(f.vx) * BOUNCE }
    if (f.y < f.r) { f.y = f.r; f.vy = Math.abs(f.vy) * BOUNCE }
    else if (f.y >= floor) {
      f.y = floor
      if (Math.abs(f.vy) < SETTLE_SPEED && G.swirl < 0.4) { f.vx = 0; f.vy = 0; f.lie = d }
      else { f.vy = -Math.abs(f.vy) * BOUNCE * 0.6; f.vx *= 0.8 }
    }
  }
  return alive
}

/** How visible a flake is now: 0 once melted, fading while it melts on the floor, and all of
    them fading out just before the globe goes quiet (MAX_CALM_S). */
export function flakeAlpha(f, G = null) {
  if (f.gone) return 0
  const end = G ? Math.min(1, Math.max(0, (MAX_CALM_S - G.calm) / FADE_ALL_S)) : 1
  const base = (0.45 + f.depth * 0.5) * end
  if (f.lie <= LIE_S) return base
  return base * Math.max(0, 1 - (f.lie - LIE_S) / MELT_S)
}
