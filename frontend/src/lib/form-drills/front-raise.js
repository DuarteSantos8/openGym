// The standing front raise, two arms together (README.md): reps, how high the wrists went, tempo,
// and side-on the lean back and the elbows at the top. It measures, it never grades.
//
// The rep is the whole arm's lift from hanging (arms-kit liftFromHang, shoulder to wrist): the
// wrist's image-vertical drop under the shoulder over the arm's hanging length, 0 hanging, 90 with
// the wrist at shoulder height; told in degrees from hanging. A rep counts when the wrists reached
// shoulder height (TOP) and went back down to the hang (HANG) before the next one.
// Side-on the arm swings across the view, the shoulder and the wrist stay the same distance from
// the camera and the height is exact wherever the phone stands. At an angle the wrist comes towards
// the camera, so the height is judged there only with the phone at shoulder height (LEVEL), as for
// the lateral raise. From the front the arms swing straight at the camera: not judged.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createSidePicker, createViewDetector, deg, ema, fades, framing, framingHint, matchExercise, mean,
  mid, pickCue, round1, seen, viewHint,
} from './kit.js'
import { bothArms, cameraBelowShoulders, createCycleMachine, createHangRef, cycleTempo, liftDeg, liftOf } from './arms-kit.js'

export const TOP = 80                  // the arm this far from hanging (degrees): the wrists at shoulder height
export const HANG = 40                 // and back under this before the next rep: lowered to the hang
// (a plate or bar resting on the thighs keeps the arms 26 to 37 degrees forward at the bottom on
// real video, so 30 refused real reps as not lowered)
// The arm's hanging length is read with the arm within this of straight down: a plate held at the
// rim or a bar rests on the thighs in front, so real lifters' arms read 26 to 35 degrees forward
// at the bottom and the kit's 20 never let the length be read (nothing counted).
export const HANG_TOL = 40
export const LOW_END = 30              // back under this the rep ends at once (else it ends where the arms settle)
export const CYCLE = { rise: 12, minAmp: liftOf(45), low: liftOf(LOW_END), settleMs: 600 }   // in lift units
export const LEVEL = [-0.45, 0.45]     // camera from 0.45 torso above to 0.45 below the shoulders
export const LEAN_BACK = 10            // the torso this many degrees further back at the top than at the hang: leaned
export const BENT = 150                // the elbow under this at the top: bent
export const FAST_DOWN_SEC = 1         // an average way down under this: lower slower
export const FADE_DEG = 10             // last reps' top this much under the first ones'
const CHAIN = ['Shoulder', 'Elbow', 'Wrist']

// Two-arm standing front raises by id (a cable with both hands on one handle or a rope among them).
// Left out: one arm at a time and alternating, seated, lying and incline raises, raises overhead
// or "high", holds, and combinations with another movement.
const IDS = new Set(['0310', '0309', '3428', '0978', '0041', '0834', '6073', '5859', '11014', '6543', '11277', '0162'])
const NOT_A_PLAIN_RAISE = /alternat|one arm|single arm|seated|lying|incline|support|over ?head|above head|high|hold|twist|catch|lateral|push up|lunge|pullover|cable|suspen|stick|vertical|form check/i

const STANDARDS = [
  { id: 'shoulder', label: 'Shoulder height' },
  { id: 'any', label: 'Any raise' },
]

const MISSES = {
  low: { line: 'Below shoulder height. Not counted.', say: 'Too low', row: 'Not counted: below shoulder height' },
  hang: { line: 'Not lowered to the hang. Not counted.', say: 'Lower all the way', row: 'Not counted: not lowered to the hang' },
}

/** Why a rep does not count under `standard`, or null. A top not seen is given the rep; `bottom` the lift it came down to. */
export function missOf(top, bottom, standard) {
  if (standard === 'any') return null
  if (top != null && top < TOP) return 'low'
  return bottom != null && bottom > liftOf(HANG) ? 'hang' : null
}

const CUE = {
  missed: (n, reason) => (reason === 'hang'
    ? t('Reps that did not count: {0}. The arms did not go back down to the hang.', n)
    : t('Reps that did not count: {0}. The wrists stayed below shoulder height.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  level: () => t('The height of the raise could not be judged. Put the phone at shoulder height, or film from the side.'),
  lean: () => t('You leaned back on most reps. Try keeping the torso still and lifting with the shoulders.'),
  bent: () => t('The elbows bent on most reps. Try keeping the arms nearly straight.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps stopped lower than the first ones.'),
  steady: () => t('Height and tempo held steady across the set.'),
}

const VIEW_NOTE = {
  side: () => t('Filmed from the side: height, tempo, elbows and lean.'),
  diagonal: () => t('Filmed at an angle: height and tempo only.'),
}

// The torso's angle off vertical in the image, signed: positive with the shoulders right of the hips.
function torsoAngle(joints, aspect) {
  const s = mid(joints, 'Shoulder'), h = mid(joints, 'Hip')
  if (!s || !h || !(h[1] > s[1])) return null
  return deg(Math.atan2((s[0] - h[0]) * aspect, h[1] - s[1]))
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'shoulder'
  const machine = createCycleMachine(CYCLE)
  const views = createViewDetector()
  const side = createSidePicker(CHAIN)
  const arms = createHangRef('Shoulder', 'Wrist', { tol: HANG_TOL })
  const reps = []
  let level = null, baseLean = null
  let acc = null

  const viewNow = () => fixedView || views.view
  const isLevel = () => (level == null ? null : level >= LEVEL[0] && level <= LEVEL[1])
  const judgedIn = v => v === 'side' || (v === 'diagonal' && isLevel() === true)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.judged && liftDeg(acc.rec.peak) >= TOP

  function readBottom(fr) {
    if (!fixedView) views.push(fr, true)
    const k = cameraBelowShoulders(fr)
    if (k != null) level = level == null ? k : level + 0.2 * (k - level)
    const l = torsoAngle(fr.joints, fr.aspect)
    if (l != null) baseLean = ema(baseLean, l, 0.2)
  }

  // Side-on, per frame of the rep: the lift, the torso's angle, where the wrist is (in front) and the elbow.
  function track(fr, s) {
    const j = fr.joints
    const sd = side(j)
    const sh = seen(j, sd + 'Shoulder'), el = seen(j, sd + 'Elbow'), wr = seen(j, sd + 'Wrist')
    if (!sh || !wr) return
    acc.frames.push({ s, lean: torsoAngle(j, fr.aspect), ahead: wr[0] - sh[0], elbow: angleAt(sh, el, wr, fr.aspect) })
  }

  function sideMeasures(rec) {
    const top = acc.frames.filter(f => f.s >= rec.peak - 6)
    if (!top.length) return { lean: null, elbow: null }
    const fwd = Math.sign(mean(top.map(f => f.ahead))) || 1
    const leans = acc.frames.map(f => f.lean).filter(x => x != null)
    const lean = leans.length && baseLean != null ? Math.max(0, ...leans.map(l => -fwd * (l - baseLean))) : null
    const elbows = top.map(f => f.elbow).filter(x => x != null)
    return { lean: lean == null ? null : Math.round(lean), elbow: elbows.length ? Math.round(mean(elbows)) : null }
  }

  function finish(rec) {
    const a = acc
    const top = a.judged ? liftDeg(rec.peak) : null
    const reason = rec.lost ? null : missOf(top, rec.endLow, std)
    const measures = { view: a.view, top: top == null ? null : Math.round(top) }
    if (a.view === 'side') Object.assign(measures, sideMeasures(rec))
    reps.push({ rec, counted: !reason, reason, measures })
    acc = null
    return reason
  }

  function hint(why) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, frontRaise.views)
    if (vh) return vh
    if (machine.phase === 'bottom' && v === 'diagonal' && isLevel() === false) return t('Put the phone at shoulder height')
    return count() ? '' : t('Ready. Go when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const arm = why ? null : bothArms(joints, arms, 'Shoulder', 'Wrist', fr.aspect)
    const s = arm ? arm.value : null
    if (s != null && s < liftOf(HANG) && (machine.phase === 'bottom' || machine.phase === 'waiting')) readBottom(fr)
    const ev = machine.push(at, s)
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: judgedIn(v), frames: [] }
      }
      if (s != null && acc.view === 'side') track(fr, s)
      if (ev.ended) {
        reason = finish(ev.rep)
        if (reason) justMissed = true
        else justCounted = true
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftWrist', 'rightWrist'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => ({ counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, ...cycleTempo(r.rec) } }))
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const most = test => m.filter(test).length * 2 > n
    const leans = m.map(x => x.lean).filter(x => x != null)
    const summary = { count: n, missed, avgUp: avg('upSec'), avgDown: avg('downSec'), maxLean: leans.length ? Math.max(...leans) : null }
    const reasons = list.filter(r => !r.counted).map(r => r.reason)
    const missedReason = reasons.filter(r => r === 'hang').length * 2 > reasons.length ? 'hang' : 'low'
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['level', () => most(x => x.top == null)],
      ['lean', () => most(x => x.lean != null && x.lean > LEAN_BACK)],
      ['bent', () => most(x => x.elbow != null && x.elbow < BENT)],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.top).filter(x => x != null), FADE_DEG)],
      ['steady', () => true],
    ])
    const vs = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n, missed, reps: list, tiles: tiles(list, summary), cue: CUE[cueId](missed, missedReason), cueId,
      details: list.map(details), note: vs.length === 1 && VIEW_NOTE[vs[0]] ? VIEW_NOTE[vs[0]]() : '', summary, standard: std, view: viewNow(),
    }
  }

  return { push, result }
}

function tiles(list, s) {
  const out = []
  const judged = list.filter(r => r.measures.top != null)
  if (judged.length) out.push({ id: 'height', label: t('Height'), value: t('{0} of {1}', judged.filter(r => r.measures.top >= TOP).length, judged.length), sub: t('to shoulder height') })
  if (s.avgUp != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgUp), fmt(s.avgDown)), sub: t('up / down, on average') })
  if (s.maxLean != null) out.push({ id: 'lean', label: t('Lean'), value: s.maxLean + '°', sub: t('leaning back at most') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Height'), value: m.top == null ? t('Top not seen') : m.top + '°' },
    { label: t('Tempo'), value: t('Up {0} s · down {1} s', fmt(m.upSec), fmt(m.downSec)) },
  ]
  if (m.elbow != null) rows.push({ label: t('Elbow angle'), value: m.elbow + '°' })
  if (m.lean != null) rows.push({ label: t('Lean'), value: m.lean + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const frontRaise = {
  id: 'front-raise',
  name: 'Front raise',
  kind: 'reps',
  views: ['side', 'diagonal'],
  setup: 'Phone side-on, 2 to 3 m away, your whole body in the frame. Raise both arms together. Side-on it also measures the lean back and the elbows.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bfront raises?\b/i, not: NOT_A_PLAIN_RAISE, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'shoulder',
  misses: MISSES,
  create,
}

export default frontRaise
