// What every drill shares (README.md): reading joints, angles, smoothing, the side and the view
// the lifter is filmed from, framing, a rep state machine driven by one scalar, tempo, spread and
// cue picking. Pure functions and small closures; nothing here knows a movement.
//
// A frame is { t: ms, aspect: width / height of the image, joints: { leftHip: [x, y, conf], ... } }
// in normalised image coordinates, y growing downward (FormCheckPlugin.swift). x is stretched by
// `aspect` before any distance or angle is taken, or an upright 3:4 image would bend every knee.
import { t } from '../i18n-core.js'

export const MIN_CONF = 0.25          // joints seen less surely than this are not seen
export const SMOOTH = 0.5             // weight of the newest value in a running average
export const GAP_MS = 400             // a longer gap between seen frames is a lost pose
export const LOST_RESET_MS = 2500     // lost this long mid-rep: the rep is dropped
export const FAR_HEIGHT = 0.25        // shoulder to ankle under this share of the frame, squatting too: too far

export const round1 = n => Math.round(n * 10) / 10
export const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
export const deg = r => r * 180 / Math.PI
const other = side => (side === 'left' ? 'right' : 'left')

/** The joint as [x, y, conf] when it is there and seen surely enough, else null. */
export function seen(joints, name) {
  const j = joints && joints[name]
  return Array.isArray(j) && j.length >= 2 && Number.isFinite(j[0]) && Number.isFinite(j[1]) && (j[2] ?? 1) >= MIN_CONF ? j : null
}

/** The middle of a left/right pair ('Hip' -> leftHip, rightHip), or the one of them seen; null if neither. */
export function mid(joints, part) {
  const l = seen(joints, 'left' + part), r = seen(joints, 'right' + part)
  if (l && r) return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, Math.min(l[2] ?? 1, r[2] ?? 1)]
  return l || r || null
}

/** The angle at `b` in degrees between a-b-c (180 straight), null when one is missing. */
export function angleAt(a, b, c, aspect = 1) {
  if (!a || !b || !c) return null
  const ux = (a[0] - b[0]) * aspect, uy = a[1] - b[1], vx = (c[0] - b[0]) * aspect, vy = c[1] - b[1]
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy)
  if (!(n > 0)) return null
  return deg(Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))))
}

/** The distance between two joints in image heights, x stretched by `aspect`. */
export const dist = (a, b, aspect = 1) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1])

/** A running average: `prev` moved `w` of the way to `x`; `x` itself when there is no `prev`. */
export const ema = (prev, x, w = SMOOTH) => (prev == null ? x : prev + w * (x - prev))

/** The least confidence along a chain of parts on one side ('left', ['Hip', 'Knee']); 0 if one is not seen. */
export function chainConf(joints, side, chain) {
  let c = 1
  for (const part of chain) {
    const j = seen(joints, side + part)
    if (!j) return 0
    c = Math.min(c, j[2] ?? 1)
  }
  return c
}

/** The side whose whole chain is seen, the surer one; null if neither. */
export function pickSide(joints, chain) {
  const l = chainConf(joints, 'left', chain), r = chainConf(joints, 'right', chain)
  if (!l && !r) return null
  return l >= r ? 'left' : 'right'
}

/** pickSide over time: the confidences are smoothed so one bad frame does not swap sides. */
export function createSidePicker(chain, w = 0.2) {
  const conf = { left: 0, right: 0 }
  return joints => {
    for (const s of ['left', 'right']) conf[s] += w * (chainConf(joints, s, chain) - conf[s])
    return conf.left >= conf.right ? 'left' : 'right'
  }
}

// --- The view -------------------------------------------------------------------------------
// From the side the shoulders and hips stack up and look narrow; facing the camera they are as
// wide as they are. Their apparent width over the torso's length is about 0.58 times the sine of
// the yaw for a usual build (0 side-on, 0.58 facing), so it names the view. It is read only while
// the lifter stands tall (a bent torso looks shorter) and kept with hysteresis, so a frame of
// noise at a boundary does not flip it. A far joint Vision does not see counts as a width of 0:
// hidden behind the near one, which is what side-on looks like.
export const VIEWS = ['side', 'diagonal', 'front']
export const VIEW_EDGES = { side: 0.2, front: 0.53 }    // first guess: under side is side, over front is front
export const VIEW_HYST = 0.035                          // and once chosen, it must cross the edge by this to change
const VIEW_SAMPLES = 4                                  // standing frames before a first guess

/** The apparent shoulder and hip width over the torso length (x stretched by aspect), null when unseen. */
export function widthRatio(frame) {
  const j = frame && frame.joints
  const aspect = frame && frame.aspect > 0 ? frame.aspect : 1
  const sh = mid(j, 'Shoulder'), hp = mid(j, 'Hip')
  if (!sh || !hp) return null
  const torso = dist(sh, hp, aspect)
  if (!(torso > 0)) return null
  const width = part => {
    const l = seen(j, 'left' + part), r = seen(j, 'right' + part)
    return l && r ? Math.abs(l[0] - r[0]) * aspect : 0
  }
  return (width('Shoulder') + width('Hip')) / 2 / torso
}

const classify = (r, prev) => {
  const lo = VIEW_EDGES.side, hi = VIEW_EDGES.front
  if (prev === 'side') return r > lo + VIEW_HYST ? (r > hi ? 'front' : 'diagonal') : 'side'
  if (prev === 'front') return r < hi - VIEW_HYST ? (r < lo ? 'side' : 'diagonal') : 'front'
  if (prev === 'diagonal') return r < lo - VIEW_HYST ? 'side' : r > hi + VIEW_HYST ? 'front' : 'diagonal'
  return r < lo ? 'side' : r > hi ? 'front' : 'diagonal'
}

/**
 * The view over time. push(frame, standing) reads the frame only when `standing` and returns the
 * view so far: 'side' | 'diagonal' | 'front', or null until a few standing frames were seen.
 */
export function createViewDetector() {
  let ratio = null, n = 0, view = null
  return {
    push(frame, standing) {
      if (!standing) return view
      const r = widthRatio(frame)
      if (r == null) return view
      ratio = ema(ratio, r, 0.25)
      n++
      if (n >= VIEW_SAMPLES) view = classify(ratio, view)
      return view
    },
    get view() { return view },
    get ratio() { return ratio },
  }
}

/** The view a list of frames was filmed from, every frame read as standing; null when unseen. */
export function detectView(frames) {
  const d = createViewDetector()
  for (const f of frames || []) d.push(f, true)
  return d.view
}

// --- Framing and the status line ------------------------------------------------------------

/**
 * Why a frame cannot be judged, for the status line: 'none' (nobody there), 'partial' (`chain` of
 * neither side, or no shoulder), 'far' (too small in the frame). null when it can be.
 */
export function framing(frame, chain = ['Hip', 'Knee', 'Ankle']) {
  const joints = frame && frame.joints
  if (!joints || !Object.keys(joints).some(k => seen(joints, k))) return 'none'
  if (!pickSide(joints, chain)) return 'partial'
  const shoulders = ['leftShoulder', 'rightShoulder'].map(k => seen(joints, k)).filter(Boolean)
  if (!shoulders.length) return 'partial'
  const feet = ['leftAnkle', 'rightAnkle'].map(k => seen(joints, k)).filter(Boolean)
  if (!feet.length) return null
  const height = Math.max(...feet.map(a => a[1])) - Math.min(...shoulders.map(s => s[1]))
  return height < FAR_HEIGHT ? 'far' : null
}

/** What the status line says for a framing() reason. */
export function framingHint(reason) {
  switch (reason) {
    case 'none': return t('Step into the frame')
    case 'partial': return t('Get your whole body in the frame')
    case 'far': return t('Come a little closer')
    default: return ''
  }
}

/** What the status line says when the view is not one of the drill's `views`; '' when it is. */
export function viewHint(view, views) {
  if (!view || views.includes(view)) return ''
  const best = views[0]
  if (best === 'side') return t('Turn side-on to the camera')
  if (best === 'front') return t('Face the camera')
  return t('Turn halfway towards the camera')
}

// --- Reps -------------------------------------------------------------------------------------

/**
 * The rep state machine every reps drill runs on, driven by one scalar per frame: how far into
 * the rep the lifter is, 0 at the top and about 1 at full depth (null when it cannot be read).
 *   waiting -> standing -> descending -> bottom -> ascending -> standing (a rep)
 * It waits until the lifter was at the top once (`canStart`), so setting up is not a rep. A
 * descent starts past `descent`; it is a rep only when it went past `minRep`, so a wobble at the
 * top is not; it ends when the signal is back under `stand`. Thresholds (signal units):
 *   stand, descent, minRep     the top, the start of a descent, the least depth of a rep
 *   bottomEps, ascentRise      back up this far from the deepest point: at the bottom, on the way up
 *   topBand                    within this of the standing level (an average of the top): still at the top, where tempo starts
 * Lost pose: a gap over GAP_MS marks the rep under way `lost`; one over LOST_RESET_MS drops it.
 *
 * push(t, s, { canStart }) -> { phase, seen, rep, started, ended, dropped }: `rep` the record of
 * the rep this frame belongs to (under way, or ended on this frame), `started`/`ended` on the
 * frame it starts or ends, `dropped` when a lost rep was given up. Records: { startT, bottomT,
 * endT, upEndT, peak, rawPeak, lost }; `upEndT` is set once the lifter is back at the top.
 */
export function createPhaseMachine({ stand, descent, minRep, bottomEps, ascentRise, topBand }) {
  let phase = 'waiting'
  let sm = null              // smoothed signal
  let lastSeenT = null
  let topRef = 0             // the standing level, an average of the signal while at the top
  let topT = 0               // the last moment still at the top, where a descent starts
  let rep = null             // the rep under way
  let closing = null         // an ended rep whose way up is still being timed

  const closeUp = at => { if (closing) { closing.upEndT = Math.max(closing.upEndT, at); closing = null } }
  const out = (seenNow, extra = {}) => ({ phase, seen: seenNow, rep: null, started: false, ended: false, dropped: false, ...extra })

  function push(t, raw, { canStart = true } = {}) {
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
    sm = lastSeenT == null || t - lastSeenT > GAP_MS ? raw : ema(sm, raw)
    lastSeenT = t

    if (phase === 'waiting') {
      if (sm <= stand && canStart) { phase = 'standing'; topRef = sm; topT = t }
      return out(true, { dropped })
    }
    if (phase === 'standing') {
      // The standing level follows the signal while it is at the top (an average, not the
      // lowest: the lowest of a noisy signal sits under it and would end the top too early).
      if (sm <= topRef + topBand) { topRef = ema(topRef, sm, 0.3); topT = t }
      else if (sm < topRef) topRef = sm
      if (closing && sm <= closing.ref + topBand) closeUp(t)
      if (sm > descent) {
        closeUp(topT)
        phase = 'descending'
        rep = { startT: topT, bottomT: t, endT: null, upEndT: null, ref: topRef, peak: sm, rawPeak: raw, lost: false }
        return out(true, { rep, started: true, dropped })
      }
      return out(true, { dropped })
    }
    const r = rep
    if (raw > r.rawPeak) r.rawPeak = raw
    if (sm > r.peak) { r.peak = sm; r.bottomT = t }
    if (phase === 'descending') {
      if (sm < r.peak - ascentRise) phase = 'ascending'
      else if (sm < r.peak - bottomEps) phase = 'bottom'
    } else if (phase === 'bottom') {
      if (sm >= r.peak) phase = 'descending'
      else if (sm < r.peak - ascentRise) phase = 'ascending'
    } else if (phase === 'ascending' && sm >= r.peak) phase = 'descending'
    if (phase === 'ascending' && sm <= stand) {
      rep = null
      phase = 'standing'
      topRef = sm
      topT = t
      if (r.rawPeak < minRep) return out(true, { dropped })
      r.endT = t
      r.upEndT = t
      closing = r
      return out(true, { rep: r, ended: true, dropped })
    }
    return out(true, { rep: r, dropped })
  }

  return { push, get phase() { return phase } }
}

/** A rep record's way down and way up in seconds, to a tenth. */
export function tempo(rec) {
  return {
    downSec: round1(Math.max(0, rec.bottomT - rec.startT) / 1000),
    upSec: round1(Math.max(0, (rec.upEndT ?? rec.endT ?? rec.bottomT) - rec.bottomT) / 1000),
  }
}

/** Max minus min of the numbers given (nulls left out), rounded; null for fewer than two. */
export function spread(values) {
  const xs = values.filter(x => x != null && Number.isFinite(x))
  return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : null
}

/** Whether the last third of `values` fell below the first third by more than `by` (needs 4 or more). */
export function fades(values, by) {
  const n = values.length
  if (n < 4) return false
  const k = Math.ceil(n / 3)
  return mean(values.slice(0, k)) - mean(values.slice(-k)) > by
}

/** The first cue id whose test holds: `rules` is [[id, () => bool], ...], the last a catch-all. */
export function pickCue(rules) {
  for (const [id, test] of rules) if (test()) return id
  return rules.length ? rules[rules.length - 1][0] : null
}

/**
 * The catalogue test drills share: an exercise ({ id, n, cat }) matches by its id in `ids`, or
 * by a name matching `name` and not `not`, in one of `cats` (any category when the exercise has none).
 */
export function matchExercise(ex, { ids = new Set(), name = null, not = null, cats = null }) {
  if (!ex || typeof ex !== 'object') return false
  if (ids.has(ex.id)) return true
  const n = String(ex.n || '')
  if (!name || !name.test(n) || (not && not.test(n))) return false
  return !ex.cat || !cats || cats.has(ex.cat)
}
