// What the arm, shoulder and hold drills share (curl.js, lateral-raise.js, plank.js,
// side-plank.js) on top of kit.js: a limb's angle from hanging read from image-vertical facts
// (yaw leaves those alone), a rep machine on peaks and valleys for movements whose bottom is part
// of the standard (a half rep never gets back to the top of kit.createPhaseMachine), the camera's
// height against the shoulders, the bend of a body line at the hip, and a clock for holds.
import { GAP_MS, LOST_RESET_MS, deg, dist, ema, mid, seen } from './kit.js'

export const UNSEEN = 'unseen'

// --- A limb's angle from hanging ----------------------------------------------------------

/**
 * The length of a segment (`from` -> `to`, e.g. 'Elbow' -> 'Wrist') as it hangs: its longest
 * image length while its image direction is within `tol` degrees of straight down. Hanging, a limb
 * is upright and yaw does not foreshorten it; swung towards the camera it still points down in
 * the image but looks shorter, so a sample under `keep` of the length so far is left out, unless
 * it stays so for `resetFrames` (the lifter stepped back). push(joints, side, aspect) -> the
 * length so far (image heights), null until first seen hanging.
 */
export function createHangRef(from, to, { tol = 20, keep = 0.92, resetFrames = 45 } = {}) {
  const ref = { left: null, right: null }, short = { left: 0, right: 0 }
  return {
    push(joints, side, aspect = 1) {
      const a = seen(joints, side + from), b = seen(joints, side + to)
      if (a && b) {
        const dx = (b[0] - a[0]) * aspect, dy = b[1] - a[1]
        const len = Math.hypot(dx, dy)
        if (dy > 0 && len > 0 && deg(Math.atan2(Math.abs(dx), dy)) <= tol) {
          const r = ref[side]
          if (r == null || len > r * 1.15 || short[side] >= resetFrames) { ref[side] = len; short[side] = 0 } else if (len >= r * keep) { ref[side] = ema(r, len, 0.1); short[side] = 0 } else short[side]++
        }
      }
      return ref[side]
    },
    get(side) { return ref[side] },
  }
}

/**
 * How high a segment has swung up from hanging, as the lift of its end: 0 hanging, 90 level, 180
 * straight up, linear in the end's height (90 times one minus its image-vertical drop under the
 * start over the hanging length `ref`). Image-vertical, so turning about the vertical leaves it
 * alone; linear, so noise weighs the same at every height (an angle's acos is steep at hanging).
 * liftDeg() turns it into the segment's angle from hanging. null when a joint is not seen.
 */
export function liftFromHang(joints, side, from, to, ref) {
  const a = seen(joints, side + from), b = seen(joints, side + to)
  if (!a || !b || !(ref > 0)) return null
  return 90 * (1 - Math.max(-1, Math.min(1, (b[1] - a[1]) / ref)))
}

/** A lift (liftFromHang) as the segment's angle from hanging, in degrees. */
export const liftDeg = lift => (lift == null ? null : deg(Math.acos(Math.max(-1, Math.min(1, 1 - lift / 90)))))

/** The lift of a segment at `angle` degrees from hanging: liftDeg's inverse. */
export const liftOf = angle => 90 * (1 - Math.cos(angle * Math.PI / 180))

/**
 * The lift of both arms' segment, averaged when both are seen surely enough (a near and a far
 * arm moving together: their perspective errors cancel), else the surer one's; null when neither.
 * `refs` is a createHangRef. Returns { value, sides, each: { left, right } } or null.
 */
export function bothArms(joints, refs, from, to, aspect, minConf = 0.5) {
  const vals = []
  const each = { left: null, right: null }
  for (const side of ['left', 'right']) {
    refs.push(joints, side, aspect)
    const v = liftFromHang(joints, side, from, to, refs.get(side))
    const c = Math.min((seen(joints, side + from) || [0, 0, 0])[2] ?? 1, (seen(joints, side + to) || [0, 0, 0])[2] ?? 1)
    if (v != null) { vals.push({ side, v, c }); each[side] = v }
  }
  if (!vals.length) return null
  const sure = vals.filter(x => x.c >= minConf)
  const use = sure.length ? sure : [vals.reduce((a, b) => (b.c > a.c ? b : a))]
  return { value: use.reduce((s, x) => s + x.v, 0) / use.length, sides: use.map(x => x.side), each }
}

// --- The camera's height --------------------------------------------------------------------

/**
 * Where the camera sits against the shoulders, read while standing: (shoulder height - camera
 * height) over the torso's length, from how far the shoulders sit above the image's middle row
 * over the torso's image length (a level camera's middle row is its own height). 0 with the
 * phone at shoulder height, about 1 with it at hip height; null without shoulders and hips.
 */
export function cameraBelowShoulders(frame) {
  const j = frame && frame.joints
  const aspect = frame && frame.aspect > 0 ? frame.aspect : 1
  const sh = mid(j, 'Shoulder'), hp = mid(j, 'Hip')
  if (!sh || !hp) return null
  const torso = dist(sh, hp, aspect)
  return torso > 0 ? (0.5 - sh[1]) / torso : null
}

// --- Reps on peaks and valleys ----------------------------------------------------------------

/**
 * A rep machine for a movement measured as one scalar that rises to a top and falls back (an arm's
 * swing in degrees), where a rep may stop short at either end. A rep starts when the signal rises
 * `rise` over its last valley and ends, past its peak, when it is back under `low`, or has stopped
 * falling for `settleMs`, or rises `rise` again (the next rep began). A rise under `minAmp` is a
 * wobble, not a rep. It started at the last moment within `band` of its valley, reached and left
 * the top at the first and last moments within `topBand` of its peak, and reached the bottom at
 * the first moment within `band` of where it came down to, so tempo leaves out the pauses. Lost pose as kit.createPhaseMachine: a gap over GAP_MS marks the rep `lost`,
 * one over LOST_RESET_MS drops it.
 *
 * push(t, s) -> { phase, seen, rep, started, ended, dropped }; phase 'waiting' | 'bottom' |
 * 'ascending' | 'descending'. Records: { startT, startLow, peak, peakT, topEndT, endT, endLow, lost }:
 * the valley it started from, its peak (reached at peakT, left at topEndT), and where it came back
 * down to.
 */
export function createCycleMachine({ rise, minAmp, low, settleMs = 600, smooth = 0.5, flatEps = 2, band = 4, topBand = 2 }) {
  let phase = 'waiting'
  let sm = null, lastSeenT = null
  let valley = null, valleyT = 0
  let rep = null, flatT = 0
  let down = []              // (t, signal) on the way down, to time where the bottom was reached
  let upHist = []            // and on the way up, to time where the top was reached and left
  const out = (seenNow, extra = {}) => ({ phase, seen: seenNow, rep: null, started: false, ended: false, dropped: false, ...extra })

  function end(r, dropped) {
    const reached = down.find(([, v]) => v <= r.endLow + band)
    if (reached) r.endT = reached[0]
    down = []
    rep = null
    phase = 'bottom'
    valley = r.endLow
    valleyT = r.endT
    if (r.peak - r.startLow < minAmp) return out(true, { dropped })
    return out(true, { rep: r, ended: true, dropped })
  }

  function push(t, raw) {
    if (raw == null || !Number.isFinite(raw)) {
      if (rep) {
        rep.lost = true
        if (lastSeenT != null && t - lastSeenT > LOST_RESET_MS) { rep = null; phase = 'waiting'; return out(false, { dropped: true }) }
      }
      return out(false, { rep })
    }
    let dropped = false
    if (rep && lastSeenT != null && t - lastSeenT > LOST_RESET_MS) { rep = null; phase = 'waiting'; dropped = true }
    if (rep && lastSeenT != null && t - lastSeenT > GAP_MS) rep.lost = true
    sm = lastSeenT == null || t - lastSeenT > GAP_MS ? raw : ema(sm, raw, smooth)
    lastSeenT = t

    if (phase === 'waiting') { phase = 'bottom'; valley = sm; valleyT = t; return out(true, { dropped }) }
    if (phase === 'bottom') {
      if (sm < valley) valley = sm
      if (sm <= valley + band) valleyT = t
      if (sm > valley + rise) {
        phase = 'ascending'
        rep = { startT: valleyT, startLow: valley, peak: sm, peakT: t, topEndT: t, endT: null, endLow: null, lost: false }
        upHist = [[t, sm]]
        return out(true, { rep, started: true, dropped })
      }
      return out(true, { dropped })
    }
    const r = rep
    if (phase === 'ascending') {
      if (sm > r.peak) { r.peak = sm; r.peakT = t }
      upHist.push([t, sm])
      if (sm < r.peak - rise) {
        const near = upHist.filter(([, v]) => v >= r.peak - topBand)
        if (near.length) { r.peakT = near[0][0]; r.topEndT = near[near.length - 1][0] }
        upHist = []
        phase = 'descending'; r.endLow = sm; r.endT = t; flatT = t; down = [[t, sm]]
      }
      return out(true, { rep: r, dropped })
    }
    // descending
    down.push([t, sm])
    if (sm < r.endLow - flatEps) { r.endLow = sm; r.endT = t; flatT = t } else if (sm < r.endLow) { r.endLow = sm; r.endT = t }
    if (sm <= low || t - flatT >= settleMs || sm > r.endLow + rise) return end(r, dropped)
    return out(true, { rep: r, dropped })
  }

  return { push, get phase() { return phase } }
}

/** A cycle record's way up and way down in seconds, to a tenth; a pause at the top is in neither. */
export function cycleTempo(rec) {
  const r1 = n => Math.round(n * 10) / 10
  const topEnd = rec.topEndT ?? rec.peakT
  return {
    upSec: r1(Math.max(0, rec.peakT - rec.startT) / 1000),
    downSec: r1(Math.max(0, (rec.endT ?? topEnd) - topEnd) / 1000),
  }
}

// --- A body line ---------------------------------------------------------------------------

/**
 * How far a body line (shoulder - hip - ankle) bends at the hip, in degrees: positive when the hip
 * sits below the shoulder-to-ankle line (sagging towards the floor), negative above it (piked),
 * 0 straight. Image-plane geometry, x stretched by aspect; null when a point is missing or the
 * line is upright (the body is not lying along the floor).
 */
export function lineBend(sh, hip, ank, aspect = 1) {
  if (!sh || !hip || !ank) return null
  const ux = (sh[0] - hip[0]) * aspect, uy = sh[1] - hip[1], vx = (ank[0] - hip[0]) * aspect, vy = ank[1] - hip[1]
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy)
  if (!(n > 0) || Math.abs(sh[0] - ank[0]) * aspect < 1e-6) return null
  const bend = 180 - deg(Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))))
  const f = (hip[0] - sh[0]) / (ank[0] - sh[0])
  const lineY = sh[1] + f * (ank[1] - sh[1])
  return hip[1] >= lineY ? bend : -bend
}

/** The angle of the line from `a` to `b` off the horizontal, in degrees (0 level, 90 upright). */
export function tilt(a, b, aspect = 1) {
  return deg(Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0]) * aspect))
}

// --- Holds ---------------------------------------------------------------------------------

/**
 * The clock of a hold drill. push(t, state, bend) per frame, state: 'good' (in position and in
 * line), a miss reason (in position, out of line), null (seen, not in position: the clock stops
 * and the stretch ends) or UNSEEN (the pose could not be read: the stretch goes on, marked `lost`
 * when the gap passes GAP_MS, and ends when it passes LOST_RESET_MS). Only time in 'good' counts, each frame adding the time since the last one (a gap
 * over GAP_MS adds nothing). A stretch out of line that lasts `graceMs` is said (`missed`, with
 * its reason) and again every `repeatMs` while it lasts. `milestone` seconds held say the count.
 *
 * push -> { count, missed, reason, phase }: count, whole seconds held; missed true on the frame a
 * stretch out of line is due to be said; phase 'waiting' | 'holding' | 'out'.
 * stretches() -> [{ good, reason, ms, startT, endT, lost, bends }] every stretch in position, the
 * ones out of line shorter than `graceMs` folded into their neighbours.
 */
export function createHoldClock({ graceMs = 800, repeatMs = 5000, milestone = 10 } = {}) {
  let goodMs = 0, badMs = 0
  let lastT = null, lastState = null
  let cur = null                 // the stretch under way: { good, reason, ms, startT, endT, lost, bends }
  let badSince = null, badReason = null, lastSaidT = -Infinity
  const list = []

  const close = () => { if (cur) { list.push(cur); cur = null } }
  const open = (good, reason, t) => { cur = { good, reason, ms: 0, startT: t, endT: t, lost: false, bends: [] } }

  function push(t, state, bend = null) {
    if (state === UNSEEN) {
      if (cur && lastT != null && t - lastT > LOST_RESET_MS) { close(); lastState = null }
      const phase = lastState == null ? 'waiting' : lastState === 'good' ? 'holding' : 'out'
      return { count: Math.floor(goodMs / 1000), missed: false, reason: null, phase, goodMs, badMs }
    }
    const dt = lastT == null ? 0 : t - lastT
    const gap = dt > GAP_MS
    const step = gap ? 0 : dt
    // The time since the last frame belongs to the state seen then.
    if (lastState === 'good') goodMs += step
    else if (lastState) badMs += step
    if (cur && lastState) { cur.ms += step; cur.endT = t }
    if (cur && gap && state) cur.lost = true
    lastT = t
    lastState = state
    let missed = false, reason = null
    if (!state) {
      close()
      badSince = null
      return { count: Math.floor(goodMs / 1000), missed, reason, phase: 'waiting', goodMs, badMs }
    }
    const good = state === 'good'
    if (good) {
      badSince = null
      if (!cur) open(true, null, t)
      else if (!cur.good) {
        // A stretch out of line shorter than the grace folds back into the line, its time with it:
        // it was never said, and a reading that wavers on the line does not cost the lifter time.
        if (cur.ms < graceMs) { goodMs += cur.ms; badMs -= cur.ms }
        if (cur.ms < graceMs && list.length && list[list.length - 1].good && list[list.length - 1].endT >= cur.startT - GAP_MS) {
          const prev = list.pop()
          prev.ms += cur.ms; prev.endT = t; prev.bends.push(...cur.bends); prev.lost = prev.lost || cur.lost
          cur = prev
        } else if (cur.ms < graceMs) { cur.good = true; cur.reason = null } else { close(); open(true, null, t) }
      }
    } else {
      if (badSince == null || badReason !== state) { badSince = t; badReason = state }
      if (!cur) open(false, state, t)
      else if (cur.good) { close(); open(false, state, t) } else if (cur.reason !== state && t - badSince >= graceMs) { close(); open(false, state, t) }
      if (t - badSince >= graceMs && t - lastSaidT >= repeatMs) { missed = true; reason = state; lastSaidT = t }
    }
    if (bend != null && cur) cur.bends.push(bend)
    return { count: Math.floor(goodMs / 1000), missed, reason, phase: good ? 'holding' : 'out', goodMs, badMs }
  }

  /** Whether the count just passed a milestone: call with the count before and after a push. */
  const milestonePassed = (before, after) => Math.floor(after / milestone) > Math.floor(before / milestone)

  return {
    push,
    milestonePassed,
    stretches: () => [...list, ...(cur ? [cur] : [])].map(s => ({ ...s, bends: [...s.bends] })),
    get goodMs() { return goodMs },
    get badMs() { return badMs },
  }
}
