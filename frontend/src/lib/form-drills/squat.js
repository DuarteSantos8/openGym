// The squat (README.md): reps, depth and tempo from any camera angle, plus what each view can
// really show: torso lean and the knee angle side-on, the knees caving in and the hips shifting
// sideways from the front. It measures, it never grades.
//
// Counting and depth read only image-vertical things, which turning about the vertical axis
// (yaw) leaves alone:
//   - how far into the rep: the hip's drop from its standing height, over the standing leg
//     (hip to ankle), over DEPTH_FULL (about the drop at parallel), so 0 at the top and about 1
//     at parallel whatever the view;
//   - depth: the hip's height against the knee's, in standing thigh lengths (positive below).
//     Vision's hip is not the hip crease: it sits on the pelvis, and at the bottom of a squat about
//     HIP_MARK thigh lengths above the crease (side-on, a squat with the crease level with the top of
//     the knee reads the hip 0.2 above the knee, a half squat 0.6), so that is added first. Side-on
//     it is read on the leg nearer the camera: Vision guesses the far one, hidden behind it, and a
//     far knee put halfway up the thigh would make a shallow squat look deep.
// Where this breaks: perspective. Facing the camera the knees come towards it at the bottom and
// the hips go away, so a camera above or below them makes the knees look lower or higher than
// they are (about 0.2 thigh lengths with the phone at standing hip height, more than the parallel
// band). With the phone at knee height and level the bottom of the squat is on the optical axis
// and the error is gone. So outside a side view depth is judged only when the standing knees sit
// near the middle row of the image and the body stands upright in it (LEVEL_ROW, LEVEL_ROLL);
// otherwise the status line asks for it and the rep's depth is "not seen" (it counts). Side-on,
// hip and knee are at the same distance from the camera and its height does not matter.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createSidePicker, createViewDetector, deg, ema, fades, framing,
  framingHint, matchExercise, mean, mid, pickCue, round1, seen, spread, tempo, viewHint,
} from './kit.js'

export const DEPTH_FULL = 0.55        // the hip's drop at parallel, in standing legs: the signal's 1
export const STRAIGHT = 0.9           // thigh over shin (image-vertical) at least this: standing tall
export const TOP_S = 0.06             // signal under this: at the top, where the standing figure is read
export const PARALLEL_BAND = 0.1      // hip within this many thigh lengths of the knee: parallel
export const HIP_MARK = 0.2           // Vision's hip above the hip crease at the bottom, in standing thigh lengths
export const LEVEL_ROW = 0.12         // standing knees at most this far from the middle row: camera at knee height
export const LEVEL_ROLL = 10          // degrees the standing body may lean in the image: camera upright
export const FAST_DOWN_SEC = 1        // an average way down under this: "slow the way down"
export const FADE_S = 0.17            // last reps' depth this much under the first ones' (about 12° at the knee)
export const KNEES_IN = 0.9           // knee gap under this share of the ankle gap at the bottom: knees in
export const SHIFT_SHARE = 0.2        // hips this share of the stance off the feet's middle: shifted
export const PHASES = { stand: 0.06, descent: 0.1, minRep: 0.25, bottomEps: 0.04, ascentRise: 0.15, topBand: 0.012 }
const CHAIN = ['Hip', 'Knee', 'Ankle']

// The squats Form check is offered for: a few by id, and any two-legged squat by its name. One leg
// at a time (split, pistol, skater), jumps, holds and combinations (squat to press, squat row) are
// left out: the rep is not a single bend and stand of both knees.
const IDS = new Set(['3593', '2966', '0043'])
const NOT_A_PLAIN_SQUAT = /split|single leg|one leg|pistol|skater|cossack|curtsey|side squat|jump|hold|row|curl|press|punch|chin up|sissy|wall|lunge|calf|form check|knees|kneeling|deadlift|pallof|twist|chop/i

const STANDARDS = [
  { id: 'parallel', label: 'Parallel' },
  { id: 'below', label: 'Below parallel' },
  { id: 'any', label: 'Any depth' },
]

/** The depth's name from the hip's height against the knee (thigh lengths, positive below). */
export const depthOf = hd => (hd == null ? null : hd > PARALLEL_BAND ? 'below' : hd < -PARALLEL_BAND ? 'above' : 'parallel')

// parallel: the hip came to knee height, within PARALLEL_BAND; below: clearly under it; any: every
// real descent. A depth not seen (no hip or knee at the bottom, or a view it cannot judge) is given the rep.
export const meets = (depth, standard) => standard === 'any' || depth == null || (standard === 'below' ? depth === 'below' : depth !== 'above')

const DEPTH_TEXT = { below: () => t('Below parallel'), parallel: () => t('Parallel'), above: () => t('Above parallel') }
const depthText = d => (DEPTH_TEXT[d] ? DEPTH_TEXT[d]() : t('Depth not seen'))

/** The one sentence a result ends with, by its id. Functions, so they read the language at call time. */
export const CUE = {
  missed: (n, standard) => (standard === 'below'
    ? t('Reps that did not count: {0}. The hip did not get below the knee.', n)
    : t('Reps that did not count: {0}. The hip stayed above the knee.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  level: () => t('Depth could not be judged from this angle. Put the phone at knee height and level, or film from the side.'),
  deeper: () => t('Most reps stopped above parallel. Try sitting a little deeper.'),
  knees: () => t('The knees came inside the ankles at the bottom of most reps. Try pushing them out over the toes.'),
  shiftLeft: () => t('The hips drifted to your left at the bottom of most reps. Try keeping your weight even on both feet.'),
  shiftRight: () => t('The hips drifted to your right at the bottom of most reps. Try keeping your weight even on both feet.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps were shallower than the first ones.'),
  steady: () => t('Depth and tempo held steady across the set.'),
}

const VIEW_NOTE = {
  side: () => t('Filmed from the side: depth, tempo, knee angle and torso lean.'),
  front: () => t('Filmed from the front: depth, tempo, knees and hips.'),
  diagonal: () => t('Filmed at an angle: depth and tempo only.'),
}

// The torso's angle from vertical (shoulder over hip) on one side, the other shoulder standing in.
function torsoLean(joints, side, aspect) {
  const s = seen(joints, side + 'Shoulder') || seen(joints, (side === 'left' ? 'right' : 'left') + 'Shoulder')
  const h = seen(joints, side + 'Hip')
  if (!s || !h) return null
  return deg(Math.atan2(Math.abs((s[0] - h[0]) * aspect), Math.abs(s[1] - h[1])))
}

// Facing the camera, at one frame: the knee gap over the ankle gap, and the hips' sideways
// offset from the feet's middle over the ankle gap, positive towards the lifter's left.
function frontMeasures(joints) {
  const lk = seen(joints, 'leftKnee'), rk = seen(joints, 'rightKnee')
  const la = seen(joints, 'leftAnkle'), ra = seen(joints, 'rightAnkle')
  const lh = seen(joints, 'leftHip'), rh = seen(joints, 'rightHip')
  if (!la || !ra) return null
  const stance = la[0] - ra[0]
  if (Math.abs(stance) < 1e-3) return null
  return {
    knees: lk && rk ? Math.abs(lk[0] - rk[0]) / Math.abs(stance) : null,
    shift: lh && rh ? (((lh[0] + rh[0]) / 2) - ((la[0] + ra[0]) / 2)) / stance : null,
  }
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'parallel'
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector()
  const side = createSidePicker(CHAIN)
  const reps = []                 // { rec, acc, counted, reason }
  let legRef = null
  const thighRef = { mid: null, left: null, right: null }   // standing thigh, both legs' middle and each leg
  let levelRow = null, levelRoll = null
  let lastS = null
  let acc = null                  // the rep under way's measures

  const viewNow = () => fixedView || views.view
  const level = () => (levelRow == null ? null : Math.abs(levelRow - 0.5) <= LEVEL_ROW && Math.abs(levelRoll) <= LEVEL_ROLL)
  const judged = v => v === 'side' || (v != null && level() === true)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.rec.rawPeak >= PHASES.minRep && meets(acc.judged ? depthOf(acc.maxHd) : null, std)

  function track(frame, f, s) {
    const a = acc
    const aspect = frame.aspect > 0 ? frame.aspect : 1
    if (f.hd != null && (a.maxHd == null || f.hd > a.maxHd)) a.maxHd = f.hd
    if (a.view === 'side') {
      const sd = f.side
      const k = angleAt(seen(frame.joints, sd + 'Hip'), seen(frame.joints, sd + 'Knee'), seen(frame.joints, sd + 'Ankle'), aspect)
      if (k != null && (a.minKnee == null || k < a.minKnee)) a.minKnee = k
      const l = torsoLean(frame.joints, sd, aspect)
      if (l != null && (a.lean == null || l > a.lean)) a.lean = l
    } else if (a.view === 'front') {
      const m = frontMeasures(frame.joints)
      if (m && s != null) a.front.push([s, m.knees, m.shift])
    }
  }

  function finish(rec) {
    const a = acc
    const depth = a.judged ? depthOf(a.maxHd) : null
    const counted = rec.lost || meets(depth, std)
    const measures = { view: a.view, depth, hipDepth: a.judged && a.maxHd != null ? Math.round(a.maxHd * 100) / 100 : null, peak: Math.round(rec.peak * 100) / 100 }
    if (a.view === 'side') {
      measures.minKnee = a.minKnee == null ? null : Math.round(a.minKnee)
      measures.lean = a.lean == null ? null : Math.round(a.lean)
    }
    if (a.view === 'front') {
      // At the bottom: the frames within a little of the deepest one.
      const low = a.front.filter(([s]) => s >= rec.peak - 0.1)
      const kn = low.map(x => x[1]).filter(x => x != null), sh = low.map(x => x[2]).filter(x => x != null)
      measures.kneeRatio = kn.length ? Math.round(mean(kn) * 100) / 100 : null
      measures.knees = kn.length ? (mean(kn) < KNEES_IN ? 'in' : 'out') : null
      const shift = sh.length ? mean(sh) : null
      measures.shiftShare = shift == null ? null : Math.round(shift * 100) / 100
      measures.shift = shift == null || Math.abs(shift) < SHIFT_SHARE ? null : shift > 0 ? 'left' : 'right'
    }
    reps.push({ rec, counted, reason: counted ? null : 'shallow', measures })
    acc = null
    return counted
  }

  // The figure's image-vertical facts, null without hip, knee and ankle. `thighs`: each leg's
  // thigh where its hip and knee are seen, for the depth side-on.
  function figure(joints) {
    const hip = mid(joints, 'Hip'), knee = mid(joints, 'Knee'), ankle = mid(joints, 'Ankle')
    if (!hip || !knee || !ankle) return null
    const leg = ankle[1] - hip[1], thigh = knee[1] - hip[1], shin = ankle[1] - knee[1]
    if (!(leg > 0) || !(shin > 0)) return null
    const thighs = {}
    for (const sd of ['left', 'right']) {
      const h = seen(joints, sd + 'Hip'), k = seen(joints, sd + 'Knee')
      if (h && k && k[1] - h[1] > 0) thighs[sd] = { hip: h, knee: k, thigh: k[1] - h[1] }
    }
    return { hip, knee, ankle, leg, thigh, thighs, straight: thigh / shin >= STRAIGHT }
  }

  // The hip's height against the knee in standing thigh lengths, positive below, Vision's hip
  // mark taken off: side-on on the nearer leg (both legs' middle when its standing thigh is not
  // known yet), otherwise on both legs' middle. null before a standing thigh was read.
  function hipDepth(f, sd, sideOn) {
    const own = sideOn && f.thighs[sd] && thighRef[sd] > 0 ? f.thighs[sd] : null
    const ref = own ? thighRef[sd] : thighRef.mid
    if (!(ref > 0)) return null
    const hip = own ? own.hip : f.hip, knee = own ? own.knee : f.knee
    return (hip[1] - knee[1]) / ref + HIP_MARK
  }

  // Standing tall at the top: the leg and thigh it is measured against, the view, the camera.
  // The leg leans to the longer readings, so the first frames of a slow descent, still under
  // TOP_S, do not shorten it: a quarter squat that starts slowly would read as a wobble.
  function readStanding(frame, f) {
    legRef = legRef == null || f.leg > legRef * 1.1 ? f.leg : ema(legRef, f.leg, f.leg > legRef ? 0.15 : 0.05)
    thighRef.mid = ema(thighRef.mid, f.thigh, 0.15)
    for (const sd of ['left', 'right']) if (f.thighs[sd]) thighRef[sd] = ema(thighRef[sd], f.thighs[sd].thigh, 0.15)
    if (!fixedView) views.push(frame, true)
    const sh = mid(frame.joints, 'Shoulder')
    const aspect = frame.aspect > 0 ? frame.aspect : 1
    levelRow = ema(levelRow, f.knee[1], 0.2)
    if (sh) levelRoll = ema(levelRoll, deg(Math.atan2((sh[0] - f.ankle[0]) * aspect, f.ankle[1] - sh[1])), 0.2)
    else if (levelRoll == null) levelRoll = 0
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, squat.views)
    if (vh) return vh
    if ((phase === 'waiting' || phase === 'standing') && v && v !== 'side' && level() === false) return t('Put the phone at knee height and level')
    if (phase === 'waiting') return t('Stand tall to start')
    return count() ? '' : t('Ready. Squat when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const f = figure(joints)
    const phase0 = machine.phase
    if (f && f.straight && (phase0 === 'waiting' || phase0 === 'standing') && (lastS == null || lastS < TOP_S)) readStanding(fr, f)
    const s = f && legRef ? (legRef - f.leg) / legRef / DEPTH_FULL : null
    if (f) {
      f.side = side(joints)
      f.hd = hipDepth(f, f.side, viewNow() === 'side')
    }
    if (s != null) lastS = s
    const ev = machine.push(at, s, { canStart: !!f && f.straight })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: judged(v), maxHd: null, minKnee: null, lean: null, front: [] }
      }
      if (f) track(fr, f, s)
      if (ev.ended) {
        if (finish(ev.rep)) justCounted = true
        else { justMissed = true; reason = 'shallow' }
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftHip', 'rightHip'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => ({ counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, ...tempo(r.rec) } }))
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const front = m.filter(x => x.view === 'front' && x.knees)
    const shifted = dir => m.filter(x => x.shift === dir).length
    const unjudged = m.filter(x => x.view !== 'side' && x.depth == null && x.view != null).length
    const summary = {
      count: n,
      missed,
      depthBelow: m.filter(x => x.depth === 'below').length,
      depthParallel: m.filter(x => x.depth === 'parallel').length,
      depthAbove: m.filter(x => x.depth === 'above').length,
      avgDown: avg('downSec'),
      avgUp: avg('upSec'),
      maxLean: m.some(x => x.lean != null) ? Math.max(...m.map(x => x.lean).filter(x => x != null)) : null,
      // The spread of the bottom knee angle across the set, in degrees (side-on only).
      consistency: spread(m.map(x => x.minKnee)),
      kneesIn: front.filter(x => x.knees === 'in').length,
      kneesOf: front.length,
      shiftLeft: shifted('left'),
      shiftRight: shifted('right'),
    }
    if (summary.consistency != null) summary.consistency = Math.round(summary.consistency)
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['level', () => unjudged * 2 > n],
      ['deeper', () => summary.depthAbove * 2 > n],
      ['knees', () => summary.kneesIn * 2 > n],
      ['shiftLeft', () => summary.shiftLeft * 2 > n],
      ['shiftRight', () => summary.shiftRight * 2 > n],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.peak), FADE_S)],
      ['steady', () => true],
    ])
    const views = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n,
      missed,
      reps: list,
      tiles: tiles(list, summary, std),
      cue: CUE[cueId](missed, std),
      cueId,
      details: list.map(details),
      note: views.length === 1 ? VIEW_NOTE[views[0]]() : '',
      summary,
      standard: std,
      view: viewNow(),
    }
  }

  return { push, result }
}

/**
 * Of every rep whose depth was seen, no-reps included, how many reached the depth a result talks
 * about: below parallel under 'below', parallel or deeper otherwise. { hit, of, depth }.
 */
export function depthShare(reps, standard) {
  const list = (Array.isArray(reps) ? reps : []).filter(r => r.measures && r.measures.depth)
  const depth = standard === 'below' ? 'below' : 'parallel'
  const hit = list.filter(r => r.measures.depth === 'below' || (depth === 'parallel' && r.measures.depth === 'parallel')).length
  return { hit, of: list.length, depth }
}

// The two or three headline figures: how deep every rep went, the counted reps' tempo, and what
// the view adds: side-on the spread of the bottom knee angle (or the most lean when one rep has
// no spread), from the front how many reps the knees came in.
function tiles(list, s, std) {
  const out = []
  const share = depthShare(list, std)
  if (share.of) out.push({ id: 'depth', label: t('Depth'), value: t('{0} of {1}', share.hit, share.of), sub: share.depth === 'below' ? t('below parallel') : t('at parallel or deeper') })
  if (s.avgDown != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgDown), fmt(s.avgUp)), sub: t('down / up, on average') })
  if (s.consistency != null) out.push({ id: 'consistency', label: t('Consistency'), value: s.consistency + '°', sub: t('spread at the bottom') })
  else if (s.maxLean != null) out.push({ id: 'lean', label: t('Lean'), value: s.maxLean + '°', sub: t('torso lean at most') })
  else if (s.kneesOf) out.push({ id: 'knees', label: t('Knees'), value: t('{0} of {1}', s.kneesIn, s.kneesOf), sub: t('came inside the ankles') })
  return out
}

// One rep's rows for "Every rep".
function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Depth'), value: depthText(m.depth) },
    { label: t('Tempo'), value: t('Down {0} s · up {1} s', fmt(m.downSec), fmt(m.upSec)) },
  ]
  if (m.minKnee != null) rows.push({ label: t('Knee angle'), value: m.minKnee + '°' })
  if (m.lean != null) rows.push({ label: t('Lean'), value: m.lean + '°' })
  if (m.knees) rows.push({ label: t('Knees'), value: m.knees === 'in' ? t('Inside the ankles') : t('Over the feet') })
  if (m.view === 'front' && m.shiftShare != null) {
    rows.push({ label: t('Hips'), value: m.shift === 'left' ? t('Shifted to your left') : m.shift === 'right' ? t('Shifted to your right') : t('Centred over the feet') })
  }
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const squat = {
  id: 'squat',
  name: 'Squat',
  kind: 'reps',
  views: ['side', 'front', 'diagonal'],
  setup: 'Phone at knee height and level, 2 to 3 m away, your whole body in the frame. Side-on it also measures the torso lean; from the front, the knees and the hips.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bsquat/i, not: NOT_A_PLAIN_SQUAT, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS,
  defaultStandard: 'parallel',
  misses: { shallow: { line: 'Too shallow. Not counted.', say: 'Too shallow', row: 'Not counted: too shallow' } },
  create,
}

export default squat
