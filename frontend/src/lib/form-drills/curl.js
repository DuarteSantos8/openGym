// The standing curl, barbell or dumbbells, palms up or hammer grip (README.md): reps, range and
// tempo from any angle, plus what each view can show: side-on the torso swinging back, from any
// side the elbows lifting forward. It measures, it never grades.
//
// The rep is the forearm's lift from hanging (arms-kit liftFromHang): the wrist's image-vertical
// drop under the elbow over the forearm's hanging length, linear in the wrist's height, 0 with the
// arm hanging, 90 with the forearm level; the top and bottom are told in the forearm's angle from
// hanging (about 140° at a full curl). Image-vertical, so turning about the vertical leaves
// it alone; both arms are averaged when both are seen (two-arm curls only). Vision sees no hands
// and no grip, so a hammer curl and a curl read the same.
// Where it breaks: perspective. Towards the top the wrist comes forward of the elbow, so facing the
// camera, a phone far below or above it makes the wrist look higher or lower than it is (about
// 18° at the top with the phone at knee height). Side-on the forearm moves across the view and
// the phone's height does not matter. So outside a side view the top is judged only with the
// phone near chest height (LEVEL), read from where the standing shoulders sit in the image.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  createSidePicker, createViewDetector, deg, fades, framing, framingHint, matchExercise, mean,
  pickCue, round1, seen, viewHint,
} from './kit.js'
import { bothArms, cameraBelowShoulders, createCycleMachine, createHangRef, cycleTempo, liftDeg, liftFromHang, liftOf } from './arms-kit.js'

export const TOP = 110                 // the forearm lifted this far (degrees from hanging): the top of a curl
export const STRAIGHT = 30             // and back under this: the arm straight at the bottom
export const CYCLE = { rise: 15, minAmp: liftOf(60), low: liftOf(STRAIGHT) - 2, settleMs: 600 }   // in lift units
export const LEVEL = [-0.45, 0.75]     // camera from 0.45 torso above to 0.75 below the shoulders: chest height
export const SWAY = 10                 // the torso leaning back this many degrees more than standing: a swing
export const ELBOWS_UP = 25            // the upper arm lifted this far from hanging: the elbows came forward
export const FAST_DOWN_SEC = 1         // an average way down under this: lower slower
export const FADE_DEG = 12             // last reps' top this much under the first ones'
const CHAIN = ['Shoulder', 'Elbow', 'Wrist']

// Two-arm standing curls by id: barbell, EZ bar, dumbbells, hammer and reverse grip. Left out:
// one arm at a time and alternating (the two arms' average halves), seated, preacher, incline,
// lying, concentration and spider curls (a bench or pad, a different hang), drag and cheat curls
// (the elbows or the torso travel by design), cables, bands and machines, and combinations.
const IDS = new Set([
  '0031', '4721', '5669', '0106', '1629', '0113', '4981', '0110', '0636', '2407',
  '0447', '0446', '2741', '0451', '2404',
  '0294', '0416', '0313', '0312', '2485', '0382', '4152', '1228', '2321', '0439', '5201', '1654', '2401', '2402',
])
const NOT_A_PLAIN_CURL = /alternat|one arm|single arm|seated|preacher|peacher|incline|lying|prone|concentration|spider|drag|cheat|leg|hamstring|wrist|finger|nordic|cable|machine|lever|smith|sled|band|ring|suspen|squat|lunge|press|extension|step|ball|bosu|kneeling|jefferson|curl-up|bridge|towel|sheet|table|tibialis|row|deadlift|bent over|form check|crunch|v sit/i

const STANDARDS = [
  { id: 'full', label: 'Full range' },
  { id: 'top', label: 'To the top' },
  { id: 'any', label: 'Any curl' },
]

/** Why a rep does not count under `standard`, or null when it does. A top or bottom not seen is given the rep. */
export function missOf({ top, bottom }, standard) {
  if (standard === 'any') return null
  if (top != null && top < TOP) return 'short'
  if (standard === 'full' && bottom != null && bottom > STRAIGHT) return 'bent'
  return null
}

export const CUE = {
  missed: n => t('Reps that did not count: {0}. Curl all the way up, from straight arms.', n),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  level: () => t('The top of the curl could not be judged from this angle. Put the phone at chest height, or film from the side.'),
  swing: () => t('The torso swung back during most reps. Try keeping it still and the weight lighter.'),
  elbows: () => t('The elbows came forward during most reps. Try keeping them at your sides.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps stopped lower than the first ones.'),
  steady: () => t('Range and tempo held steady across the set.'),
}

const VIEW_NOTE = {
  side: () => t('Filmed from the side: range, tempo, elbows and torso swing.'),
  front: () => t('Filmed from the front: range, tempo and elbows.'),
  diagonal: () => t('Filmed at an angle: range, tempo and elbows.'),
}

// The torso's lean back from upright, side-on, in degrees: positive with the shoulders behind the
// hips (against where the lifter faces, read from the nose or the wrists at the bottom).
function leanBack(joints, side, aspect, facing) {
  const s = seen(joints, side + 'Shoulder'), h = seen(joints, side + 'Hip')
  if (!s || !h || !facing) return null
  return deg(Math.atan2((h[0] - s[0]) * facing * aspect, h[1] - s[1]))
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'full'
  const machine = createCycleMachine(CYCLE)
  const views = createViewDetector()
  const side = createSidePicker(CHAIN)
  const forearm = createHangRef('Elbow', 'Wrist')
  const upper = createHangRef('Shoulder', 'Elbow')
  const reps = []                 // { rec, acc, counted, reason, measures }
  let level = null, leanRef = null, facing = 0
  let acc = null

  const viewNow = () => fixedView || views.view
  const isLevel = () => (level == null ? null : level >= LEVEL[0] && level <= LEVEL[1])
  const topJudged = v => v === 'side' || (v != null && isLevel() === true)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && liftDeg(acc.rec.peak) >= TOP && !missOf({ top: liftDeg(acc.rec.peak), bottom: liftDeg(acc.rec.startLow) }, std)

  // At the bottom, arms hanging: the view, the camera's height, the standing lean and which way the lifter faces.
  function readBottom(fr, sd) {
    if (!fixedView) views.push(fr, true)
    const k = cameraBelowShoulders(fr)
    if (k != null) level = level == null ? k : level + 0.2 * (k - level)
    const nose = seen(fr.joints, 'nose'), sh = seen(fr.joints, sd + 'Shoulder')
    if (nose && sh && Math.abs(nose[0] - sh[0]) > 0.005) facing = Math.sign(nose[0] - sh[0])
    const l = leanBack(fr.joints, sd, fr.aspect, facing)
    if (l != null) leanRef = leanRef == null ? l : leanRef + 0.2 * (l - leanRef)
  }

  function track(fr, sd) {
    const a = acc
    const up = liftDeg(liftFromHang(fr.joints, sd, 'Shoulder', 'Elbow', upper.get(sd)))
    if (up != null && (a.elbows == null || up > a.elbows)) a.elbows = up
    if (a.view === 'side' && leanRef != null) {
      const l = leanBack(fr.joints, sd, fr.aspect, facing)
      if (l != null && (a.sway == null || l - leanRef > a.sway)) a.sway = l - leanRef
    }
  }

  function finish(rec) {
    const a = acc
    const top = a.judged ? liftDeg(rec.peak) : null
    const bottom = liftDeg(rec.startLow)
    const reason = rec.lost ? null : missOf({ top, bottom }, std)
    const measures = {
      view: a.view,
      top: top == null ? null : Math.round(top),
      bottom: Math.round(bottom),
      elbows: a.elbows == null ? null : Math.round(a.elbows),
    }
    if (a.view === 'side') measures.sway = a.sway == null ? null : Math.max(0, Math.round(a.sway))
    reps.push({ rec, counted: !reason, reason, measures })
    acc = null
    return reason
  }

  function hint(why) {
    if (why) return framingHint(why)
    const v = viewNow()
    const vh = viewHint(v, curl.views)
    if (vh) return vh
    if (machine.phase === 'bottom' && v && v !== 'side' && isLevel() === false) return t('Put the phone at chest height')
    return count() ? '' : t('Ready. Go when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const sd = side(joints)
    upper.push(joints, sd, fr.aspect)
    const arm = why ? null : bothArms(joints, forearm, 'Elbow', 'Wrist', fr.aspect)
    const s = arm ? arm.value : null
    if (s != null && s < liftOf(STRAIGHT) && (machine.phase === 'bottom' || machine.phase === 'waiting')) readBottom(fr, sd)
    const ev = machine.push(at, s)
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        const v = viewNow()
        acc = { rec: ev.rep, view: v, judged: topJudged(v), elbows: null, sway: null }
      }
      if (s != null) track(fr, sd)
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
    const max = k => (m.some(x => x[k] != null) ? Math.max(...m.map(x => x[k]).filter(x => x != null)) : null)
    const summary = {
      count: n, missed, avgUp: avg('upSec'), avgDown: avg('downSec'),
      maxSway: max('sway'), maxElbows: max('elbows'),
    }
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['level', () => most(x => x.view !== 'side' && x.view != null && x.top == null)],
      ['swing', () => most(x => x.sway != null && x.sway >= SWAY)],
      ['elbows', () => most(x => x.elbows != null && x.elbows >= ELBOWS_UP)],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.top).filter(x => x != null), FADE_DEG)],
      ['steady', () => true],
    ])
    const vs = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n, missed, reps: list, tiles: tiles(list, summary, std), cue: CUE[cueId](missed), cueId,
      details: list.map(details), note: vs.length === 1 ? VIEW_NOTE[vs[0]]() : '', summary, standard: std, view: viewNow(),
    }
  }

  return { push, result }
}

// Range (every rep whose top was seen, no-reps included), the counted reps' tempo, and side-on the
// most the torso swung back, else the most the elbows lifted.
function tiles(list, s, std) {
  const out = []
  const judged = list.filter(r => r.measures.top != null)
  if (judged.length) {
    const hit = judged.filter(r => r.measures.top >= TOP && (std !== 'full' || r.measures.bottom <= STRAIGHT)).length
    out.push({ id: 'range', label: t('Range'), value: t('{0} of {1}', hit, judged.length), sub: std === 'full' ? t('full range') : t('to the top') })
  }
  if (s.avgUp != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgUp), fmt(s.avgDown)), sub: t('up / down, on average') })
  if (s.maxSway != null) out.push({ id: 'swing', label: t('Swing'), value: s.maxSway + '°', sub: t('torso sway at most') })
  else if (s.maxElbows != null) out.push({ id: 'elbows', label: t('Elbows'), value: s.maxElbows + '°', sub: t('upper arm lift at most') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Range'), value: m.top == null ? t('Top not seen') : t('{0}° to {1}°', m.bottom, m.top) },
    { label: t('Tempo'), value: t('Up {0} s · down {1} s', fmt(m.upSec), fmt(m.downSec)) },
  ]
  if (m.elbows != null) rows.push({ label: t('Elbows'), value: m.elbows + '°' })
  if (m.sway != null) rows.push({ label: t('Swing'), value: m.sway + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const curl = {
  id: 'curl',
  name: 'Curl',
  kind: 'reps',
  views: ['side', 'front', 'diagonal'],
  setup: 'Phone at chest height, 2 to 3 m away, your whole body in the frame. Curl with both arms together. Side-on it also measures the torso swinging back.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bcurls?\b/i, not: NOT_A_PLAIN_CURL, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'full',
  misses: {
    short: { line: 'Not all the way up. Not counted.', say: 'Not all the way up', row: 'Not counted: stopped short of the top' },
    bent: { line: 'Straighten your arms first. Not counted.', say: 'Straighten your arms', row: 'Not counted: arms not straight at the bottom' },
  },
  create,
}

export default curl
