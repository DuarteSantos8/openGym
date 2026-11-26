// The side lunge, the side squat and the Cossack squat (README.md): reps on either leg, depth,
// tempo, and the other leg staying straight, filmed from the front. It measures, it never grades.
//
// Feet wide, the hips sit down and sideways over one bending knee while the other leg stays long.
// From the front that all happens in the plane the camera sees:
//   - how far into the rep: the hips' drop from standing over the standing leg (floor to hips),
//     image-vertical, over DEPTH_FULL;
//   - the working leg: the one bent more at the knee in the image (the other stays near 180);
//   - depth: the hips' height against the working knee's, in standing thigh heights (positive
//     below), as for the squat; the other leg's knee angle in the image for the trailing leg.
// Vision's hip sits on the pelvis above the crease, as for the squat, so HIP_MARK is added before
// the hips are compared with the knee (a real lunge with the hip at knee height read -0.1 to -0.23).
// Side-on the two legs stack up and the working one cannot be told: not judged. At an angle it
// counts as facing: the drop is image-vertical, and a slender lifter squarely facing the camera
// reads as an angle (shoulder and hip width 0.49 to 0.51 of the torso, under kit's 0.53). Facing the camera
// the working knee comes forward at the bottom, so, as for the squat, a camera far above or below
// the knees misjudges the depth: it is judged only with the phone at knee height and level.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createViewDetector, deg, ema, fades, framing, framingHint, matchExercise, mean,
  mid, pickCue, round1, seen, tempo, viewHint,
} from './kit.js'

export const DEPTH_FULL = 0.5         // the hips' drop at depth, in standing legs: the signal's 1
export const STRAIGHT_DEG = 165       // both knees at least this in the image: standing tall
export const PARALLEL_BAND = 0.1      // hips within this many thigh heights above the working knee: parallel
export const HIP_MARK = 0.2           // Vision's hip above the hip crease at the bottom, in standing thigh heights (as the squat's)
export const HALF_DEPTH = 0.5         // hips within this many thigh heights above it: halfway down
export const TRAIL_DEG = 160          // the other knee under this at the bottom: bent
export const LEVEL_ROW = 0.12         // standing knees at most this far from the middle row: camera at knee height
export const LEVEL_ROLL = 10          // degrees the standing body may lean in the image: camera upright
export const FAST_DOWN_SEC = 1
export const FADE_S = 0.15
export const PHASES = { stand: 0.08, descent: 0.14, minRep: 0.25, bottomEps: 0.04, ascentRise: 0.15, topBand: 0.03 }
const CHAIN = ['Hip', 'Knee', 'Ankle']
const SIDES = ['left', 'right']

// Side and lateral lunges, side squats and Cossack squats, bodyweight or with a weight held in
// the hands (a bar on the back is kept: the legs, which the drill reads, stay in view). Left out:
// jumping, walking, stepping and elevated lunges, cables, bands, landmines, the suspension trainer,
// weights overhead, combinations with the arms, kneeling versions and stretches.
const IDS = new Set(['2972', '4789', '2569', '1215', '3448', '4853', '4045', '4098', '4754', '4732', '4562', '6193', '3643', '1410'])
const NOT_A_PLAIN_LUNGE = /jump|walk|step|elevated|kneel|cable|band|landmine|overhead|curl|press|stretch|plyo|roll|suspen|rope|machine|smith|split|form check/i

const STANDARDS = [
  { id: 'parallel', label: 'Parallel' },
  { id: 'half', label: 'Halfway down' },
  { id: 'any', label: 'Any depth' },
]

/** The depth's name from the hips' height against the working knee (thigh heights, positive below). */
export const depthOf = hd => (hd == null ? null : hd >= -PARALLEL_BAND ? 'parallel' : hd >= -HALF_DEPTH ? 'half' : 'above')

/** Whether a depth meets a standard; a depth not seen is given the rep. */
export const meets = (depth, standard) => standard === 'any' || depth == null || depth === 'parallel' || (standard === 'half' && depth === 'half')

const DEPTH_TEXT = { parallel: () => t('Parallel'), half: () => t('Halfway down'), above: () => t('Above parallel') }
const depthText = d => (DEPTH_TEXT[d] ? DEPTH_TEXT[d]() : t('Depth not seen'))

const CUE = {
  missed: (n, standard) => (standard === 'half'
    ? t('Reps that did not count: {0}. The hip did not get halfway down to the knee.', n)
    : t('Reps that did not count: {0}. The hip did not get down to the knee.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  level: () => t('Depth could not be judged from this angle. Put the phone at knee height and level, facing you.'),
  trail: () => t('The other leg bent on most reps. Try keeping it straight as you sit into the side.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps were shallower than the first ones.'),
  steady: () => t('Depth and tempo held steady across the set.'),
}

// One frame: the hips' middle and their height over the floor (the lower ankle), and when both
// legs are seen whole, each knee's image angle and which leg works; null without hips or an ankle.
function figure(joints, aspect) {
  const hip = mid(joints, 'Hip')
  const ankles = SIDES.map(s => seen(joints, s + 'Ankle')).filter(Boolean)
  if (!hip || !ankles.length) return null
  const leg = Math.max(...ankles.map(a => a[1])) - hip[1]
  if (!(leg > 0)) return null
  const legs = {}
  for (const s of SIDES) {
    const h = seen(joints, s + 'Hip'), k = seen(joints, s + 'Knee'), a = seen(joints, s + 'Ankle')
    const angle = h && k && a ? angleAt(h, k, a, aspect) : null
    if (angle == null) return { hip, leg, legs: null, work: null, other: null, straight: false }
    legs[s] = { knee: k, angle }
  }
  const work = legs.left.angle <= legs.right.angle ? 'left' : 'right'
  const other = work === 'left' ? 'right' : 'left'
  return { hip, leg, legs, work, other, straight: legs.left.angle >= STRAIGHT_DEG && legs.right.angle >= STRAIGHT_DEG }
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'parallel'
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector()
  const reps = []
  let legRef = null, thighRef = null, levelRow = null, levelRoll = null, lastS = null, acc = null

  const viewNow = () => fixedView || views.view
  const supported = v => !v || sideLunge.views.includes(v)
  const level = () => (levelRow == null ? null : Math.abs(levelRow - 0.5) <= LEVEL_ROW && Math.abs(levelRoll) <= LEVEL_ROLL)
  const count = () => reps.filter(r => r.counted).length
  const depthNow = a => (a.judged && a.maxHd != null ? depthOf(a.maxHd) : null)
  const reachedNow = () => !!acc && acc.rec.rawPeak >= PHASES.minRep && meets(depthNow(acc), std)

  function readStanding(fr, f) {
    legRef = legRef == null || f.leg > legRef * 1.1 ? f.leg : ema(legRef, f.leg, 0.15)
    const knees = (f.legs.left.knee[1] + f.legs.right.knee[1]) / 2
    thighRef = ema(thighRef, knees - f.hip[1], 0.15)
    // The view from the shoulders' and hips' widths, read only with all four seen: a joint Vision
    // missed reads as a width of 0, side-on, and this drill judges the front only.
    const j = fr.joints
    if (!fixedView && ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'].every(k => seen(j, k))) views.push(fr, true)
    levelRow = ema(levelRow, knees, 0.2)
    const sh = mid(fr.joints, 'Shoulder')
    levelRoll = sh ? ema(levelRoll, deg(Math.atan2((sh[0] - f.hip[0]) * fr.aspect, f.hip[1] - sh[1])), 0.2) : levelRoll ?? 0
  }

  function track(f, s) {
    const a = acc
    if (!(thighRef > 0) || !f.legs) return
    const hd = (f.hip[1] - f.legs[f.work].knee[1]) / thighRef + HIP_MARK
    if (a.maxHd == null || hd > a.maxHd) a.maxHd = hd
    a.frames.push({ s, work: f.work, trail: f.legs[f.other].angle })
  }

  function finish(rec) {
    const a = acc
    const deep = a.frames.filter(x => x.s >= rec.peak - 0.1)
    const lefts = deep.filter(x => x.work === 'left').length
    const leg = deep.length ? (lefts * 2 >= deep.length ? 'left' : 'right') : null
    const trails = deep.map(x => x.trail).filter(x => x != null)
    const depth = depthNow(a)
    const counted = rec.lost || meets(depth, std)
    const measures = {
      view: a.view, depth, hipDepth: a.judged && a.maxHd != null ? Math.round(a.maxHd * 100) / 100 : null,
      peak: Math.round(rec.peak * 100) / 100, leg, trail: trails.length ? Math.round(Math.min(...trails)) : null,
    }
    reps.push({ rec, counted, reason: counted ? null : 'shallow', measures })
    acc = null
    return counted
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, sideLunge.views)
    if (vh) return vh
    if ((phase === 'waiting' || phase === 'standing') && v && level() === false) return t('Put the phone at knee height and level')
    if (phase === 'waiting') return t('Stand tall to start')
    return count() ? '' : t('Ready. Go when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const phase0 = machine.phase
    // Sitting low to the side the shoulders come down towards the feet: the kit would call that
    // too far, so a lifter seen standing at a fair size is not asked to come closer mid-rep.
    const framed = framing(fr, CHAIN)
    const why = framed === 'far' && phase0 !== 'waiting' && phase0 !== 'standing' ? null : framed
    const f = why ? null : figure(joints, fr.aspect)
    if (f && f.straight && (phase0 === 'waiting' || phase0 === 'standing') && (lastS == null || lastS < PHASES.stand)) readStanding(fr, f)
    let s = f && legRef ? (legRef - f.leg) / legRef / DEPTH_FULL : null
    if (s != null) lastS = s
    if (!supported(viewNow())) s = null
    const ev = machine.push(at, s, { canStart: !!f && f.straight && supported(viewNow()) })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: v != null && level() === true, maxHd: null, frames: [] }
      }
      if (f && s != null) track(f, s)
      if (ev.ended) {
        if (finish(ev.rep)) justCounted = true
        else { justMissed = true; reason = 'shallow' }
      }
    }
    const reached = reachedNow()
    const lit = f && f.work ? [f.work + 'Knee', 'leftHip', 'rightHip'] : ['leftHip', 'rightHip']
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached ? lit : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => ({ counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, ...tempo(r.rec) } }))
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const summary = { count: n, missed, avgDown: avg('downSec'), avgUp: avg('upSec') }
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['level', () => m.filter(x => x.depth == null && x.view != null).length * 2 > n],
      ['trail', () => m.filter(x => x.trail != null && x.trail < TRAIL_DEG).length * 2 > n],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.peak), FADE_S)],
      ['steady', () => true],
    ])
    return {
      count: n, missed, reps: list, tiles: tiles(list, summary, std), cue: CUE[cueId](missed, std), cueId,
      details: list.map(details), note: '', summary, standard: std, view: viewNow(),
    }
  }

  return { push, result }
}

function tiles(list, s, std) {
  const out = []
  const judged = list.filter(r => r.measures.depth)
  if (judged.length) {
    const hit = judged.filter(r => meets(r.measures.depth, std === 'half' ? 'half' : 'parallel')).length
    out.push({ id: 'depth', label: t('Depth'), value: t('{0} of {1}', hit, judged.length), sub: std === 'half' ? t('halfway down or deeper') : t('at parallel or deeper') })
  }
  if (s.avgDown != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgDown), fmt(s.avgUp)), sub: t('down / up, on average') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Depth'), value: depthText(m.depth) },
    { label: t('Tempo'), value: t('Down {0} s · up {1} s', fmt(m.downSec), fmt(m.upSec)) },
  ]
  if (m.leg) rows.push({ label: t('Working leg'), value: m.leg === 'left' ? t('Left') : t('Right') })
  if (m.trail != null) rows.push({ label: t('Other knee'), value: m.trail + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const sideLunge = {
  id: 'side-lunge',
  name: 'Side lunge',
  kind: 'reps',
  views: ['front', 'diagonal'],
  setup: 'Phone at knee height and level, 2 to 3 m away, facing you, your whole body and both feet in the frame. Lunge to one side or both.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\b(side|lateral) (lunge|squat)s?\b|\bcossack squats?\b/i, not: NOT_A_PLAIN_LUNGE, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS,
  defaultStandard: 'parallel',
  misses: { shallow: { line: 'Too shallow. Not counted.', say: 'Too shallow', row: 'Not counted: too shallow' } },
  create,
}

export default sideLunge
