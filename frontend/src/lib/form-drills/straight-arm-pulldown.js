// The straight-arm pulldown at a high cable or a band (README.md): reps, where each one started and
// finished, tempo, and the elbows and the torso staying still. It measures, it never grades.
//
// The rep is the angle at the shoulder between the hip and the wrist on the side nearest the
// camera: about 100 with the arms up at the cable, near 15 with the hands at the thighs. It is an
// angle against the torso, so a hinge at the hips does not change it, and side-on the arm swings
// in the plane the camera sees, so it is plain image geometry. At an angle or from the front that
// swing is foreshortened and the angle cannot be read: those views are refused.
// A rep counts under "full range" when it started with the arms raised (START_DEG or more since
// the last rep) and the hands came down to the thighs (FINISH_DEG or less).
// Side-on runs to about 24 degrees here (VIEW_EDGES), not the kit's 20: turning the lifter only
// squeezes the swing along x by cos(yaw), which moves the angle a few degrees there (the edges
// hold to 5 degrees at 20, not at 25), and a cable column is rarely filmed square on. A real set
// filmed as side-on, the lifter a little turned to the camera, read 0.20 to 0.25 and every rep was
// refused with "turn side-on".
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createSidePicker, createViewDetector, deg, fades, framing, framingHint,
  matchExercise, mean, mid, pickCue, round1, seen, tempo, viewHint, VIEW_EDGES as KIT_VIEW_EDGES,
} from './kit.js'

export const TOP_REF = 100             // the angle the signal reads as 0
export const FINISH_DEG = 25           // the hands at the thighs: the angle at most this at the bottom
export const START_DEG = 90            // the arms raised: the angle at least this before the rep
export const BENT = 150                // the elbow under this at its most bent: bent
export const ROCK_DEG = 10             // the torso's angle moving this much over the rep: rocked
export const FAST_UP_SEC = 1           // an average way back up under this: let the arms rise slower
export const FADE_S = 0.1
export const VIEW_EDGES = { side: 0.235, front: KIT_VIEW_EDGES.front }  // widthRatio: side to about 24 degrees
export const PHASES = { stand: 0.467, descent: 0.53, minRep: 0.7, bottomEps: 0.03, ascentRise: 0.12, topBand: 0.03 }
const CHAIN = ['Hip', 'Shoulder', 'Wrist']

// Standing, two-armed straight-arm pulldowns at a cable or a band, and the lat pushdown. One arm,
// kneeling, lying and incline versions and pullovers are left out.
const IDS = new Set(['0238', '0237', '8297', '6036', '1067', '4576', '0928', '1229', '0199'])
const PULLDOWN = /straight[- ]arms? (lat )?pull ?downs?|\blat push ?downs?\b/i
const NOT_THIS_PULLDOWN = /single|one arm|kneel|lying|incline|decline|bent|side|form check/i

const STANDARDS = [
  { id: 'full', label: 'Full range' },
  { id: 'any', label: 'Any range' },
]

const MISSES = {
  short: { line: 'Hands not down to the thighs. Not counted.', say: 'All the way down', row: 'Not counted: hands not down to the thighs' },
  start: { line: 'Not started from the top. Not counted.', say: 'Start from the top', row: 'Not counted: not started from the top' },
}

/** The angle at the shoulder between the hip and the wrist on one side, in degrees; null when unseen. */
export function shoulderAngle(joints, side, aspect) {
  return angleAt(seen(joints, side + 'Hip'), seen(joints, side + 'Shoulder'), seen(joints, side + 'Wrist'), aspect)
}

// The torso's angle off vertical in the image, signed.
function torsoAngle(joints, aspect) {
  const s = mid(joints, 'Shoulder'), h = mid(joints, 'Hip')
  if (!s || !h || !(h[1] > s[1])) return null
  return deg(Math.atan2((s[0] - h[0]) * aspect, h[1] - s[1]))
}

/** Why a rep does not count under `standard`, or null. A start or finish not seen is given the rep. */
export function missOf(start, finish, standard) {
  if (standard === 'any') return null
  if (finish != null && finish > FINISH_DEG) return 'short'
  return start != null && start < START_DEG ? 'start' : null
}

const CUE = {
  missed: (n, reason) => (reason === 'start'
    ? t('Reps that did not count: {0}. They did not start with the arms raised.', n)
    : t('Reps that did not count: {0}. The hands did not come down to the thighs.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  bent: () => t('The elbows bent on most reps. Try keeping the arms nearly straight.'),
  rock: () => t('The torso rocked on most reps. Try keeping the hips and chest still.'),
  slower: () => t('The way back up took under a second. Try letting the arms rise with control.'),
  fade: () => t('The last reps were shorter than the first ones.'),
  steady: () => t('Range and tempo held steady across the set.'),
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'full'
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector(VIEW_EDGES)
  const side = createSidePicker(CHAIN)
  const reps = []
  let startMax = null, acc = null

  const viewNow = () => fixedView || views.view
  const supported = v => !v || pulldown.views.includes(v)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.min != null && acc.min <= FINISH_DEG && (std === 'any' || acc.start == null || acc.start >= START_DEG)

  function finish(rec) {
    const a = acc
    const start = a.start == null ? null : Math.round(a.start), end = a.min == null ? null : Math.round(a.min)
    const reason = rec.lost ? null : missOf(start, end, std)
    const leans = a.leans
    const measures = {
      view: a.view, start, finish: end, peak: Math.round(rec.peak * 100) / 100,
      elbow: a.elbow == null ? null : Math.round(a.elbow),
      rock: leans.length >= 2 ? Math.round(Math.max(...leans) - Math.min(...leans)) : null,
    }
    reps.push({ rec, counted: !reason, reason, measures })
    acc = null
    return reason
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const vh = viewHint(viewNow(), pulldown.views)
    if (vh) return vh
    if (phase === 'waiting') return t('Arms up to the cable to start')
    return count() ? '' : t('Ready. Pull when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const sd = side(joints)
    const ang = why ? null : shoulderAngle(joints, sd, fr.aspect)
    const phase0 = machine.phase
    const atTop = phase0 === 'waiting' || phase0 === 'standing'
    if (!why && atTop && !fixedView) views.push(fr, true)
    let s = ang == null ? null : (TOP_REF - ang) / (TOP_REF - FINISH_DEG)
    if (!supported(viewNow())) s = null
    if (s != null && atTop) startMax = startMax == null ? ang : Math.max(startMax, ang)
    const ev = machine.push(at, s, { canStart: s != null })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        acc = { rec: ev.rep, view: viewNow(), start: startMax, min: null, elbow: null, leans: [] }
        startMax = null
      }
      if (s != null) {
        if (acc.min == null || ang < acc.min) acc.min = ang
        const e = angleAt(seen(joints, sd + 'Shoulder'), seen(joints, sd + 'Elbow'), seen(joints, sd + 'Wrist'), fr.aspect)
        if (e != null && (acc.elbow == null || e < acc.elbow)) acc.elbow = e
        const l = torsoAngle(joints, fr.aspect)
        if (l != null) acc.leans.push(l)
      }
      if (ev.ended) {
        reason = finish(ev.rep)
        if (reason) justMissed = true
        else justCounted = true
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftWrist', 'rightWrist'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => ({ counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, ...tempo(r.rec) } }))
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const most = test => m.filter(test).length * 2 > n
    const summary = { count: n, missed, avgDown: avg('downSec'), avgUp: avg('upSec') }
    const reasons = list.filter(r => !r.counted).map(r => r.reason)
    const missedReason = reasons.filter(r => r === 'start').length * 2 > reasons.length ? 'start' : 'short'
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['bent', () => most(x => x.elbow != null && x.elbow < BENT)],
      ['rock', () => most(x => x.rock != null && x.rock > ROCK_DEG)],
      ['slower', () => summary.avgUp < FAST_UP_SEC],
      ['fade', () => fades(m.map(x => x.peak), FADE_S)],
      ['steady', () => true],
    ])
    return {
      count: n, missed, reps: list, tiles: tiles(list, summary), cue: CUE[cueId](missed, missedReason), cueId,
      details: list.map(details), note: '', summary, standard: std, view: viewNow(),
    }
  }

  return { push, result }
}

function tiles(list, s) {
  const out = []
  const judged = list.filter(r => r.measures.finish != null && r.measures.start != null)
  if (judged.length) {
    const hit = judged.filter(r => r.measures.finish <= FINISH_DEG && r.measures.start >= START_DEG).length
    out.push({ id: 'range', label: t('Range'), value: t('{0} of {1}', hit, judged.length), sub: t('full range') })
  }
  if (s.avgDown != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgDown), fmt(s.avgUp)), sub: t('down / up, on average') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Range'), value: m.start == null || m.finish == null ? t('Not seen') : t('{0}° to {1}°', m.start, m.finish) },
    { label: t('Tempo'), value: t('Down {0} s · up {1} s', fmt(m.downSec), fmt(m.upSec)) },
  ]
  if (m.elbow != null) rows.push({ label: t('Elbow angle'), value: m.elbow + '°' })
  if (m.rock != null) rows.push({ label: t('Lean'), value: m.rock + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const pulldown = {
  id: 'straight-arm-pulldown',
  name: 'Straight-arm pulldown',
  kind: 'reps',
  views: ['side'],
  setup: 'Phone side-on at chest height, 2 to 3 m away, your whole body and the hands at the top in the frame.',
  matches: ex => matchExercise(ex, { ids: IDS, name: PULLDOWN, not: NOT_THIS_PULLDOWN, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'full',
  misses: MISSES,
  create,
}

export default pulldown
