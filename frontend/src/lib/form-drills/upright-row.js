// The standing upright row, two hands together (README.md): reps, how high the elbows went, tempo,
// and from the front how evenly the two elbows rose and whether the torso tilted. It measures, it
// never grades.
//
// The rep is the upper arm's lift from hanging (arms-kit liftFromHang, shoulder to elbow), both arms
// averaged, as for the lateral raise: 0 hanging, 90 with the elbows at shoulder height. A rep counts
// when the elbows reached shoulder height (TOP) and the arms went back down to the hang (HANG)
// before the next one. Image-vertical, so it reads the same facing the camera or turned half away,
// with the phone at shoulder height (LEVEL): one far below makes an elbow that comes forward look
// higher than it is. Side-on the far arm hides behind the body: not judged.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import { createViewDetector, deg, ema, fades, framing, framingHint, matchExercise, mean, mid, pickCue, round1, viewHint } from './kit.js'
import { bothArms, cameraBelowShoulders, createCycleMachine, createHangRef, cycleTempo, liftDeg, liftOf } from './arms-kit.js'

export const TOP = 80                  // the upper arm this far from hanging (degrees): the elbows at shoulder height
export const HANG = 30                 // and back under this before the next rep: lowered to the hang
export const CYCLE = { rise: 12, minAmp: liftOf(45), low: liftOf(HANG), settleMs: 600 }
export const LEVEL = [-0.45, 0.45]     // camera from 0.45 torso above to 0.45 below the shoulders
export const UNEVEN = 12               // the two elbows' tops this many degrees apart: uneven
export const TILT_DEG = 8              // the torso this many degrees further to one side than at the hang: tilted
export const FAST_DOWN_SEC = 1
export const FADE_DEG = 10
const CHAIN = ['Shoulder', 'Elbow']

// Two-handed standing upright rows with a bar, dumbbells, a kettlebell, a band or a cable. Left
// out: the Smith machine, lying cable rows, one arm at a time, high pulls and combinations.
const IDS = new Set(['0120', '0119', '0121', '0123', '5632', '0437', '1765', '0246', '0934', '1500', '6071', '4408', '7114'])
const NOT_A_PLAIN_ROW = /smith|lying|single|one arm|alternat|squat|high pull|clean|snatch|seated|kneel|lunge|press|curl|form check/i

const STANDARDS = [
  { id: 'shoulder', label: 'Elbows to shoulder height' },
  { id: 'any', label: 'Any row' },
]

const MISSES = {
  low: { line: 'Elbows under shoulder height. Not counted.', say: 'Elbows higher', row: 'Not counted: elbows under shoulder height' },
  hang: { line: 'Not lowered to the hang. Not counted.', say: 'Lower all the way', row: 'Not counted: not lowered to the hang' },
}

/** Why a rep does not count under `standard`, or null. A top not seen is given the rep; `bottom` the lift it came down to. */
export function missOf(top, bottom, standard) {
  if (standard === 'any') return null
  if (top != null && top < TOP) return 'low'
  return bottom != null && bottom > CYCLE.low ? 'hang' : null
}

const CUE = {
  missed: (n, reason) => (reason === 'hang'
    ? t('Reps that did not count: {0}. The arms did not go back down to the hang.', n)
    : t('Reps that did not count: {0}. The elbows stayed under shoulder height.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  level: () => t('The height of the raise could not be judged. Put the phone at shoulder height, facing you.'),
  uneven: () => t('One arm rose higher than the other in most reps. Try raising them together.'),
  tilt: () => t('The torso tilted to one side on most reps. Try keeping it upright and pulling evenly.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps stopped lower than the first ones.'),
  steady: () => t('Height and tempo held steady across the set.'),
}

const VIEW_NOTE = {
  front: () => t('Filmed from the front: height, tempo, both arms and the torso.'),
  diagonal: () => t('Filmed at an angle: height and tempo only.'),
}

// The torso's angle off vertical in the image (shoulders' middle over hips' middle), signed.
function torsoAngle(joints, aspect) {
  const s = mid(joints, 'Shoulder'), h = mid(joints, 'Hip')
  if (!s || !h || !(h[1] > s[1])) return null
  return deg(Math.atan2((s[0] - h[0]) * aspect, h[1] - s[1]))
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'shoulder'
  const machine = createCycleMachine(CYCLE)
  const views = createViewDetector()
  const upper = createHangRef('Shoulder', 'Elbow')
  const reps = []
  let level = null, baseTilt = null
  let acc = null

  const viewNow = () => fixedView || views.view
  const isLevel = () => (level == null ? null : level >= LEVEL[0] && level <= LEVEL[1])
  const judgedIn = v => v != null && uprightRow.views.includes(v) && isLevel() === true
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.judged && liftDeg(acc.rec.peak) >= TOP

  function readBottom(fr) {
    if (!fixedView) views.push(fr, true)
    const k = cameraBelowShoulders(fr)
    if (k != null) level = level == null ? k : level + 0.2 * (k - level)
    const a = torsoAngle(fr.joints, fr.aspect)
    if (a != null) baseTilt = ema(baseTilt, a, 0.2)
  }

  function finish(rec) {
    const a = acc
    const top = a.judged ? liftDeg(rec.peak) : null
    const reason = rec.lost ? null : missOf(top, rec.endLow, std)
    const measures = { view: a.view, top: top == null ? null : Math.round(top) }
    if (a.view === 'front') {
      const l = liftDeg(a.left), r = liftDeg(a.right)
      measures.diff = a.judged && l != null && r != null ? Math.round(Math.abs(l - r)) : null
      measures.higher = measures.diff == null || measures.diff < UNEVEN ? null : l > r ? 'left' : 'right'
      measures.tilt = a.tilt == null ? null : Math.round(a.tilt)
    }
    reps.push({ rec, counted: !reason, reason, measures })
    acc = null
    return reason
  }

  function hint(why) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, uprightRow.views)
    if (vh) return vh
    if (machine.phase === 'bottom' && v && isLevel() === false) return t('Put the phone at shoulder height')
    return count() ? '' : t('Ready. Row when you are.')
  }

  function track(fr, arm) {
    const a = acc
    if (arm.sides.length === 2) {
      if (a.left == null || arm.each.left > a.left) a.left = arm.each.left
      if (a.right == null || arm.each.right > a.right) a.right = arm.each.right
    }
    const ang = torsoAngle(fr.joints, fr.aspect)
    if (ang != null && baseTilt != null) {
      const d = Math.abs(ang - baseTilt)
      if (a.tilt == null || d > a.tilt) a.tilt = d
    }
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const arm = why ? null : bothArms(joints, upper, 'Shoulder', 'Elbow', fr.aspect)
    const s = arm ? arm.value : null
    if (s != null && s < CYCLE.low && (machine.phase === 'bottom' || machine.phase === 'waiting')) readBottom(fr)
    const ev = machine.push(at, s)
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: judgedIn(v), left: null, right: null, tilt: null }
      }
      if (arm && acc.view === 'front') track(fr, arm)
      if (ev.ended) {
        reason = finish(ev.rep)
        if (reason) justMissed = true
        else justCounted = true
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftElbow', 'rightElbow'] : [], view: viewNow(),
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
    const diffs = m.map(x => x.diff).filter(x => x != null)
    const summary = { count: n, missed, avgUp: avg('upSec'), avgDown: avg('downSec'), maxDiff: diffs.length ? Math.max(...diffs) : null }
    const reasons = list.filter(r => !r.counted).map(r => r.reason)
    const missedReason = reasons.filter(r => r === 'hang').length * 2 > reasons.length ? 'hang' : 'low'
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['level', () => most(x => x.top == null)],
      ['uneven', () => most(x => x.higher != null)],
      ['tilt', () => most(x => x.tilt != null && x.tilt > TILT_DEG)],
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
  if (judged.length) out.push({ id: 'height', label: t('Height'), value: t('{0} of {1}', judged.filter(r => r.measures.top >= TOP).length, judged.length), sub: t('elbows to shoulder height') })
  if (s.avgUp != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgUp), fmt(s.avgDown)), sub: t('up / down, on average') })
  if (s.maxDiff != null) out.push({ id: 'even', label: t('Left / right'), value: s.maxDiff + '°', sub: t('difference at the top, at most') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Height'), value: m.top == null ? t('Top not seen') : m.top + '°' },
    { label: t('Tempo'), value: t('Up {0} s · down {1} s', fmt(m.upSec), fmt(m.downSec)) },
  ]
  if (m.diff != null) rows.push({ label: t('Left / right'), value: m.higher === 'left' ? t('Left arm {0}° higher', m.diff) : m.higher === 'right' ? t('Right arm {0}° higher', m.diff) : t('Even') })
  if (m.tilt != null) rows.push({ label: t('Lean'), value: m.tilt + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const uprightRow = {
  id: 'upright-row',
  name: 'Upright row',
  kind: 'reps',
  views: ['front', 'diagonal'],
  setup: 'Phone at shoulder height, 2 to 3 m away, facing you, your whole body in the frame. From the front it also compares your elbows and watches the torso.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bupright rows?\b/i, not: NOT_A_PLAIN_ROW, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'shoulder',
  misses: MISSES,
  create,
}

export default uprightRow
