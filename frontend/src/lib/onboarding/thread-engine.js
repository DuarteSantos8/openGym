// The thread on screen (motion-onboarding-thread.md §1, §4, "Surviving the real React app"). At
// rest every scene owns its line ([data-thread] = line | blade | check) in its own DOM. When the
// next screen's anchor registers, one overlay path takes the line from where the last one rested
// and hands it to the new anchor: the anchor is hidden while the thread travels and shown again in
// the frame it lands. rAF-driven, so a transition that starts mid-flight starts from the live shape.
//
// The old screen is gone by the time the new one mounts (the router swaps them), so the start is
// `last`: the old anchor measured as it unregistered, still in place.
import { birthPlan, checkP, dOf, evalAt, lineP, planBetween } from './thread-geometry.js'

// New-screen content the line sweeps across mid-glide: held at 0 until it lands, then 160ms in.
const HOLD = '.ob-hd > *, .ob-cap, .ob-controls > *, .ob-pk-read, .ob-ruler, .ob-wheel, .ob-field, .ob-pl-hint, .ob-pl-sess, .ob-pl-fit, .ob-pass-t, .ob-pass-s'
// The art starts this long before the thread lands, so it visibly grows from the line.
const LEAD_MS = 120
// When a screen has landed: OnboardingLayout brings it in over 320ms after a 60ms delay.
export const LAND_MS = 380

/** An anchor's resting shape in viewport coordinates, or null where it cannot be measured. */
export function measureAnchor(el) {
  const own = el?.ownerSVGElement
  const m = typeof el?.getScreenCTM === 'function' ? el.getScreenCTM() : null
  if (!m || !own) return null
  const map = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
  const scale = Math.hypot(m.a, m.b)
  const cs = getComputedStyle(el)
  const form = el.getAttribute('data-thread')
  const shape = { form, w: (parseFloat(cs.strokeWidth) || 1.5) * scale, c: cs.stroke, o: 1 }
  if (form === 'check') {
    // data-k: the scale the disc pops from, about the viewBox centre, where the check is when the thread lands.
    const n = String(el.getAttribute('data-pts')).split(' ').map(Number), k = Number(el.getAttribute('data-k') || 1)
    const vb = own.viewBox.baseVal, ox = vb.x + vb.width / 2, oy = vb.y + vb.height / 2
    const q = i => map(ox + k * (n[i] - ox), oy + k * (n[i + 1] - oy))
    shape.p = checkP(q(0), q(2), q(4))
    shape.w *= k
  } else {
    const b = el.getBBox(), y = b.y + b.height / 2
    const A = map(b.x, y), B = map(b.x + b.width, y)
    shape.p = lineP(A[0], A[1], B[0], B[1])
  }
  return shape.p.every(Number.isFinite) && hasLength(shape) ? shape : null
}
// A zero-size line (display:none, not laid out) is no place to land.
const hasLength = shape => Math.abs(shape.p[24] - shape.p[0]) + Math.abs(shape.p[25] - shape.p[1]) > 0.5

/**
 * layer(): { svg, path } of ThreadLayer, read when a run starts. blocked(): whether to skip the
 * morph (reduced motion, the keyboard up, a sheet open), when scenes simply show their own lines.
 * clip(el): { top, bottom } of the visible scroll rect for the screen of `el`. onCount(n): how many
 * anchors are registered (the guard test reads it).
 */
export function createThreadEngine({ layer, blocked, clip, onCount = () => {} }) {
  const anchors = new Set()
  let last = null, live = null, run = null, owned = null, fade = null, born = false

  function paint(shape) {
    const { path } = layer()
    path.setAttribute('d', dOf(shape.p))
    path.style.strokeWidth = shape.w.toFixed(2) + 'px'
    path.style.stroke = shape.c
    path.style.opacity = String(shape.o)
  }
  function hideLayer() {
    const { svg } = layer()
    if (!svg) return
    svg.style.visibility = 'hidden'
    svg.style.willChange = ''
  }
  function release() {
    if (owned?.isConnected) owned.removeAttribute('data-thread-claim')
    owned = null
    run = null
    live = null
    hideLayer()
  }
  function claim(el) {
    owned = el
    el.setAttribute('data-thread-claim', '')
    // The thread carries this line in: the scene does not draw it again.
    el.setAttribute('data-thread-carried', '')
  }
  function holdCrossed(from, dest, el, arrive) {
    const screen = el.closest('.ob-screen')
    if (!arrive || !screen) return
    const xs = [], ys = []
    for (const p of [from.p, dest.p]) for (let i = 0; i < 26; i += 2) { xs.push(p[i]); ys.push(p[i + 1]) }
    const pad = Math.max(from.w, dest.w) / 2 + 4
    const l = Math.min(...xs) - pad, r = Math.max(...xs) + pad, t = Math.min(...ys) - pad, b = Math.max(...ys) + pad
    for (const x of screen.querySelectorAll(HOLD)) {
      const q = x.getBoundingClientRect()
      if (!q.height || q.right < l || q.left > r || q.bottom < t || q.top > b) continue
      x.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: arrive, easing: 'linear', fill: 'backwards' })
    }
  }
  function start(base, plan, el) {
    const { svg } = layer()
    if (!svg) return
    if (fade) { fade.cancel(); fade = null }
    const { top, bottom } = clip(el)
    svg.style.clipPath = `inset(${Math.max(0, top)}px 0 ${Math.max(0, window.innerHeight - bottom)}px 0)`
    svg.style.visibility = 'visible'
    svg.style.willChange = 'contents'
    live = base
    paint(base)
    let t0 = null, id = 0
    const r = {
      dead: false,
      finish() {
        if (r.dead) return
        r.dead = true
        cancelAnimationFrame(id)
        release()
      },
      cancel() { r.dead = true; cancelAnimationFrame(id); if (run === r) run = null },
    }
    const frame = now => {
      if (r.dead) return
      if (t0 === null) t0 = now
      const t = now - t0
      if (t >= plan.total) { r.finish(); return }
      live = evalAt(base, plan.segs, t)
      paint(live)
      id = requestAnimationFrame(frame)
    }
    run = r
    id = requestAnimationFrame(frame)
  }
  /** No morph: the thread steps aside in 100ms and the scenes show their own lines. */
  function abort() {
    if (owned?.isConnected) owned.removeAttribute('data-thread-claim')
    owned = null
    if (!run) return
    run.cancel()
    run = null
    live = null
    const { svg } = layer()
    if (!svg?.animate) { hideLayer(); return }
    fade = svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: 'linear' })
    fade.onfinish = () => { fade = null; hideLayer() }
  }

  /** An anchor arrived. `birth`: the invite's line, drawn out of a dot the first time. Returns the cleanup. */
  function register(el, { birth = false } = {}) {
    anchors.add(el)
    onCount(anchors.size)
    const dest = measureAnchor(el)
    const from = run && live ? live : last
    if (run) { run.cancel(); run = null }
    if (!dest || blocked()) {
      abort()
    } else if (!from) {
      if (birth && !born) {
        born = true
        const plan = birthPlan(dest)
        claim(el)
        start(plan.base, plan, el)
      }
    } else {
      const plan = planBetween(from, dest)
      claim(el)
      if (plan.arrive) {
        el.ownerSVGElement?.style.setProperty('--lead', Math.max(0, plan.arrive - LEAD_MS) + 'ms')
        holdCrossed(from, dest, el, plan.arrive)
        start(from, plan, el)
      } else {
        // The floors coincide (the goal-to-weight run): the thread holds the line still, painted
        // where it was, while the new screen fades and slides in under it, and hands it over once
        // the screen has landed.
        start(from, { segs: [], total: LAND_MS, arrive: 0 }, el)
      }
    }
    if (dest) last = dest
    return () => {
      anchors.delete(el)
      onCount(anchors.size)
      if (owned === el) {
        // Interrupted mid-flight: the next run starts from the shape on screen, not from this
        // anchor at rest.
        const flying = run && live ? live : null
        if (flying) last = flying
        run?.cancel()
        release()
        if (flying) return
      }
      // Measured on the way out, while it is still in place: where the next run starts.
      const rest = !run && el.isConnected ? measureAnchor(el) : null
      if (rest) last = rest
    }
  }

  return {
    register,
    finish() { run?.finish() },
    abort,
  }
}
