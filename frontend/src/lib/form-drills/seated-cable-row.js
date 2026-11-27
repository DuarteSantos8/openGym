// The seated row at a low cable or with a band (README.md): reps, whether every rep started from
// straight arms and brought the elbows back to the torso, tempo, and the torso rocking. It
// measures, it never grades.
//
// The rep is the wrist coming in to the shoulder on the side nearest the camera: its image distance
// from the shoulder against the longest seen reaching forward at rest (`ref`), so 0 reaching and
// about 1 with the hands at the lower ribs. A distance, not a position: leaning back with straight
// arms does not change it, so a rocking torso is not a rep. Side-on the arms move in the plane the
// camera sees; at an angle or from the front they move along the view and foreshorten: refused.
// The finish is the elbow against the line from the shoulder to the hip (the torso's middle, as
// Vision places them), positive behind it; the start is the straighter elbow's angle while reaching.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createSidePicker, createViewDetector, deg, dist, ema, fades, framingHint,
  matchExercise, mean, mid, pickCue, pickSide, round1, seen, tempo, viewHint,
} from './kit.js'

export const PULL_FULL = 0.45         // the wrist this share of the reach closer to the shoulder: the signal's 1
export const PAST = 0                 // the elbow at least this many torso lengths behind the shoulder-hip line: at the torso
// The elbow at least this straight before the rep: reaching with straight arms. Real straight-arm
// reaches read 148 to 178 on the straighter arm (form lab, three lifters; 148 with the lifter small
// in the frame, where Vision puts the elbows loosely), so 140 keeps a margin and still refuses a
// start 40 degrees short.
export const REACH_DEG = 140
export const ROCK_DEG = 10            // the torso's angle moving this much over the rep: rocked
export const FAST_BACK_SEC = 1        // an average return under this: let the arms go forward slower
export const FADE_S = 0.1
export const FAR_TORSO = 0.07         // shoulder to hip under this share of the frame: too far
export const PHASES = { stand: 0.4, descent: 0.48, minRep: 0.65, bottomEps: 0.04, ascentRise: 0.12, topBand: 0.03 }
const CHAIN = ['Shoulder', 'Elbow', 'Wrist']

// Two-armed seated rows at a low cable, and band rows sitting with the band around the feet. One
// arm and alternating rows, machines, high and wide-grip rows, twisting rows, rows from the floor
// at a cable, rear-delt, upright and face pulls are left out.
const IDS = new Set(['0861', '0180', '6032', '1323', '3896', '2661', '1238', '0239', '3121', '3845', '3144', '5005', '4391', '0163', '5553', '3233'])
const NOT_A_PLAIN_ROW = /single|one arm|alternat|lever|machine|high|wide|twist|face|rear|upright|floor|crossover|elevated|decline|towel|bent over|dumbbell|chin|smith|form check/i

const STANDARDS = [
  { id: 'full', label: 'Full range' },
  { id: 'any', label: 'Any range' },
]

const MISSES = {
  short: { line: 'Elbows not back to the torso. Not counted.', say: 'Pull further', row: 'Not counted: elbows not back to the torso' },
  reach: { line: 'Arms not straight at the start. Not counted.', say: 'Reach all the way', row: 'Not counted: arms not straight at the start' },
}

/**
 * How far the elbow sits behind the line from the shoulder to the hip on one side, in torso
 * lengths, at the elbow's height; `fwd` +1 when the lifter faces image right, -1 left. Positive
 * behind the line, negative in front; null when unseen or the torso does not stand in the image.
 */
export function elbowPast(joints, side, aspect, fwd) {
  const sh = seen(joints, side + 'Shoulder'), hip = seen(joints, side + 'Hip'), el = seen(joints, side + 'Elbow')
  if (!sh || !hip || !el || !(hip[1] > sh[1])) return null
  const lineX = sh[0] + (el[1] - sh[1]) / (hip[1] - sh[1]) * (hip[0] - sh[0])
  return (lineX - el[0]) * aspect * fwd / dist(sh, hip, aspect)
}

/**
 * Why a frame cannot be judged: 'none', 'partial' (no shoulder, elbow and wrist of one side, or no
 * hip), 'far' (the torso short in the frame). Sitting, the feet are about level with the hips, so
 * the kit's framing (shoulders to feet) would call a lifter in reach too far.
 */
export function rowFraming(frame) {
  const j = frame && frame.joints
  if (!j || !Object.keys(j).some(k => seen(j, k))) return 'none'
  const sh = mid(j, 'Shoulder'), hip = mid(j, 'Hip')
  if (!pickSide(j, CHAIN) || !sh || !hip) return 'partial'
  return dist(sh, hip, frame.aspect) < FAR_TORSO ? 'far' : null
}

/** Why a rep does not count under `standard`, or null. What was not seen is given the rep. */
export function missOf(past, reach, standard) {
  if (standard === 'any') return null
  if (past != null && past < PAST) return 'short'
  return reach != null && reach < REACH_DEG ? 'reach' : null
}

/**
 * The straighter of the two elbows (degrees), null when neither arm is seen whole. Both arms reach
 * together; filmed side-on Vision reads one of them 8 to 20 degrees more bent than the other on
 * straight arms (form lab, three clips), so the straighter one is the reach.
 */
export function straighterElbow(joints, aspect) {
  const a = ['left', 'right'].map(s => angleAt(seen(joints, s + 'Shoulder'), seen(joints, s + 'Elbow'), seen(joints, s + 'Wrist'), aspect)).filter(x => x != null)
  return a.length ? Math.max(...a) : null
}

// The torso's angle off vertical in the image, signed.
function torsoAngle(joints, aspect) {
  const s = mid(joints, 'Shoulder'), h = mid(joints, 'Hip')
  if (!s || !h || !(h[1] > s[1])) return null
  return deg(Math.atan2((s[0] - h[0]) * aspect, h[1] - s[1]))
}

const CUE = {
  missed: (n, reason) => (reason === 'reach'
    ? t('Reps that did not count: {0}. They did not start from straight arms.', n)
    : t('Reps that did not count: {0}. The elbows did not come back to the torso.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  rock: () => t('The torso rocked on most reps. Try keeping the hips and chest still.'),
  slower: () => t('The return took under a second. Try letting the arms go forward with control.'),
  fade: () => t('The last reps were shorter than the first ones.'),
  steady: () => t('Range and tempo held steady across the set.'),
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'full'
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector()
  const side = createSidePicker(CHAIN)
  const reps = []
  let ref = null, fwd = null, reachMax = null, acc = null

  const viewNow = () => fixedView || views.view
  const supported = v => !v || seatedRow.views.includes(v)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.past != null && acc.past >= PAST && (std === 'any' || acc.reach == null || acc.reach >= REACH_DEG)

  function finish(rec) {
    const a = acc
    const past = a.past == null ? null : Math.round(a.past * 100) / 100, reach = a.reach == null ? null : Math.round(a.reach)
    const reason = rec.lost ? null : missOf(past, reach, std)
    const rock = a.leans.length >= 2 ? Math.round(Math.max(...a.leans) - Math.min(...a.leans)) : null
    const measures = { view: a.view, past, pastOk: past == null ? null : past >= PAST, reach, reachOk: reach == null ? null : reach >= REACH_DEG, peak: Math.round(rec.peak * 100) / 100, rock }
    reps.push({ rec, counted: !reason, reason, measures })
    acc = null
    return reason
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const vh = viewHint(viewNow(), seatedRow.views)
    if (vh) return vh
    if (phase === 'waiting') return t('Reach forward with straight arms to start')
    return count() ? '' : t('Ready. Row when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = rowFraming(fr)
    const sd = side(joints)
    const sh = why ? null : seen(joints, sd + 'Shoulder'), wr = why ? null : seen(joints, sd + 'Wrist')
    const d = sh && wr ? dist(sh, wr, fr.aspect) : null
    const elbow = why || d == null ? null : straighterElbow(joints, fr.aspect)
    const phase0 = machine.phase
    const atRest = phase0 === 'waiting' || phase0 === 'standing'
    // Reaching with straight arms: the length of the reach, the way the lifter faces, the view.
    if (d != null && elbow != null && elbow >= REACH_DEG && atRest) {
      ref = ref == null || d > ref ? d : ema(ref, d, 0.1)
      fwd = Math.sign(wr[0] - sh[0]) || fwd
    }
    if (!why && atRest && !fixedView) views.push(fr, true)
    let s = d != null && ref ? (ref - d) / ref / PULL_FULL : null
    if (!supported(viewNow())) s = null
    if (s != null && atRest && elbow != null) reachMax = reachMax == null ? elbow : Math.max(reachMax, elbow)
    const ev = machine.push(at, s, { canStart: s != null && elbow != null && elbow >= REACH_DEG })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) {
        acc = { rec: ev.rep, view: viewNow(), reach: reachMax, past: null, leans: [] }
        reachMax = null
      }
      if (s != null) {
        const p = fwd ? elbowPast(joints, sd, fr.aspect, fwd) : null
        if (p != null && (acc.past == null || p > acc.past)) acc.past = p
        const l = torsoAngle(joints, fr.aspect)
        if (l != null) acc.leans.push(l)
      }
      if (ev.ended) {
        reason = finish(ev.rep)
        reachMax = null
        if (reason) justMissed = true
        else justCounted = true
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftElbow', 'rightElbow'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => {
      const tp = tempo(r.rec)
      return { counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, pullSec: tp.downSec, backSec: tp.upSec } }
    })
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const summary = { count: n, missed, avgPull: avg('pullSec'), avgBack: avg('backSec') }
    const reasons = list.filter(r => !r.counted).map(r => r.reason)
    const missedReason = reasons.filter(r => r === 'reach').length * 2 > reasons.length ? 'reach' : 'short'
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['rock', () => m.filter(x => x.rock != null && x.rock > ROCK_DEG).length * 2 > n],
      ['slower', () => summary.avgBack < FAST_BACK_SEC],
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
  const judged = list.filter(r => r.measures.pastOk != null && r.measures.reachOk != null)
  if (judged.length) out.push({ id: 'range', label: t('Range'), value: t('{0} of {1}', judged.filter(r => r.measures.pastOk && r.measures.reachOk).length, judged.length), sub: t('full range') })
  if (s.avgPull != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgPull), fmt(s.avgBack)), sub: t('pull / return, on average') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Start'), value: m.reachOk == null ? t('Not seen') : m.reachOk ? t('Straight arms') : t('Bent arms') },
    { label: t('Top'), value: m.pastOk == null ? t('Not seen') : m.pastOk ? t('Past the torso') : t('Short of the torso') },
    { label: t('Tempo'), value: t('Pull {0} s · return {1} s', fmt(m.pullSec), fmt(m.backSec)) },
  ]
  if (m.rock != null) rows.push({ label: t('Lean'), value: m.rock + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const seatedRow = {
  id: 'seated-cable-row',
  name: 'Seated cable row',
  kind: 'reps',
  views: ['side'],
  setup: 'Phone side-on at chest height when you sit, 2 to 3 m away, your arms, shoulders and hips in the frame.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bseated\b.*\brows?\b|\blow seated rows?\b/i, not: NOT_A_PLAIN_ROW, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'full',
  misses: MISSES,
  create,
}

export default seatedRow
