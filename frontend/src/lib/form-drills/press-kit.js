// What the pressing drills share (README.md): two trackers, each driven by image-vertical facts of
// the arm that turning about the vertical axis (yaw) leaves alone.
//
// The arm drop (push-up, dip): the hands stay put and the shoulders sink towards them. How far into
// the rep is the shoulder's drop towards the wrists, over the arm's height at the top; the depth
// is the shoulder's height against the elbow's, in upper-arm lengths (positive below): level is the
// upper arm horizontal, the usual "elbows to 90". Outside a side view the elbows sit behind or in
// front of the shoulders at the bottom, and a camera above or below them misjudges their heights
// (perspective, as for the squat's knees), and the shoulders coming towards or going away from
// a camera far above or below them cancel most of their drop, so even the count fails. The elbows
// at the top are about where the shoulders will be at the bottom, so outside a side view a rep
// is read only when they sit near the image's middle row with the arms upright (the camera at
// elbow height and level); until then the status line asks for it and nothing is counted.
//
// The lockout (overhead press, pushdown): the wrist travels between a start and a lockout, and a
// rep counts when the elbow straightened. A straight arm looks straight from every angle (three
// points in a line stay in a line), so a 2D elbow angle near 180 never refuses a real lockout; a
// bent one shows only when the bend faces the camera, so each drill names the views it judges the
// lockout from and only counts and times the reps from the others.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createSidePicker, deg, dist, ema, fades, framingHint, mean, mid,
  pickCue, round1, seen, spread, tempo, viewHint,
} from './kit.js'

export const ARM = ['Shoulder', 'Elbow', 'Wrist']
const fmt = n => (n == null ? '' : fmtNum(n))
const aspectOf = frame => (frame && frame.aspect > 0 ? frame.aspect : 1)

// --- Framing and the view of a body lying face down --------------------------------------------

export const FLAT_FAR = 0.05          // the longest of forearm, arm, torso and body under this share of the frame: too far

/**
 * framing() for a body near the floor (push-up): 'none', 'partial' (no whole arm of either side, or
 * no hip), 'far' (small in the frame), null when it can be judged. The kit's framing reads the
 * body's height in the image, which a body lying down does not have.
 */
export function flatFraming(frame) {
  const j = frame && frame.joints
  if (!j || !Object.keys(j).some(k => seen(j, k))) return 'none'
  const arm = ['left', 'right'].some(s => ARM.every(p => seen(j, s + p)))
  const sh = mid(j, 'Shoulder'), hip = mid(j, 'Hip')
  if (!arm || !sh || !hip) return 'partial'
  const aspect = aspectOf(frame)
  // The forearm stays upright through the rep, so it keeps its length when the body foreshortens.
  const el = mid(j, 'Elbow'), wr = mid(j, 'Wrist')
  const ends = [wr, hip, mid(j, 'Knee'), mid(j, 'Ankle')].filter(Boolean)
  const longest = Math.max(...ends.map(e => dist(sh, e, aspect)), el && wr ? dist(el, wr, aspect) : 0)
  return longest < FLAT_FAR ? 'far' : null
}

// The kit tells the view from the shoulders' width over the torso's length, which only holds for
// an upright torso. Lying down, the arms at the top stand upright whatever the view, so they give
// the scale: the torso is about TORSO_OVER_ARM of the arm, its image-vertical part gives the
// body's incline, and what is left of its image-horizontal part is the cosine of the yaw. The
// shoulders' width would say the same, but the shoulders sit off the camera's axis at one end of
// the body, where the near one looks wider apart than it is (parallax).
export const TORSO_OVER_ARM = 0.88
export const FLAT_VIEW_EDGES = { side: 0.34, front: 0.9 }   // sine of the yaw: 20° and about 64°
const FLAT_HYST = 0.06

/** The sine of the yaw of a body lying down, arms upright at the top; null when unseen. */
export function flatYawSine(frame) {
  const j = frame && frame.joints
  const sh = mid(j, 'Shoulder'), wr = mid(j, 'Wrist'), hip = mid(j, 'Hip')
  if (!sh || !wr || !hip) return null
  const arm = wr[1] - sh[1]
  if (!(arm > 0)) return null
  const torso = TORSO_OVER_ARM * arm
  const sinIncline = Math.min(0.99, Math.abs(hip[1] - sh[1]) / torso)
  const cosYaw = Math.min(1, Math.abs(sh[0] - hip[0]) * aspectOf(frame) / (torso * Math.sqrt(1 - sinIncline * sinIncline)))
  return Math.sqrt(1 - cosYaw * cosYaw)
}

const classifyFlat = (r, prev) => {
  const lo = FLAT_VIEW_EDGES.side, hi = FLAT_VIEW_EDGES.front, h = FLAT_HYST
  if (prev === 'side') return r > lo + h ? (r > hi ? 'front' : 'diagonal') : 'side'
  if (prev === 'front') return r < hi - h ? (r < lo ? 'side' : 'diagonal') : 'front'
  if (prev === 'diagonal') return r < lo - h ? 'side' : r > hi + h ? 'front' : 'diagonal'
  return r < lo ? 'side' : r > hi ? 'front' : 'diagonal'
}

/** The kit's createViewDetector() for a body lying down: push(frame, atTop) -> view or null. */
export function createFlatViewDetector() {
  let ratio = null, n = 0, view = null
  return {
    push(frame, atTop) {
      if (!atTop) return view
      const r = flatYawSine(frame)
      if (r == null) return view
      ratio = ema(ratio, r, 0.25)
      n++
      if (n >= 4) view = classifyFlat(ratio, view)
      return view
    },
    get view() { return view },
    get ratio() { return ratio },
  }
}

// --- The arm drop: push-up and dip ---------------------------------------------------------------

export const DROP_FULL = 0.5          // the shoulder's drop at the bottom, in arm heights: the signal's 1
export const DROP_STRAIGHT = 0.8      // upper arm over forearm (image-vertical) at least this: arms straight
export const DROP_TOP_S = 0.08        // signal under this: at the top, where the arm is measured
export const LEVEL_BAND = 0.1         // shoulder within this many upper arms of the elbow: level
export const DROP_LEVEL_ROW = 0.06    // elbows at the top at most this far from the middle row: camera at elbow height
export const DROP_LEVEL_ROLL = 12     // degrees the arms at the top may lean in the image: camera upright
export const FAST_DOWN_SEC = 1        // an average way down under this: "slow the way down"
export const FADE_S = 0.17            // the last reps' drop this much under the first ones'
export const DROP_PHASES = { stand: 0.08, descent: 0.14, minRep: 0.35, bottomEps: 0.04, ascentRise: 0.15, topBand: 0.015 }

export const DROP_STANDARDS = [
  { id: 'level', label: 'Shoulders to elbow height' },
  { id: 'below', label: 'Shoulders below the elbows' },
  { id: 'any', label: 'Any depth' },
]
export const SHALLOW_MISS = { shallow: { line: 'Too shallow. Not counted.', say: 'Too shallow', row: 'Not counted: too shallow' } }

/** The depth's name from the shoulder's height against the elbow (upper arms, positive below). */
export const dropDepthOf = hd => (hd == null ? null : hd > LEVEL_BAND ? 'below' : hd < -LEVEL_BAND ? 'above' : 'level')

/** Whether a depth meets a standard; a depth not seen is given the rep. */
export const dropMeets = (depth, standard) => standard === 'any' || depth == null || (standard === 'below' ? depth === 'below' : depth !== 'above')

const DROP_DEPTH_TEXT = { below: () => t('Below the elbows'), level: () => t('At elbow height'), above: () => t('Above the elbows') }
const dropDepthText = d => (DROP_DEPTH_TEXT[d] ? DROP_DEPTH_TEXT[d]() : t('Depth not seen'))

export const DROP_CUE = {
  missed: (n, standard) => (standard === 'below'
    ? t('Reps that did not count: {0}. The shoulders did not get below the elbows.', n)
    : t('Reps that did not count: {0}. The shoulders stayed above the elbows.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  deeper: () => t('Most reps stopped above elbow height. Try going a little deeper.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps were shallower than the first ones.'),
  steady: () => t('Depth and tempo held steady across the set.'),
}

/**
 * Of every rep whose depth was seen, no-reps included, how many reached the depth a result talks
 * about: below the elbows under 'below', elbow height or lower otherwise. { hit, of, depth }.
 */
export function dropDepthShare(reps, standard) {
  const list = (Array.isArray(reps) ? reps : []).filter(r => r.measures && r.measures.depth)
  const depth = standard === 'below' ? 'below' : 'level'
  const hit = list.filter(r => r.measures.depth === 'below' || (depth === 'level' && r.measures.depth === 'level')).length
  return { hit, of: list.length, depth }
}

/**
 * The arm-drop tracker. `drill` is the drill definition (views); `spec` holds what differs:
 *   framing(frame) -> reason | null, viewDetector() -> { push(frame, atTop), view }
 *   startHint(), readyHint(): translated status lines; notes: { side, diagonal, front } -> string
 *   side: optional { track(acc, frame, sidePick), finish(acc, measures), summary(m) -> {}, cues: [[id, (summary, n) => bool, () => text]],
 *         tile(summary) -> tile | null, rows(measures) -> rows }   (side-on extras)
 */
export function createArmDropTracker(drill, spec, { standard, view: fixedView } = {}) {
  const std = DROP_STANDARDS.some(s => s.id === standard) ? standard : 'level'
  const machine = createPhaseMachine(DROP_PHASES)
  const views = spec.viewDetector()
  const side = createSidePicker(ARM)
  const extra = spec.side || null
  const reps = []
  let armRef = null, upperRef = null, elbowRow = null, roll = null, lastS = null, acc = null

  const viewNow = () => fixedView || views.view
  const level = () => (elbowRow == null ? null : Math.abs(elbowRow - 0.5) <= DROP_LEVEL_ROW && Math.abs(roll) <= DROP_LEVEL_ROLL)
  // A view the drill cannot judge: refused. Off the side with the phone not at elbow height and
  // level, the reps are counted and timed (the drop is the shoulder's against the arm's own length)
  // but the depth, the shoulder against the elbow, is not judged.
  const supported = v => !v || drill.views.includes(v)
  const judged = v => v != null && (v === 'side' || level() !== false)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.rec.rawPeak >= DROP_PHASES.minRep && dropMeets(acc.judged ? dropDepthOf(acc.maxHd) : null, std)

  // The arm's image-vertical facts, null without shoulder, elbow and wrist under them.
  function figure(joints) {
    const sh = mid(joints, 'Shoulder'), el = mid(joints, 'Elbow'), wr = mid(joints, 'Wrist')
    if (!sh || !el || !wr) return null
    const arm = wr[1] - sh[1], upper = el[1] - sh[1], fore = wr[1] - el[1]
    if (!(fore > 0) || !(arm > 0)) return null
    return { sh, el, wr, arm, upper, straight: upper > 0 && upper / fore >= DROP_STRAIGHT }
  }

  function readTop(frame, f) {
    armRef = armRef == null || f.arm > armRef * 1.1 ? f.arm : ema(armRef, f.arm, 0.15)
    upperRef = upperRef == null ? f.upper : ema(upperRef, f.upper, 0.15)
    if (!fixedView) views.push(frame, true)
    elbowRow = ema(elbowRow, f.el[1], 0.2)
    roll = ema(roll, deg(Math.atan2((f.wr[0] - f.sh[0]) * frame.aspect, f.wr[1] - f.sh[1])), 0.2)
  }

  function track(frame, f) {
    const a = acc
    if (f.hd != null && (a.maxHd == null || f.hd > a.maxHd)) a.maxHd = f.hd
    if (a.view !== 'side') return
    const sd = side(frame.joints)
    const k = angleAt(seen(frame.joints, sd + 'Shoulder'), seen(frame.joints, sd + 'Elbow'), seen(frame.joints, sd + 'Wrist'), frame.aspect)
    if (k != null && (a.minElbow == null || k < a.minElbow)) a.minElbow = k
    if (extra) extra.track(a, frame, sd)
  }

  function finish(rec) {
    const a = acc
    const depth = a.judged ? dropDepthOf(a.maxHd) : null
    const counted = rec.lost || dropMeets(depth, std)
    const measures = { view: a.view, depth, shoulderDepth: a.judged && a.maxHd != null ? Math.round(a.maxHd * 100) / 100 : null, peak: Math.round(rec.peak * 100) / 100 }
    if (a.view === 'side') {
      measures.minElbow = a.minElbow == null ? null : Math.round(a.minElbow)
      if (extra) extra.finish(a, measures)
    }
    reps.push({ rec, counted, reason: counted ? null : 'shallow', measures })
    acc = null
    return counted
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, drill.views)
    if (vh) return vh
    if ((phase === 'waiting' || phase === 'standing') && v && v !== 'side' && level() === false) return t('Put the phone at elbow height and level')
    if (phase === 'waiting') return spec.startHint()
    return count() ? '' : spec.readyHint()
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: aspectOf(frame), joints }
    const why = spec.framing(fr)
    const f = figure(joints)
    const phase0 = machine.phase
    if (f && f.straight && (phase0 === 'waiting' || phase0 === 'standing') && (lastS == null || lastS < DROP_TOP_S)) readTop(fr, f)
    let s = f && armRef ? (armRef - f.arm) / armRef / DROP_FULL : null
    if (f && upperRef > 0) f.hd = (f.sh[1] - f.el[1]) / upperRef
    if (s != null) lastS = s
    if (!supported(viewNow())) s = null
    const ev = machine.push(at, s, { canStart: !!f && f.straight && supported(viewNow()) })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: judged(v), maxHd: null, minElbow: null, extra: {} }
      }
      if (f && s != null) track(fr, f)
      if (ev.ended) {
        if (finish(ev.rep)) justCounted = true
        else { justMissed = true; reason = 'shallow' }
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftShoulder', 'rightShoulder'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => ({ counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, ...tempo(r.rec) } }))
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const consistency = spread(m.map(x => x.minElbow))
    const summary = {
      count: n,
      missed,
      depthBelow: m.filter(x => x.depth === 'below').length,
      depthLevel: m.filter(x => x.depth === 'level').length,
      depthAbove: m.filter(x => x.depth === 'above').length,
      avgDown: avg('downSec'),
      avgUp: avg('upSec'),
      // The spread of the bottom elbow angle across the set, in degrees (side-on only).
      consistency: consistency == null ? null : Math.round(consistency),
      ...(extra ? extra.summary(m) : {}),
    }
    const extraCues = extra ? extra.cues : []
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['deeper', () => summary.depthAbove * 2 > n],
      ...extraCues.map(([id, test]) => [id, () => test(summary, n)]),
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.peak), FADE_S)],
      ['steady', () => true],
    ])
    const extraCue = extraCues.find(c => c[0] === cueId)
    const seenViews = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n,
      missed,
      reps: list,
      tiles: dropTiles(list, summary, std, extra),
      cue: extraCue ? extraCue[2]() : DROP_CUE[cueId](missed, std),
      cueId,
      details: list.map(r => dropDetails(r, extra)),
      note: seenViews.length === 1 && spec.notes[seenViews[0]] ? spec.notes[seenViews[0]]() : '',
      summary,
      standard: std,
      view: viewNow(),
    }
  }

  return { push, result }
}

// Depth over every judged rep, the counted reps' tempo, and side-on the drill's own tile or the
// spread of the bottom elbow angle.
function dropTiles(list, s, std, extra) {
  const out = []
  const share = dropDepthShare(list, std)
  if (share.of) out.push({ id: 'depth', label: t('Depth'), value: t('{0} of {1}', share.hit, share.of), sub: share.depth === 'below' ? t('shoulders below the elbows') : t('shoulders to the elbows or lower') })
  if (s.avgDown != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgDown), fmt(s.avgUp)), sub: t('down / up, on average') })
  const own = extra && extra.tile ? extra.tile(s) : null
  if (own) out.push(own)
  else if (s.consistency != null) out.push({ id: 'consistency', label: t('Consistency'), value: s.consistency + '°', sub: t('spread at the bottom') })
  return out
}

function dropDetails(r, extra) {
  const m = r.measures
  const rows = [
    { label: t('Depth'), value: dropDepthText(m.depth) },
    { label: t('Tempo'), value: t('Down {0} s · up {1} s', fmt(m.downSec), fmt(m.upSec)) },
  ]
  if (m.minElbow != null) rows.push({ label: t('Elbow angle'), value: m.minElbow + '°' })
  if (extra && m.view === 'side') rows.push(...extra.rows(m))
  return rows
}

// --- The lockout: overhead press and pushdown ------------------------------------------------------

export const LOCK_DEG = 160           // the elbow, smoothed, at least this at its straightest: locked out
export const BOTH_CONF = 0.45         // both arms seen at least this surely: the more bent one is read
export const LOCK_STANDARDS = [
  { id: 'lockout', label: 'Full lockout' },
  { id: 'any', label: 'Any range' },
]
export const SOFT_MISS = { soft: { line: 'Arms not locked out. Not counted.', say: 'Lock out', row: 'Not counted: not locked out' } }

/** Whether a rep's lockout meets a standard; a lockout not seen is given the rep. */
export const lockMeets = (locked, standard) => standard === 'any' || locked == null || locked

/** The elbow angle a frame shows: the more bent arm when both are seen surely, else the picked side's. */
export function elbowAngle(frame, sidePicked) {
  const j = frame.joints
  const at = s => angleAt(seen(j, s + 'Shoulder'), seen(j, s + 'Elbow'), seen(j, s + 'Wrist'), frame.aspect)
  const sure = s => ARM.every(p => (seen(j, s + p) || [0, 0, 0])[2] >= BOTH_CONF)
  if (sure('left') && sure('right')) {
    const l = at('left'), r = at('right')
    if (l != null && r != null) return Math.min(l, r)
  }
  return at(sidePicked)
}

const LOCK_CUE = {
  missed: n => t('Reps that did not count: {0}. The elbows did not lock out.', n),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  soft: () => t('Most reps stopped short of lockout. Try straightening the elbows fully.'),
  steady: () => t('Lockout and tempo held steady across the set.'),
}

/**
 * The lockout tracker. `spec` holds what differs:
 *   signal(f, torsoRef) -> number | null (0 at the start, about 1 at lockout), phases, topS
 *   lockViews: the views the lockout is judged from; unjudgedCue: () => text
 *   startHint(), readyHint(): translated status lines; tempoRow(down, up), tempoSub(): translated text
 *   lockSub(): the lockout tile's sub; notes: { view: () => text }
 *   side: optional extras as for createArmDropTracker
 */
export function createLockoutTracker(drill, spec, viewDetector, { standard, view: fixedView } = {}) {
  const std = LOCK_STANDARDS.some(s => s.id === standard) ? standard : 'lockout'
  const P = spec.phases
  const machine = createPhaseMachine(P)
  const views = viewDetector()
  const side = createSidePicker(ARM)
  const extra = spec.side || null
  const reps = []
  let torsoRef = null, lastS = null, acc = null

  const viewNow = () => fixedView || views.view
  const supported = v => !v || drill.views.includes(v)
  const judged = v => v != null && spec.lockViews.includes(v)
  const count = () => reps.filter(r => r.counted).length
  const lockedOf = a => (a.judged && a.maxAng != null ? a.maxAng >= LOCK_DEG : null)
  const reachedNow = () => !!acc && acc.rec.rawPeak >= P.minRep && lockMeets(lockedOf(acc), std)

  function figure(joints) {
    const sh = mid(joints, 'Shoulder'), el = mid(joints, 'Elbow'), wr = mid(joints, 'Wrist'), hip = mid(joints, 'Hip')
    if (!sh || !el || !wr || !hip) return null
    const torso = hip[1] - sh[1]
    return torso > 0 ? { sh, el, wr, hip, torso } : null
  }

  function track(frame, f) {
    const a = acc
    const sd = side(frame.joints)
    if (a.judged) {
      const ang = elbowAngle(frame, sd)
      if (ang != null) {
        a.ang = ema(a.ang, ang, 0.5)
        if (a.maxAng == null || a.ang > a.maxAng) a.maxAng = a.ang
      }
    }
    if (extra && a.view === 'side') extra.track(a, frame, sd, f)
  }

  function finish(rec) {
    const a = acc
    const locked = lockedOf(a)
    const counted = rec.lost || lockMeets(locked, std)
    const measures = { view: a.view, locked, elbow: a.judged && a.maxAng != null ? Math.round(a.maxAng) : null, peak: Math.round(rec.peak * 100) / 100 }
    if (extra && a.view === 'side') extra.finish(a, measures)
    reps.push({ rec, counted, reason: counted ? null : 'soft', measures })
    acc = null
    return counted
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const vh = viewHint(viewNow(), drill.views)
    if (vh) return vh
    if (phase === 'waiting') return spec.startHint()
    return count() ? '' : spec.readyHint()
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: aspectOf(frame), joints }
    const why = spec.framing(fr)
    const f = figure(joints)
    const phase0 = machine.phase
    const atTop = (phase0 === 'waiting' || phase0 === 'standing') && (lastS == null || lastS < spec.topS)
    if (f && atTop) {
      torsoRef = ema(torsoRef, f.torso, 0.15)
      if (!fixedView) views.push(fr, true)
    }
    let s = f && torsoRef ? spec.signal(f, torsoRef) : null
    if (s != null) lastS = s
    if (!supported(viewNow())) s = null
    const ev = machine.push(at, s, { canStart: !!f && supported(viewNow()) })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: judged(v), ang: null, maxAng: null, extra: {} }
      }
      if (f && s != null) track(fr, f)
      if (ev.ended) {
        if (finish(ev.rep)) justCounted = true
        else { justMissed = true; reason = 'soft' }
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftElbow', 'rightElbow'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => ({ counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, ...tempo(r.rec) } }))
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const summary = {
      count: n,
      missed,
      lockedOut: m.filter(x => x.locked === true).length,
      softOut: m.filter(x => x.locked === false).length,
      avgDown: avg('downSec'),
      avgUp: avg('upSec'),
      ...(extra ? extra.summary(m) : {}),
    }
    const unjudged = m.filter(x => x.locked == null && x.view != null).length
    const extraCues = extra ? extra.cues : []
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['unjudged', () => unjudged * 2 > n],
      ['soft', () => summary.softOut * 2 > n],
      ...extraCues.map(([id, test]) => [id, () => test(summary, n)]),
      ['steady', () => true],
    ])
    const extraCue = extraCues.find(c => c[0] === cueId)
    const cue = extraCue ? extraCue[2]() : cueId === 'unjudged' ? spec.unjudgedCue() : LOCK_CUE[cueId](missed)
    const seenViews = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n,
      missed,
      reps: list,
      tiles: lockTiles(list, summary, spec, extra),
      cue,
      cueId,
      details: list.map(r => lockDetails(r, spec, extra)),
      note: seenViews.length === 1 && spec.notes[seenViews[0]] ? spec.notes[seenViews[0]]() : '',
      summary,
      standard: std,
      view: viewNow(),
    }
  }

  return { push, result }
}

function lockTiles(list, s, spec, extra) {
  const out = []
  const judgedReps = list.filter(r => r.measures.locked != null)
  if (judgedReps.length) {
    const hit = judgedReps.filter(r => r.measures.locked).length
    out.push({ id: 'lockout', label: t('Lockout'), value: t('{0} of {1}', hit, judgedReps.length), sub: spec.lockSub() })
  }
  if (s.avgDown != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgDown), fmt(s.avgUp)), sub: spec.tempoSub() })
  const own = extra && extra.tile ? extra.tile(s) : null
  if (own) out.push(own)
  return out
}

function lockDetails(r, spec, extra) {
  const m = r.measures
  const rows = [
    { label: t('Lockout'), value: m.locked == null ? t('Not seen') : m.locked ? t('Locked out') : t('Not locked out') },
    { label: t('Tempo'), value: spec.tempoRow(fmt(m.downSec), fmt(m.upSec)) },
  ]
  if (m.elbow != null) rows.push({ label: t('Elbow angle'), value: m.elbow + '°' })
  if (extra && m.view === 'side') rows.push(...extra.rows(m))
  return rows
}
