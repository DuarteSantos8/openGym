// The standing lateral raise, dumbbells or kettlebells (README.md): reps, how high the elbows
// went, tempo, and from the front how evenly the two arms rose. It measures, it never grades.
//
// The rep is the upper arm's lift from hanging (arms-kit liftFromHang): the elbow's image-vertical
// drop under the shoulder over the upper arm's hanging length, 0 hanging, 90 with the elbow at
// shoulder height; told in degrees from hanging (about 90 at a full raise). Image-vertical, so it
// reads the same facing the camera or turned half away; both arms are averaged when both are seen,
// which also cancels the perspective of one arm coming towards the camera and the other going away.
// Side-on the arms swing straight at the camera and the far one hides behind the body: not judged.
// The top is judged against shoulder height, so the phone stands at shoulder height (LEVEL): a
// phone far below makes an elbow that comes forward look higher than it is.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import { createViewDetector, fades, framing, framingHint, matchExercise, mean, pickCue, round1, viewHint } from './kit.js'
import { bothArms, cameraBelowShoulders, createCycleMachine, createHangRef, cycleTempo, liftDeg, liftOf } from './arms-kit.js'

export const TOP = 80                  // the upper arm this far from hanging (degrees): the elbows at shoulder height
export const CYCLE = { rise: 12, minAmp: liftOf(45), low: liftOf(30), settleMs: 600 }   // in lift units
export const LEVEL = [-0.45, 0.45]     // camera from 0.45 torso above to 0.45 below the shoulders
export const UNEVEN = 12               // the two arms' tops this many degrees apart: uneven
export const FAST_DOWN_SEC = 1         // an average way down under this: lower slower
export const FADE_DEG = 10             // last reps' top this much under the first ones'
const CHAIN = ['Shoulder', 'Elbow']

// Two-arm standing lateral raises by id. Left out: one arm at a time and alternating (the two
// arms' average halves), partials (short by design), rear-delt and bent-over raises, seated,
// lying, incline and chest-supported raises, cables, bands, machines and combinations.
const IDS = new Set(['0334', '2234', '5631', '0311', '3879', '3740', '6074'])
const NOT_A_PLAIN_RAISE = /alternat|one arm|single arm|partial|rear|bent over|seated|lying|incline|support|leaning|cable|band|lever|machine|plank|front and|4 ways|switching|towel|suspen|form check/i

const STANDARDS = [
  { id: 'shoulder', label: 'Shoulder height' },
  { id: 'any', label: 'Any raise' },
]

/** Why a rep does not count under `standard`, or null when it does. A top not seen is given the rep. */
export const missOf = (top, standard) => (standard !== 'any' && top != null && top < TOP ? 'low' : null)

export const CUE = {
  missed: n => t('Reps that did not count: {0}. The elbows stayed below shoulder height.', n),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  level: () => t('The height of the raise could not be judged. Put the phone at shoulder height, facing you.'),
  uneven: () => t('One arm rose higher than the other in most reps. Try raising them together.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps stopped lower than the first ones.'),
  steady: () => t('Height and tempo held steady across the set.'),
}

const VIEW_NOTE = {
  front: () => t('Filmed from the front: height, tempo and both arms.'),
  diagonal: () => t('Filmed at an angle: height and tempo only.'),
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'shoulder'
  const machine = createCycleMachine(CYCLE)
  const views = createViewDetector()
  const upper = createHangRef('Shoulder', 'Elbow')
  const reps = []
  let level = null
  let acc = null

  const viewNow = () => fixedView || views.view
  const isLevel = () => (level == null ? null : level >= LEVEL[0] && level <= LEVEL[1])
  const judgedIn = v => v != null && lateral.views.includes(v) && isLevel() === true
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.judged && liftDeg(acc.rec.peak) >= TOP

  function readBottom(fr) {
    if (!fixedView) views.push(fr, true)
    const k = cameraBelowShoulders(fr)
    if (k != null) level = level == null ? k : level + 0.2 * (k - level)
  }

  function finish(rec) {
    const a = acc
    const top = a.judged ? liftDeg(rec.peak) : null
    const reason = rec.lost ? null : missOf(top, std)
    const measures = { view: a.view, top: top == null ? null : Math.round(top) }
    if (a.view === 'front') {
      const l = liftDeg(a.left), r = liftDeg(a.right)
      measures.diff = a.judged && l != null && r != null ? Math.round(Math.abs(l - r)) : null
      measures.higher = measures.diff == null || measures.diff < UNEVEN ? null : l > r ? 'left' : 'right'
    }
    reps.push({ rec, counted: !reason, reason, measures })
    acc = null
    return reason
  }

  function hint(why) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, lateral.views)
    if (vh) return vh
    if (machine.phase === 'bottom' && v && isLevel() === false) return t('Put the phone at shoulder height')
    return count() ? '' : t('Ready. Go when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const arm = why ? null : bothArms(joints, upper, 'Shoulder', 'Elbow', fr.aspect)
    const s = arm ? arm.value : null
    if (s != null && s < liftOf(30) && (machine.phase === 'bottom' || machine.phase === 'waiting')) readBottom(fr)
    const ev = machine.push(at, s)
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: judgedIn(v), left: null, right: null }
      }
      if (arm && arm.sides.length === 2) {
        if (acc.left == null || arm.each.left > acc.left) acc.left = arm.each.left
        if (acc.right == null || arm.each.right > acc.right) acc.right = arm.each.right
      }
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
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['level', () => most(x => x.top == null)],
      ['uneven', () => most(x => x.higher != null)],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.top).filter(x => x != null), FADE_DEG)],
      ['steady', () => true],
    ])
    const vs = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n, missed, reps: list, tiles: tiles(list, summary), cue: CUE[cueId](missed), cueId,
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
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const lateral = {
  id: 'lateral-raise',
  name: 'Lateral raise',
  kind: 'reps',
  views: ['front', 'diagonal'],
  setup: 'Phone at shoulder height, 2 to 3 m away, facing you, your whole body in the frame. Raise both arms together. From the front it also compares your left and right arm.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\blateral raises?\b/i, not: NOT_A_PLAIN_RAISE, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'shoulder',
  misses: { low: { line: 'Below shoulder height. Not counted.', say: 'Too low', row: 'Not counted: below shoulder height' } },
  create,
}

export default lateral
