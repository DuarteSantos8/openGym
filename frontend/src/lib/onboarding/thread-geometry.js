// The thread's shapes and timelines (fitness-eval motion-onboarding-thread.md §1, §4; prototype v4
// TH). Pure numbers: the DOM side is components/onboarding/ThreadProvider.jsx.
//
// One path, fixed topology: M E0 C c c E1 C c c E2 C c c E3 C c c E4 — 13 points, 26 floats. Every
// form (line, blade, check, ring, arc) is written in that shape, so any two morph by a plain
// per-coordinate lerp. A shape is { form, p: number[26], w (stroke px), c (a CSS colour), o }.
// This PR's screens use line, blade and check; the Summary's ring comes with the Summary.

const lerp = (a, b, k) => a + (b - a) * k
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/** Five end points with the handles at thirds. */
export function fromEnds(E) {
  const p = [E[0][0], E[0][1]]
  for (let s = 0; s < 4; s++) {
    const a = E[s], b = E[s + 1]
    p.push(lerp(a[0], b[0], 1 / 3), lerp(a[1], b[1], 1 / 3), lerp(a[0], b[0], 2 / 3), lerp(a[1], b[1], 2 / 3), b[0], b[1])
  }
  return p
}
export const lineP = (x0, y0, x1, y1) => fromEnds([0, 1, 2, 3, 4].map(i => [lerp(x0, x1, i / 4), lerp(y0, y1, i / 4)]))
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
/** A check: A down to the valley V, up to B. */
export const checkP = (A, V, B) => fromEnds([A, mid(A, V), V, mid(V, B), B])

/** The path data of a shape's points. */
export function dOf(p) {
  let d = 'M' + p[0].toFixed(2) + ' ' + p[1].toFixed(2)
  for (let i = 2; i < 26; i += 6) d += 'C' + p.slice(i, i + 6).map(v => v.toFixed(2)).join(' ')
  return d
}

/**
 * Colour `k` of the way from `a` to `b`. Both are the anchors' own computed strokes (their tokens,
 * resolved), never a colour of the thread's: the browser mixes them, in both themes alike.
 */
export function mixColour(a, b, k) {
  if (k <= 0 || a === b) return a
  if (k >= 1) return b
  return `color-mix(in srgb, ${b} ${(k * 100).toFixed(1)}%, ${a})`
}

// Easing curves, as the app's tokens: --ease, --ease-io, and an ease-out.
export function bezier(x1, y1, x2, y2) {
  const cx = u => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
  const cy = u => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
  const dx = u => 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2)
  return t => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let u = t
    for (let i = 0; i < 8; i++) {
      const d = dx(u)
      if (Math.abs(d) < 1e-6) break
      u = clamp(u - (cx(u) - t) / d, 0, 1)
    }
    return cy(u)
  }
}
export const EASE = bezier(0.32, 0.72, 0, 1)
export const EASE_IO = bezier(0.65, 0, 0.35, 1)
export const EASE_OUT = bezier(0, 0, 0.58, 1)

/** A segment of a timeline: from `at` for `dur` ms, toward `to` ({ p, w, c, o }), E-points optionally staggered. */
export const seg = (at, dur, ease, to, stagger = 0) => ({ at, dur, ease, to, stagger })

/** The shape at time `t` of a timeline: each segment lerps from what the earlier ones made toward its target. */
export function evalAt(base, segs, t) {
  const p = base.p.slice()
  let w = base.w, o = base.o, c = base.c
  for (const s of segs) {
    const l = t - s.at
    if (l <= 0) continue
    const q = s.ease(clamp(l / s.dur, 0, 1))
    if (s.to.p) {
      const st = s.stagger, d = Math.max(1, s.dur - 4 * st)
      for (let j = 0; j < 13; j++) {
        const qj = st ? s.ease(clamp((l - (st * j) / 3) / d, 0, 1)) : q
        p[2 * j] += (s.to.p[2 * j] - p[2 * j]) * qj
        p[2 * j + 1] += (s.to.p[2 * j + 1] - p[2 * j + 1]) * qj
      }
    }
    if (s.to.w !== undefined) w += (s.to.w - w) * q
    if (s.to.o !== undefined) o += (s.to.o - o) * q
    if (s.to.c) c = mixColour(c, s.to.c, q)
  }
  return { form: 'live', p, w, c, o }
}

const near = (A, B) => A.p.every((v, i) => Math.abs(v - B.p[i]) < 1) && Math.abs(A.w - B.w) < 0.1

/**
 * The timeline from one resting shape to the next, by form (§1 "Screen by screen"):
 *   blade → check: glide to the disc and shorten (0-260), then bend into the valley (260-420);
 *   check → line: unbend (0-160), then glide and widen to the floor (120-420);
 *   line ↔ blade: 360ms; anything else a 320ms glide, still when the two already coincide.
 * { segs, total, arrive }: `arrive` is when the line is home (0: it never moved).
 */
export function planBetween(from, to) {
  const F = from.form, T = to.form
  if (F === 'blade' && T === 'check') {
    const p = to.p
    const straight = { p: lineP(p[0], p[1], p[24], p[25]), w: (from.w + to.w) / 2, c: mixColour(from.c, to.c, 0.5) }
    return { segs: [seg(0, 260, EASE, straight), seg(260, 160, EASE_OUT, to)], total: 420, arrive: 420 }
  }
  if (F === 'check' && T === 'line') {
    const p = from.p
    return { segs: [seg(0, 160, EASE_OUT, { p: lineP(p[0], p[1], p[24], p[25]) }), seg(120, 300, EASE, to)], total: 420, arrive: 420 }
  }
  if ((F === 'line' && T === 'blade') || (F === 'blade' && T === 'line')) {
    return { segs: [seg(0, 360, EASE, to)], total: 360, arrive: 360 }
  }
  return { segs: [seg(0, 320, EASE, to)], total: 320, arrive: near(from, to) ? 0 : 320 }
}

/** The invite's birth: a 6px dot at the floor's centre draws outward both ways over 480ms. */
export function birthPlan(dest) {
  const cx = (dest.p[0] + dest.p[24]) / 2, y = dest.p[1]
  const base = { ...dest, p: lineP(cx - 0.05, y, cx + 0.05, y), w: 6 }
  return { base, segs: [seg(0, 480, EASE_IO, { p: dest.p }), seg(0, 200, EASE_OUT, { w: dest.w })], total: 480, arrive: 480 }
}
