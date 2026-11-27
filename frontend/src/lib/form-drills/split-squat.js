// The split squat and the lunge in place (README.md): reps, depth and tempo from any camera angle,
// plus the front knee's angle and the torso lean side-on. It measures, it never grades.
//
// One leg in front, one behind, both bending: Bulgarian split squats (back foot up on a bench),
// split squats and static lunges, and forward or reverse lunges stepping out and back in place.
// The front leg does the work, so everything is read on it, image-vertical, which turning about
// the vertical axis (yaw) leaves alone:
//   - the front leg: of the legs whose ankle is on the floor (the lowest ankle, or within
//     FOOT_SLACK torso lengths of it), the one whose knee is highest. That leaves out a back foot
//     up on a bench and a foot in the air mid-step, and at the bottom the back knee, which is low;
//   - the hip's height over the front knee in front-shin heights, r = (knee - hip) / (floor - knee):
//     about 1 standing tall, 0 with the front thigh parallel, negative below. It does not care how
//     wide the stance is, so stepping into the split is not a rep. The rep signal is 1 - r / r_top.
//     Vision's hip sits on the pelvis above the crease (as for the squat), so depth takes HIP_MARK
//     off r: real split squats with the back knee near the floor read r 0.22 to 0.25 from the
//     front, and a partial one stopped on a foam block 0.4 side-on.
//   - the top is also read on the hip's own height: r's shin is short, and with the front leg
//     straight Vision slides the knee up and down it (r 0.62 to 1.13 standing still in one side-on
//     set), so a lifter back at the height she stood at read a third of the way down and the rep
//     never ended. On the way up, with the hip back within the top band of its standing height
//     (its drop over HIP_DROP standing hip heights), the signal is the lesser of that and
//     1 - r / r_top. The standing levels and the start of a rep stay on r alone.
// Where this breaks: perspective, as for the squat. From the front or at an angle the front knee
// comes towards the camera and the hips stay back, so the depth is judged there only with the
// phone at knee height and level (the standing knees near the middle row, the body upright);
// otherwise the status line asks for it and the depth is "not seen" (the rep counts). Walking
// lunges walk out of the frame, so they are not offered.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createViewDetector, deg, dist, ema, fades, framing, framingHint,
  matchExercise, mean, mid, pickCue, round1, seen, spread, tempo, viewHint,
} from './kit.js'

export const PARALLEL_R = 0.1         // hip crease within this many front-shin heights above the front knee: parallel
export const HIP_MARK = 0.2           // Vision's hip above the hip crease at the bottom, in front-shin heights (as the squat's)
export const TALL_R = 0.6             // hip at least this many front-shin heights above the front knee: up
export const MAX_R = 2.5             // r above this: the knee read by the ankle (a back knee near the floor, or a Vision slip); never the front leg's
export const TOP_STEP = 1.2           // one standing frame raises the standing r by at most this factor
export const FOOT_SLACK = 0.3         // an ankle within this many torso lengths of the lowest one is on the floor
export const SWITCH_SLACK = 0.15      // the other knee this many torso lengths higher: it is the front one now
export const HIP_DROP = 0.4           // the hip's drop at a full rep, in standing hip heights over the floor (real ones 0.33 to 0.51)
export const TOP_S = 0.06             // signal under this: at the top, where the standing figure is read
export const LEVEL_ROW = 0.12         // standing knees at most this far from the middle row: camera at knee height
export const LEVEL_ROLL = 12          // degrees the standing torso may lean in the image: camera upright
export const FAST_DOWN_SEC = 1        // an average way down under this: "slow the way down"
export const FADE_S = 0.15            // last reps' depth this much under the first ones' (signal units)
export const PHASES = { stand: 0.12, descent: 0.2, minRep: 0.4, bottomEps: 0.04, ascentRise: 0.15, topBand: 0.04 }
const SIDES = ['left', 'right']

// The split squats and lunges Form check is offered for: by id, and by name, staying in place
// with both feet on the floor or the back one on a bench. Left out: walking, jumping, sideways,
// crossing (curtsey) and travelling lunges, holds, machines and combinations with the arms.
const IDS = new Set([
  '2290', '7549', '3743', '7551', '4442', '4443', '7552', '7590',
  '0781', '2368', '2752', '3030', '2810', '2809', '2960', '3691', '5028', '4059', '4397', '6046',
  '0612', '0336', '3341', '0054', '1581', '0078', '0077', '4000', '4290', '10054', '3470',
  '3574', '3575', '5070', '3399', '3398', '4390', '6047', '6048',
])
const NOT_IN_PLACE = /walk|jump|lateral|side|curtsey|curtsy|cross|diagonal|twist|curl|press|row|kick|knee|high|stretch|pose|smith|lever|cable|band|suspen|sled|hold|pulse|rope|reach|bowling|warming|sprint|mountain|push up|bosu|roll|swing|transverse|sagittal|pass|clean|deep|low|narrow|frog|heel raise|adduction|pallof|form check|step|deficit|elevated|decline|overhead|single leg|one arm|contralateral|ipsilateral|extension|fly/i

const STANDARDS = [
  { id: 'parallel', label: 'Parallel' },
  { id: 'any', label: 'Any depth' },
]

/** The depth's name from r, the hip's height over the front knee in front-shin heights. */
export const depthOf = r => (r == null ? null : r - HIP_MARK <= PARALLEL_R ? 'parallel' : 'above')

// parallel: the front thigh came down to level, within PARALLEL_R; any: every real descent. A
// depth not seen (no front knee at the bottom, or a camera that cannot judge it) is given the rep.
export const meets = (depth, standard) => standard === 'any' || depth == null || depth !== 'above'

const DEPTH_TEXT = { parallel: () => t('Parallel'), above: () => t('Above parallel') }
const depthText = d => (DEPTH_TEXT[d] ? DEPTH_TEXT[d]() : t('Depth not seen'))

/** The one sentence a result ends with, by its id. Functions, so they read the language at call time. */
export const CUE = {
  missed: n => t('Reps that did not count: {0}. The front thigh did not get to parallel.', n),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  level: () => t('Depth could not be judged from this angle. Put the phone at knee height and level, or film from the side.'),
  deeper: () => t('Most reps stopped above parallel. Try lowering the back knee closer to the floor.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps were shallower than the first ones.'),
  steady: () => t('Depth and tempo held steady across the set.'),
}

const VIEW_NOTE = {
  side: () => t('Filmed from the side: depth, tempo, front knee angle and torso lean.'),
  front: () => t('Filmed from the front: depth and tempo.'),
  diagonal: () => t('Filmed at an angle: depth and tempo only.'),
}

// The torso's angle from vertical (shoulders' middle over hips' middle).
function torsoLean(joints, aspect) {
  const s = mid(joints, 'Shoulder'), h = mid(joints, 'Hip')
  if (!s || !h) return null
  return deg(Math.atan2(Math.abs((s[0] - h[0]) * aspect), Math.abs(s[1] - h[1])))
}

/**
 * The front leg at one frame: { side, hip, knee, ankle, floor, r }, or null without hips, a
 * shoulder, and one leg's knee and ankle. `prefer`, the front side so far, is kept unless both
 * legs are seen whole: with a joint of one leg missing, the other cannot be told from the back
 * leg, and taking the back knee for the front one would read a deep rep as standing. Exported for
 * the tests.
 */
export function frontLeg(joints, aspect = 1, prefer = null) {
  const hip = mid(joints, 'Hip'), sh = mid(joints, 'Shoulder')
  if (!hip || !sh) return null
  const torso = dist(sh, hip, aspect)
  if (!(torso > 0)) return null
  const legs = SIDES.map(s => ({ side: s, knee: seen(joints, s + 'Knee'), ankle: seen(joints, s + 'Ankle') })).filter(l => l.knee && l.ankle)
  if (!legs.length) return null
  if (prefer && legs.length < 2 && legs[0].side !== prefer) return null
  const floor = Math.max(...legs.map(l => l.ankle[1]))
  const down = legs.filter(l => floor - l.ankle[1] <= FOOT_SLACK * torso)
  let leg = down.reduce((a, b) => (b.knee[1] < a.knee[1] ? b : a))
  // Standing, the knees are level and either leg reads the same: the front side only changes
  // when the other knee is clearly the higher one, at the bottom of a rep on the other leg.
  const kept = prefer && down.find(l => l.side === prefer)
  if (kept && kept !== leg && kept.knee[1] - leg.knee[1] < SWITCH_SLACK * torso) leg = kept
  // A knee Vision puts down by the ankle reads the shin as nothing and r as 5 or 160: not read.
  const rOf = l => {
    const r = floor - l.knee[1] > 0 ? (l.knee[1] - hip[1]) / (floor - l.knee[1]) : null
    return r != null && r <= MAX_R ? r : null
  }
  const r = rOf(leg)
  if (r == null) return null
  // Every leg on the floor with its r, for the standing level of each (the two differ a little
  // in a split stance, so each leg is measured against its own).
  const all = down.map(l => ({ side: l.side, r: rOf(l) })).filter(l => l.r != null)
  return { side: leg.side, hip, knee: leg.knee, ankle: leg.ankle, floor, r, all }
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'parallel'
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector()
  const reps = []                 // { rec, counted, reason, measures }
  const rTop = { left: null, right: null }   // r standing tall, per leg
  let hipTop = null, hipH = null    // the hip's height standing (image y) and its height over the floor
  let frontSide = null
  let levelRow = null, levelRoll = null
  let lastS = null
  let acc = null                  // the rep under way's measures

  const viewNow = () => fixedView || views.view
  const level = () => (levelRow == null ? null : Math.abs(levelRow - 0.5) <= LEVEL_ROW && Math.abs(levelRoll) <= LEVEL_ROLL)
  const judged = v => v === 'side' || (v != null && level() === true)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.rec.rawPeak >= PHASES.minRep && meets(acc.judged ? depthOf(acc.minR) : null, std)

  // Standing tall at the top: r there for each leg, the view, the camera. r_top leans to the higher
  // readings, so the first frames of a descent, still under TOP_S, do not drag it down, but one
  // frame raises it by at most TOP_STEP. The rep is read against the lower of the two levels, the
  // front leg's: in a split stance Vision now and then swaps the legs' names for a frame or puts a
  // knee low (r 1.1 to 1.5 against the front leg's 0.7 in a brisk side-on set), and read against
  // its own side's level the front leg then looked half way down at the top, so the set never
  // came back to the top.
  function readStanding(frame, f) {
    for (const { side, r: r0 } of f.all) {
      const r = rTop[side] == null ? r0 : Math.min(r0, rTop[side] * TOP_STEP)
      rTop[side] = ema(rTop[side], r, rTop[side] == null || r > rTop[side] ? 0.2 : 0.1)
    }
    hipTop = ema(hipTop, f.hip[1], 0.2)
    hipH = ema(hipH, f.floor - f.hip[1], 0.2)
    if (!fixedView) views.push(frame, true)
    // The camera upright: the torso stands near vertical in the image (the feet are apart, so
    // unlike the squat the body's line runs from the hips, not the feet).
    const sh = mid(frame.joints, 'Shoulder')
    levelRow = ema(levelRow, f.knee[1], 0.2)
    levelRoll = ema(levelRoll, deg(Math.atan2((sh[0] - f.hip[0]) * frame.aspect, f.hip[1] - sh[1])), 0.2)
  }

  function track(frame, f) {
    const a = acc
    if (f.r != null && (a.minR == null || f.r < a.minR)) a.minR = f.r
    if (a.view === 'side') {
      const k = angleAt(f.hip, f.knee, f.ankle, frame.aspect)
      if (k != null && (a.minKnee == null || k < a.minKnee)) a.minKnee = k
      const l = torsoLean(frame.joints, frame.aspect)
      if (l != null && (a.lean == null || l > a.lean)) a.lean = l
    }
  }

  function finish(rec) {
    const a = acc
    const depth = a.judged ? depthOf(a.minR) : null
    const counted = rec.lost || meets(depth, std)
    const measures = { view: a.view, depth, hipOverKnee: a.judged && a.minR != null ? Math.round((a.minR - HIP_MARK) * 100) / 100 : null, peak: Math.round(rec.peak * 100) / 100 }
    if (a.view === 'side') {
      measures.minKnee = a.minKnee == null ? null : Math.round(a.minKnee)
      measures.lean = a.lean == null ? null : Math.round(a.lean)
    }
    reps.push({ rec, counted, reason: counted ? null : 'shallow', measures })
    acc = null
    return counted
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, split.views)
    if (vh) return vh
    if ((phase === 'waiting' || phase === 'standing') && v && v !== 'side' && level() === false) return t('Put the phone at knee height and level')
    if (phase === 'waiting') return t('Stand tall to start')
    return count() ? '' : t('Ready. Go when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, ['Hip', 'Knee', 'Ankle'])
    const f = frontLeg(joints, fr.aspect, frontSide)
    if (f) frontSide = f.side
    const tall = !!f && f.r >= TALL_R
    const phase0 = machine.phase
    if (tall && (phase0 === 'waiting' || phase0 === 'standing') && (lastS == null || lastS < TOP_S)) readStanding(fr, f)
    const tops = [rTop.left, rTop.right].filter(x => x > 0)
    const sR = f && tops.length ? 1 - f.r / Math.min(...tops) : null
    const sH = f && hipH > 0 ? (f.hip[1] - hipTop) / (HIP_DROP * hipH) : null
    const s = phase0 === 'ascending' && sR != null && sH != null && sH <= PHASES.stand ? Math.min(sR, sH) : sR
    if (sR != null) lastS = sR
    const ev = machine.push(at, s, { canStart: tall })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: judged(v), minR: null, minKnee: null, lean: null }
      }
      if (f) track(fr, f)
      if (ev.ended) {
        if (finish(ev.rep)) justCounted = true
        else { justMissed = true; reason = 'shallow' }
      }
    }
    const reached = reachedNow()
    const lit = f ? [f.side + 'Knee', 'leftHip', 'rightHip'] : ['leftHip', 'rightHip']
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
    const unjudged = m.filter(x => x.view !== 'side' && x.depth == null && x.view != null).length
    const summary = {
      count: n,
      missed,
      depthParallel: m.filter(x => x.depth === 'parallel').length,
      depthAbove: m.filter(x => x.depth === 'above').length,
      avgDown: avg('downSec'),
      avgUp: avg('upSec'),
      maxLean: m.some(x => x.lean != null) ? Math.max(...m.map(x => x.lean).filter(x => x != null)) : null,
      // The spread of the front knee's bottom angle across the set, in degrees (side-on only).
      consistency: spread(m.map(x => x.minKnee)),
    }
    if (summary.consistency != null) summary.consistency = Math.round(summary.consistency)
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['level', () => unjudged * 2 > n],
      ['deeper', () => summary.depthAbove * 2 > n],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.peak), FADE_S)],
      ['steady', () => true],
    ])
    const seenViews = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n,
      missed,
      reps: list,
      tiles: tiles(list, summary),
      cue: CUE[cueId](missed, std),
      cueId,
      details: list.map(details),
      note: seenViews.length === 1 ? VIEW_NOTE[seenViews[0]]() : '',
      summary,
      standard: std,
      view: viewNow(),
    }
  }

  return { push, result }
}

/** Of every rep whose depth was seen, no-reps included, how many reached parallel. { hit, of }. */
export function depthShare(reps) {
  const list = (Array.isArray(reps) ? reps : []).filter(r => r.measures && r.measures.depth)
  return { hit: list.filter(r => r.measures.depth === 'parallel').length, of: list.length }
}

// The two or three headline figures: how deep every rep went, the counted reps' tempo, and
// side-on the spread of the front knee's bottom angle (or the most lean when one rep has no spread).
function tiles(list, s) {
  const out = []
  const share = depthShare(list)
  if (share.of) out.push({ id: 'depth', label: t('Depth'), value: t('{0} of {1}', share.hit, share.of), sub: t('front thigh to parallel') })
  if (s.avgDown != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgDown), fmt(s.avgUp)), sub: t('down / up, on average') })
  if (s.consistency != null) out.push({ id: 'consistency', label: t('Consistency'), value: s.consistency + '°', sub: t('spread at the bottom') })
  else if (s.maxLean != null) out.push({ id: 'lean', label: t('Lean'), value: s.maxLean + '°', sub: t('torso lean at most') })
  return out
}

// One rep's rows for "Every rep".
function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Depth'), value: depthText(m.depth) },
    { label: t('Tempo'), value: t('Down {0} s · up {1} s', fmt(m.downSec), fmt(m.upSec)) },
  ]
  if (m.minKnee != null) rows.push({ label: t('Front knee'), value: m.minKnee + '°' })
  if (m.lean != null) rows.push({ label: t('Lean'), value: m.lean + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const split = {
  id: 'split-squat',
  name: 'Split squat',
  kind: 'reps',
  views: ['side', 'diagonal', 'front'],
  setup: 'Phone at knee height and level, 2 to 3 m away, your whole body in the frame, lunging in place. Side-on it also measures the front knee and the torso lean.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /split squat|\blunges?\b/i, not: NOT_IN_PLACE, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS,
  defaultStandard: 'parallel',
  misses: { shallow: { line: 'Too shallow. Not counted.', say: 'Too shallow', row: 'Not counted: too shallow' } },
  create,
}

export default split
