// What the pulling drills share (README.md): one rep signal read from the arm alone, the view, and
// a tracker the drills fill in with their standard and their extras. Hanging from a bar, rowing to
// one, lying on a bench or bent over, the arm is the one thing that always moves the same way: the
// distal joint (the wrist on a bar, the elbow with dumbbells) comes towards the shoulder, and its
// image-vertical distance from the shoulder shrinks. Turning about the vertical axis (yaw) leaves
// image-vertical distances alone, so counting works from any angle.
//
//   reach r: the distal joint's vertical distance from the shoulders (wrists above, elbows below);
//   ref:     r at rest (dead hang, arms hanging), the longest seen there;
//   signal:  (ref - r) / ref, 0 at rest, 1 with the distal joint level with the shoulders.
//
// The view cannot come from kit.widthRatio here: it divides by the torso's length, and a torso
// that hangs, lies or leans looks short or long for reasons other than the yaw. The arm at rest
// hangs vertical whatever the body does, so the shoulders' apparent width over the reach at rest
// is about k sin(yaw), k the build's shoulder width over the reach (createArmViewDetector).
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  createPhaseMachine, dist, ema, fades, framingHint, mean, mid, pickCue, round1, seen, tempo, viewHint,
} from './kit.js'

export const HANG_S = 0.12            // signal at most this before a rep: started from a full hang / straight arms
export const REST_S = 0.15            // signal under this: at rest, where the reach and the view are read
export const FAST_DOWN_SEC = 1        // an average way down under this: "lower with control"
export const FADE_S = 0.12            // last reps' peak this much under the first ones': they got shorter
export const ARM_VIEW_EDGES = { side: 0.345, front: 0.914 }  // sin(yaw): about 20° and 66°, as the squat's
export const ARM_VIEW_HYST = 0.06
const VIEW_SAMPLES = 4

/** The reach a frame shows: shoulders, the distal joint ('Wrist' | 'Elbow'), and r; null when unseen. */
export function armReach(joints, distal, above) {
  const sh = mid(joints, 'Shoulder'), d = mid(joints, distal)
  if (!sh || !d) return null
  return { sh, d, r: above ? sh[1] - d[1] : d[1] - sh[1] }
}

/**
 * Holding something above: on every side whose elbow and wrist are seen, the wrist is above the
 * elbow by at least a quarter forearm. False with no forearm seen. Letting go of the bar fails it, so
 * arms dropped to the sides are never read as a pull to the top.
 */
export function forearmsUp(joints, aspect = 1) {
  let n = 0
  for (const s of ['left', 'right']) {
    const e = seen(joints, s + 'Elbow'), w = seen(joints, s + 'Wrist')
    if (!e || !w) continue
    const len = dist(e, w, aspect)
    if (!(len > 0)) continue
    if (e[1] - w[1] < 0.25 * len) return false
    n++
  }
  return n > 0
}

const classify = (r, prev) => {
  const lo = ARM_VIEW_EDGES.side, hi = ARM_VIEW_EDGES.front, h = ARM_VIEW_HYST
  if (prev === 'side') return r > lo + h ? (r > hi ? 'front' : 'diagonal') : 'side'
  if (prev === 'front') return r < hi - h ? (r < lo ? 'side' : 'diagonal') : 'front'
  if (prev === 'diagonal') return r < lo - h ? 'side' : r > hi + h ? 'front' : 'diagonal'
  return r < lo ? 'side' : r > hi ? 'front' : 'diagonal'
}

/**
 * The view over time from the shoulders' width over the reach at rest, divided by `k` (the build's
 * shoulder width over that reach) so it reads about sin(yaw). push(frame, ref) at rest only. A far
 * shoulder Vision does not see counts as a width of 0, hidden behind the near one: side-on.
 */
export function createArmViewDetector(k) {
  let ratio = null, n = 0, view = null
  return {
    push(frame, ref) {
      const j = frame && frame.joints
      const aspect = frame && frame.aspect > 0 ? frame.aspect : 1
      if (!j || !(ref > 0)) return view
      const l = seen(j, 'leftShoulder'), r = seen(j, 'rightShoulder')
      if (!l && !r) return view
      const width = l && r ? Math.abs(l[0] - r[0]) * aspect : 0
      ratio = ema(ratio, width / ref / k, 0.25)
      n++
      if (n >= VIEW_SAMPLES) view = classify(ratio, view)
      return view
    },
    get view() { return view },
    get ratio() { return ratio },
  }
}

/** Why a frame cannot be judged: 'none', 'partial' (no shoulder, or no `distal` joint), 'far'. null when it can. */
export function armFraming(joints, distal, ref, farRef) {
  if (!joints || !Object.keys(joints).some(k => seen(joints, k))) return 'none'
  if (!mid(joints, 'Shoulder') || !mid(joints, distal) || !mid(joints, 'Elbow')) return 'partial'
  return ref != null && ref < farRef ? 'far' : null
}

const fmt = n => (n == null ? '' : fmtNum(n))

/**
 * A reps tracker for one arm-driven drill. `spec`:
 *   views, distal, above, k (createArmViewDetector), farRef (reach under this: too far), phases
 *   hang: whether a rep must start from rest (straight arms) under some standard
 *   needs: { [standard]: { top, hang } }  what each standard asks
 *   topOf(ctx) -> number | null, per frame, the bigger the higher; topNeed: what counts as the top
 *   topViews: the views the top is judged from (all when left out)
 *   onRest(state, ctx), extraHint(state, phase) -> '' | string
 *   extras: { frame(x, ctx), finish(x, rec) -> measures } per view, optional
 *   text: { start, ready, missed(n, reason), none, unjudged, cues: [[id, test(summary), text]] ...}
 *   tiles, details: see buildResult
 * ctx: { joints, aspect, sh, d, s, ref, view, state }.
 */
export function createArmTracker(spec, { standard, view: fixedView } = {}) {
  const std = spec.standards.some(s => s.id === standard) ? standard : spec.defaultStandard
  const needs = spec.needs[std] || {}
  const machine = createPhaseMachine(spec.phases)
  const views = createArmViewDetector(spec.k)
  const reps = []                 // { rec, acc, counted, reason, measures }
  const state = {}                // the drill's own memory (onRest)
  let ref = null, sm = null, lastS = null
  let low = Infinity              // the lowest signal while at rest since the last rep
  let acc = null

  const viewNow = () => fixedView || views.view
  const topJudged = v => !spec.topViews || spec.topViews.includes(v)
  const count = () => reps.filter(r => r.counted).length
  const hangOk = h => (h == null ? null : h <= HANG_S)
  const topOk = top => (top == null ? null : top >= spec.topNeed)

  function reachedNow() {
    if (!acc || acc.rec.rawPeak < spec.phases.minRep) return false
    if (needs.hang && hangOk(acc.hang) === false) return false
    if (needs.top && acc.judged && !topOk(acc.top)) return false
    return true
  }

  function finish(rec) {
    const a = acc
    const top = a.judged ? a.top : null
    const tOk = topOk(top), hOk = spec.hang ? hangOk(a.hang) : null
    const reason = needs.top && tOk === false ? 'low' : needs.hang && hOk === false ? 'hang' : null
    const counted = rec.lost || !reason
    const measures = {
      view: a.view,
      top: top == null ? null : Math.round(top * 100) / 100,
      topOk: tOk,
      peak: Math.round(rec.peak * 100) / 100,
    }
    if (spec.hang) { measures.hang = a.hang == null ? null : Math.round(a.hang * 100) / 100; measures.hangOk = hOk }
    const ex = spec.extras && spec.extras[a.view]
    if (ex) Object.assign(measures, ex.finish(a.x, rec))
    reps.push({ rec, counted, reason: counted ? null : reason, measures })
    acc = null
    return { counted, reason }
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, spec.views)
    if (vh) return vh
    const extra = spec.extraHint ? spec.extraHint(state, phase) : ''
    if (extra) return extra
    if (phase === 'waiting') return spec.text.start()
    return count() ? '' : spec.text.ready()
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const aspect = frame && frame.aspect > 0 ? frame.aspect : 1
    const fr = { t: at, aspect, joints }
    const why = armFraming(joints, spec.distal, ref, spec.farRef)
    const a = why ? null : armReach(joints, spec.distal, spec.above)
    const holding = !!a && (!spec.above || forearmsUp(joints, aspect))
    const phase0 = machine.phase
    const atRest = (phase0 === 'waiting' || phase0 === 'standing') && (lastS == null || lastS < REST_S)
    if (holding && atRest && a.r > 0) {
      ref = ref == null ? a.r : a.r > ref ? ema(ref, a.r, 0.5) : ref
      if (!fixedView) views.push(fr, ref)
      if (spec.onRest) spec.onRest(state, { joints, aspect, sh: a.sh, d: a.d, ref })
    }
    const s = holding && ref ? (ref - a.r) / ref : null
    sm = s == null ? null : ema(sm, s)
    if (s != null) lastS = s
    const ev = machine.push(at, s, { canStart: holding })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    let hangBefore = null
    if (ev.started) { hangBefore = Number.isFinite(low) ? low : null; low = Infinity }
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: topJudged(v), top: null, hang: hangBefore, x: {} }
      }
      if (s != null) {
        const ctx = { joints, aspect, sh: a.sh, d: a.d, s, ref, view: acc.view, state }
        if (acc.judged) {
          const top = spec.topOf(ctx)
          if (top != null && (acc.top == null || top > acc.top)) acc.top = top
        }
        const ex = spec.extras && spec.extras[acc.view]
        if (ex) ex.frame(acc.x, ctx)
      }
      if (ev.ended) {
        const out = finish(ev.rep)
        if (out.counted) justCounted = true
        else { justMissed = true; reason = out.reason }
      }
    }
    if (machine.phase === 'standing' && sm != null && sm < low) low = sm
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached ? spec.highlight : [], view: viewNow(),
    }
  }

  function result() {
    return buildResult(spec, reps, std, viewNow())
  }

  return { push, result }
}

/** Of every rep whose top was judged, no-reps included, how many reached it. { hit, of }. */
export function topShare(reps) {
  const list = (Array.isArray(reps) ? reps : []).filter(r => r.measures && r.measures.topOk != null)
  return { hit: list.filter(r => r.measures.topOk).length, of: list.length }
}

/** Of every rep whose start was seen, no-reps included, how many started from rest. { hit, of }. */
export function hangShare(reps) {
  const list = (Array.isArray(reps) ? reps : []).filter(r => r.measures && r.measures.hangOk != null)
  return { hit: list.filter(r => r.measures.hangOk).length, of: list.length }
}

function buildResult(spec, reps, std, view) {
  const list = reps.map(r => {
    const tp = tempo(r.rec)
    // The phase machine's way "down" is into the rep: here the pull up; its way "up" is the way back down.
    return { counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, upSec: tp.downSec, downSec: tp.upSec } }
  })
  const counted = list.filter(r => r.counted)
  const n = counted.length
  const missed = list.length - n
  const m = counted.map(r => r.measures)
  const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
  const reasons = list.filter(r => !r.counted).map(r => r.reason)
  const lowN = reasons.filter(r => r === 'low').length
  const summary = {
    count: n,
    missed,
    missedReason: missed ? (lowN * 2 >= missed ? 'low' : 'hang') : null,
    avgUp: avg('upSec'),
    avgDown: avg('downSec'),
    unjudged: m.filter(x => x.topOk == null).length,
    lost: counted.filter(r => r.lost).length,
    measures: m,
  }
  const rules = [
    ['missed', () => missed > 0],
    ['none', () => !n],
    ['framing', () => summary.lost * 2 > n],
    ['unjudged', () => summary.unjudged * 2 > n],
    ...spec.text.cues.map(([id, test]) => [id, () => test(summary)]),
    ['slower', () => summary.avgDown < FAST_DOWN_SEC],
    ['fade', () => fades(m.map(x => x.peak), FADE_S)],
    ['steady', () => true],
  ]
  const cueId = pickCue(rules)
  const own = Object.fromEntries(spec.text.cues.map(([id, , text]) => [id, text]))
  const CUE = {
    missed: () => spec.text.missed(missed, summary.missedReason),
    none: spec.text.none,
    framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
    unjudged: spec.text.unjudged,
    slower: () => t('The way down took under a second. Try lowering with control.'),
    fade: () => t('The last reps were shorter than the first ones.'),
    steady: () => t('Range and tempo held steady across the set.'),
    ...own,
  }
  return {
    count: n,
    missed,
    reps: list,
    tiles: tiles(spec, list, summary),
    cue: CUE[cueId](),
    cueId,
    details: list.map(r => details(spec, r)),
    note: '',
    summary,
    standard: std,
    view,
  }
}

// The two or three headline figures: how many reps reached the top, how many started from rest
// (drills that judge it), and the counted reps' tempo.
function tiles(spec, list, s) {
  const out = []
  const top = topShare(list)
  if (top.of) out.push({ id: 'top', label: t('Top'), value: t('{0} of {1}', top.hit, top.of), sub: spec.text.topSub() })
  if (spec.hang) {
    const hang = hangShare(list)
    if (hang.of) out.push({ id: 'hang', label: t('Start'), value: t('{0} of {1}', hang.hit, hang.of), sub: spec.text.hangSub() })
  }
  if (s.avgUp != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgUp), fmt(s.avgDown)), sub: t('up / down, on average') })
  return out
}

// One rep's rows for "Every rep".
function details(spec, r) {
  const m = r.measures
  const rows = [{ label: t('Top'), value: m.topOk == null ? t('Not seen') : spec.text.topText(m.topOk) }]
  if (spec.hang) rows.push({ label: t('Start'), value: m.hangOk == null ? t('Not seen') : spec.text.hangText(m.hangOk) })
  rows.push({ label: t('Tempo'), value: t('Up {0} s · down {1} s', fmt(m.upSec), fmt(m.downSec)) })
  if (spec.text.extraRows) rows.push(...spec.text.extraRows(m))
  return rows
}

// --- Synthetic lifters, for the drills' tests only (test-kit.js films them) ------------------
// Body coordinates as test-kit.js: u forward, v up, w to the lifter's left, metres.

/** The lifter the posers draw, metres: test-kit.js's BODY (not imported: app code never loads the test kit). */
export const BODY = {
  ankleH: 0.08, shin: 0.43, thigh: 0.43, torso: 0.5, neck: 0.12, head: 0.14,
  hipHalf: 0.1, shoulderHalf: 0.19, stanceHalf: 0.15,
}

/** Arm segments in metres: shoulder to elbow, elbow to wrist. */
export const ARM = { upper: 0.3, fore: 0.27 }
export const BAR = 2.25               // a pull-up bar's height (the wrists)
export const LOW_BAR = 1.0            // an inverted row's bar
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l) }
const add = (a, b, k = 1) => a.map((x, i) => x + k * b[i])

// The elbow between shoulder S and wrist W, bent towards `toward` (a direction); straight when out of reach.
function elbowAt(S, W, toward) {
  const d = add(W, S, -1), L = Math.hypot(...d), a = ARM.upper, b = ARM.fore
  const u = d.map(x => x / L)
  if (L >= a + b) return add(S, u, a)
  const x = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - x * x))
  const dot = toward.reduce((s, v, i) => s + v * u[i], 0)
  const n = norm(toward.map((v, i) => v - dot * u[i]))
  return add(add(S, u, x), n, h)
}

/** The shoulders' height under the wrists in a dead hang with this grip (hand half-width). */
export const hangDrop = (grip = 0.2) => Math.sqrt((ARM.upper + ARM.fore) ** 2 - (grip - BODY.shoulderHalf) ** 2)

/**
 * Hanging from a bar: `d` is the wrists' height over the shoulders (hangDrop() hanging, about 0.1
 * with the chin over the bar). `p` (0 to 1) is how far into the rep; `swing` moves the hips forward
 * by that much at the top (metres), `tilt` raises the left shoulder over the right at the top.
 * `grip` the hands' half-width; `wide` bends the elbows out (pull-up) rather than forward (chin-up).
 */
export function hangPose(d, { p = 0, swing = 0, tilt = 0, grip = 0.2, wide = false, body = BODY } = {}) {
  const b = body
  const sv = BAR - d
  const out = {}
  const sw = swing * p, tl = tilt * p
  // Near the top the shoulders sit behind the hands, so the forearms can stay near vertical.
  const back = -0.2 * Math.max(0, 1 - d / hangDrop(grip))
  const dir = norm([sw, -Math.sqrt(Math.max(0, b.torso ** 2 - sw * sw))])
  for (const [side, k] of [['left', 1], ['right', -1]]) {
    const S = [back, sv + k * tl / 2, k * b.shoulderHalf]
    const W = [0, BAR, k * grip]
    out[side + 'Shoulder'] = S
    out[side + 'Wrist'] = W
    out[side + 'Elbow'] = elbowAt(S, W, wide ? [0, -1, 0.6 * k] : [0.5, -1, 0])
    const hip = [back + dir[0] * b.torso, sv + dir[1] * b.torso, k * b.hipHalf]
    out[side + 'Hip'] = hip
    out[side + 'Knee'] = [hip[0] + dir[0] * b.thigh, hip[1] + dir[1] * b.thigh, k * b.hipHalf]
    out[side + 'Ankle'] = [hip[0] + dir[0] * (b.thigh + b.shin), hip[1] + dir[1] * (b.thigh + b.shin), k * b.hipHalf]
  }
  out.neck = [back, sv + b.neck, 0]
  out.nose = [back + b.head * 0.6, sv + b.neck + b.head * 0.7, 0]
  return out
}

/** The inverted row's shoulder drop under the wrists with straight arms (grip 0.25). */
export const rowDrop = () => Math.sqrt((ARM.upper + ARM.fore) ** 2 - (0.25 - BODY.shoulderHalf) ** 2) - 0.005

/**
 * Lying under a low bar, heels on the floor, the body straight from heels to shoulders: `d` is the
 * wrists' height over the shoulders (rowDrop() at the bottom, about 0.05 with the chest at the
 * bar). `sag` drops the hips that far below the line at the top (metres); `knees` bends the knees.
 */
export function rowPose(d, { p = 0, sag = 0, body = BODY } = {}) {
  const b = body
  const len = b.shin + b.thigh + b.torso
  const ankleV = b.ankleH
  const s0 = (LOW_BAR - rowDrop() - ankleV) / len
  const ankleU = -len * Math.sqrt(1 - s0 * s0)           // the shoulders under the bar at the bottom
  const sin = (LOW_BAR - d - ankleV) / len, cos = Math.sqrt(1 - sin * sin)
  const dir = [cos, sin], up = [-sin, cos]
  const A = [ankleU, ankleV]
  const at = (k, off = 0) => [A[0] + dir[0] * k + up[0] * off, A[1] + dir[1] * k + up[1] * off]
  const S = at(len), knee = at(b.shin), hip = at(b.shin + b.thigh, -sag * p)
  const out = {}
  for (const [side, k] of [['left', 1], ['right', -1]]) {
    const Sh = [S[0], S[1], k * b.shoulderHalf]
    const W = [0, LOW_BAR, k * 0.25]
    out[side + 'Shoulder'] = Sh
    out[side + 'Wrist'] = W
    out[side + 'Elbow'] = elbowAt(Sh, W, [-0.6, -1, 0.2 * k])
    out[side + 'Hip'] = [hip[0], hip[1], k * b.hipHalf]
    out[side + 'Knee'] = [knee[0], knee[1], k * b.hipHalf]
    out[side + 'Ankle'] = [A[0], A[1], k * b.hipHalf]
  }
  const neck = at(len + b.neck)
  out.neck = [neck[0], neck[1], 0]
  const nose = add(at(len + b.neck + b.head * 0.6), [...up.map(x => x * b.head * 0.7)])
  out.nose = [nose[0], nose[1], 0]
  return out
}

export const INCLINE = 35             // the bench's angle from the floor, degrees

// Lying chest-down on an incline bench: the shoulders, hips, legs and head; the arms are added.
function proneBody(b, incline) {
  const a = incline * Math.PI / 180
  const dir = [Math.cos(a), Math.sin(a)], down = [Math.sin(a), -Math.cos(a)]
  const hip = [-0.25, 0.62]
  const S = add(hip, dir, b.torso)
  const knee = [hip[0] - 0.15, hip[1] - 0.4], ankle = [knee[0] - 0.4, b.ankleH]
  const neck = add(S, dir, b.neck)
  const nose = add(add(neck, dir, b.head * 0.6), down, b.head * 0.7)
  const out = { neck: [...neck, 0], nose: [...nose, 0] }
  for (const [side, k] of [['left', 1], ['right', -1]]) {
    out[side + 'Shoulder'] = [S[0], S[1], k * b.shoulderHalf]
    out[side + 'Hip'] = [hip[0], hip[1], k * b.hipHalf]
    out[side + 'Knee'] = [knee[0], knee[1], k * b.hipHalf]
    out[side + 'Ankle'] = [ankle[0], ankle[1], k * b.hipHalf]
  }
  return out
}

/**
 * A rear fly lying chest-down on an incline bench (or bent over: the arms are the same): `deg` is
 * each upper arm's angle out from hanging (0) to level with the shoulders (90). `uneven` keeps
 * the right arm that share lower; `incline` the bench in degrees.
 */
export function flyPose(deg, { p = 0, uneven = 0, incline = INCLINE, body = BODY } = {}) {
  const out = proneBody(body, incline)
  for (const [side, k] of [['left', 1], ['right', -1]]) {
    const f = (side === 'right' ? deg * (1 - uneven * p) : deg) * Math.PI / 180
    const S = out[side + 'Shoulder']
    const E = add(S, [0, -Math.cos(f), k * Math.sin(f)], ARM.upper)
    const g = f - 15 * Math.PI / 180
    out[side + 'Elbow'] = E
    out[side + 'Wrist'] = add(E, [0, -Math.cos(g), k * Math.sin(g)], ARM.fore)
  }
  return out
}

/**
 * A chest-supported row on an incline bench: `deg` is each upper arm's angle back from hanging (0)
 * towards the hips; the forearms hang from the elbows. The elbows pass the shoulder-hip line at
 * 90 - incline degrees.
 */
export function benchRowPose(deg, { incline = INCLINE, body = BODY } = {}) {
  const out = proneBody(body, incline)
  const f = deg * Math.PI / 180
  for (const [side, k] of [['left', 1], ['right', -1]]) {
    const S = out[side + 'Shoulder']
    const E = add(S, [-Math.sin(f), -Math.cos(f), k * 0.03], ARM.upper)
    out[side + 'Elbow'] = E
    out[side + 'Wrist'] = add(E, [0, -ARM.fore, 0])
  }
  return out
}

/**
 * A set from a pose function `pose(x, { p, ...opts })` of one motion parameter x: rest at `rest`
 * for `stand` seconds, then per rep { top, bottom, up, down, ...opts }: to `top` in `up` seconds,
 * back to `bottom` (rest when left out) in `down` seconds, `stand` seconds there. `p` runs 0 to 1
 * into the rep. Frames come from the caller's `film` (test-kit.js) with `opts`.
 */
export function armPoses(pose, rest, reps, { stand = 1, fps = 15, ease = f => (1 - Math.cos(Math.PI * f)) / 2 } = {}) {
  const poses = []
  const hold = (x, n, o) => { for (let i = 0; i < n; i++) poses.push(pose(x, o)) }
  let from = rest
  hold(rest, Math.round(stand * fps), { p: 0 })
  for (const r of reps) {
    const { top, bottom = rest, up, down, ...o } = r
    const nu = Math.max(2, Math.round(up * fps)), nd = Math.max(2, Math.round(down * fps))
    for (let i = 1; i <= nu; i++) { const f = ease(i / nu); poses.push(pose(from + (top - from) * f, { ...o, p: f })) }
    hold(top, 2, { ...o, p: 1 })
    for (let i = 1; i <= nd; i++) { const f = ease(i / nd); poses.push(pose(top + (bottom - top) * f, { ...o, p: 1 - f })) }
    hold(bottom, Math.round(stand * fps), { ...o, p: 0 })
    from = bottom
  }
  return poses
}
