// The hanging knee raise and leg raise from a bar (README.md): reps, how high the thighs came, tempo,
// the knees' bend, and the body swinging. It measures, it never grades.
//
// The rep is the thighs' lift against the torso: 180 minus the angle at the hip between the
// shoulder and the knee, on the side nearest the camera. 0 hanging, 90 with the thighs level with
// the floor whatever the body's swing. Side-on the legs swing in the plane the camera sees, so it is
// plain image geometry. At an angle (people film this at about 45 degrees) the thighs come towards
// the camera and their forward reach shortens, but level stays image-horizontal while the torso
// hangs upright, so height is still judged (a thigh 80 degrees up reads about 76 at 45 degrees);
// the swing, forward and back, shortens with the yaw and is not judged there. From the front the
// thighs point at the camera: refused. Real 720p clips at 45 degrees had a body in every frame.
// Nothing counts unless the lifter hangs: the wrists over
// the shoulders with the forearms up (pull-kit forearmsUp), so knees raised standing on the floor
// are not reps. A rep ends back under HANG_DEG, so it must return near the hang.
// "Straight legs" adds the knees: the knee angle at least STRAIGHT_DEG through the rep.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createSidePicker, createViewDetector, deg, dist, ema, fades, framingHint,
  matchExercise, mean, mid, pickCue, pickSide, round1, seen, tempo, viewHint,
} from './kit.js'
import { forearmsUp } from './pull-kit.js'

export const LEVEL_DEG = 80           // the thighs this far up from hanging at the top: level
export const HANG_DEG = 30            // back under this: down at the hang, the rep ends
export const STRAIGHT_DEG = 150       // the knee angle at least this through the rep: straight legs
export const SWING_DEG = 15           // the torso's angle moving this much over the rep: swung
export const DIAG_SWING_DEG = 10      // at an angle, the torso moving more than this in the image: height not judged
export const FAST_DOWN_SEC = 1
export const FAR_TORSO = 0.07         // shoulder to hip under this share of the frame: too far
export const FADE_S = 0.1
export const PHASES = { stand: HANG_DEG / 90, descent: 0.4, minRep: 0.6, bottomEps: 0.04, ascentRise: 0.12, topBand: 0.03 }
const CHAIN = ['Shoulder', 'Hip', 'Knee']

// Hanging from a bar or stall bars, both legs together. Left out: the captain's chair and parallel
// bars (held up on the forearms), assisted, oblique, twisting and alternating raises, toes to bar
// and knees to elbows (another top), holds, kips, straps and cables.
const IDS = new Set(['9819', '0472', '0475', '1764', '0474', '0866', '11878'])
const NOT_A_PLAIN_RAISE = /assist|oblique|twist|alternat|circle|toes|elbows|kip|hold|strap|cable|single|side|windmill|throw|flutter|pike|parallel|chair|captain|form check/i

const STANDARDS = [
  { id: 'level', label: 'Thighs to level' },
  { id: 'straight', label: 'Straight legs to level' },
  { id: 'any', label: 'Any raise' },
]

const MISSES = {
  low: { line: 'Thighs below level. Not counted.', say: 'Knees higher', row: 'Not counted: thighs below level' },
  bent: { line: 'Knees bent. Not counted.', say: 'Straighten the legs', row: 'Not counted: knees bent' },
}

/** The thighs' lift from hanging against the torso on one side, in degrees; null when unseen. */
export function thighLift(joints, side, aspect) {
  const a = angleAt(seen(joints, side + 'Shoulder'), seen(joints, side + 'Hip'), seen(joints, side + 'Knee'), aspect)
  return a == null ? null : 180 - a
}

/** Why a rep does not count under `standard`, or null. What was not seen is given the rep. */
export function missOf(top, knee, standard) {
  if (standard === 'any') return null
  if (top != null && top < LEVEL_DEG) return 'low'
  return standard === 'straight' && knee != null && knee < STRAIGHT_DEG ? 'bent' : null
}

/**
 * Why a frame cannot be judged: 'none', 'partial' (no shoulder, hip and knee of one side), 'far'
 * (the torso short in the frame). The kit's framing reads the height from the shoulders to the
 * feet, which the raised legs take away at the top.
 */
export function hangFraming(frame) {
  const j = frame && frame.joints
  if (!j || !Object.keys(j).some(k => seen(j, k))) return 'none'
  if (!pickSide(j, CHAIN)) return 'partial'
  const sh = mid(j, 'Shoulder'), hip = mid(j, 'Hip')
  return dist(sh, hip, frame.aspect) < FAR_TORSO ? 'far' : null
}

// Hanging: both wrists over the shoulders and the forearms up.
function hanging(joints, aspect) {
  const sh = mid(joints, 'Shoulder'), wr = mid(joints, 'Wrist')
  return !!sh && !!wr && wr[1] < sh[1] && forearmsUp(joints, aspect)
}

// The torso's angle off vertical in the image, signed.
function torsoAngle(joints, aspect) {
  const s = mid(joints, 'Shoulder'), h = mid(joints, 'Hip')
  if (!s || !h || !(h[1] > s[1])) return null
  return deg(Math.atan2((s[0] - h[0]) * aspect, h[1] - s[1]))
}

const CUE = {
  missed: (n, reason) => (reason === 'bent'
    ? t('Reps that did not count: {0}. The knees bent.', n)
    : t('Reps that did not count: {0}. The thighs did not get up to level.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  swing: () => t('The body swung in most reps. Try keeping the hips still under the bar.'),
  slower: () => t('The way down took under a second. Try lowering with control.'),
  fade: () => t('The last reps were shorter than the first ones.'),
  steady: () => t('Range and tempo held steady across the set.'),
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'level'
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector()
  const side = createSidePicker(CHAIN)
  const reps = []
  let acc = null
  let restLean = null      // the torso's image angle at the hang, averaged

  const viewNow = () => fixedView || views.view
  const supported = v => !v || legRaise.views.includes(v)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.top != null && acc.top >= LEVEL_DEG && (std !== 'straight' || acc.knee == null || acc.knee >= STRAIGHT_DEG)

  function finish(rec) {
    const a = acc
    const top = a.top == null ? null : Math.round(a.top), knee = a.knee == null ? null : Math.round(a.knee)
    const spreadLean = a.leans.length >= 2 ? Math.max(...a.leans) - Math.min(...a.leans) : null
    // How far the torso left its angle at the hang (the swing starts before the rep's signal does).
    const moved = a.rest != null && a.leans.length ? Math.max(...a.leans.map(l => Math.abs(l - a.rest))) : spreadLean
    // At an angle the hip angle is level-true only with the torso hanging still; a swinging body
    // reads low there (15 degrees of swing takes about 12 off at 45 degrees), so such a rep's
    // height is measured, not judged.
    const judgedTop = a.view === 'diagonal' && moved != null && moved > DIAG_SWING_DEG ? null : top
    const reason = rec.lost ? null : missOf(judgedTop, knee, std)
    const swing = a.view !== 'diagonal' && spreadLean != null ? Math.round(spreadLean) : null
    const measures = { view: a.view, top, knee, peak: Math.round(rec.peak * 100) / 100, swing, swung: swing == null ? null : swing > SWING_DEG }
    reps.push({ rec, counted: !reason, reason, measures })
    acc = null
    return reason
  }

  function hint(why, phase, hangs) {
    if (why) return framingHint(why)
    const vh = viewHint(viewNow(), legRaise.views)
    if (vh) return vh
    if (phase === 'waiting' || !hangs) return t('Hang with straight arms to start')
    return count() ? '' : t('Ready. Raise when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = hangFraming(fr)
    const hangs = !why && hanging(joints, fr.aspect)
    // The surer side over time; when its knee drops out for a frame, the other side if it is seen
    // (Vision loses the near knee at the hang more often than the thighs at the top).
    const pick = side(joints)
    const sd = hangs && thighLift(joints, pick, fr.aspect) == null && thighLift(joints, pick === 'left' ? 'right' : 'left', fr.aspect) != null
      ? (pick === 'left' ? 'right' : 'left') : pick
    const lift = hangs ? thighLift(joints, sd, fr.aspect) : null
    const phase0 = machine.phase
    const atHang = lift != null && lift < HANG_DEG && (phase0 === 'waiting' || phase0 === 'standing')
    if (atHang && !fixedView) views.push(fr, true)
    if (atHang) { const l = torsoAngle(joints, fr.aspect); if (l != null) restLean = ema(restLean, l, 0.3) }
    let s = lift == null ? null : lift / 90
    if (!supported(viewNow())) s = null
    const ev = machine.push(at, s, { canStart: s != null })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) acc = { rec: ev.rep, view: viewNow(), top: null, knee: null, leans: [], rest: restLean }
      if (s != null) {
        if (acc.top == null || lift > acc.top) acc.top = lift
        const k = angleAt(seen(joints, sd + 'Hip'), seen(joints, sd + 'Knee'), seen(joints, sd + 'Ankle'), fr.aspect)
        if (k != null && (acc.knee == null || k < acc.knee)) acc.knee = k
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
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase, hangs),
      justCounted, justMissed, reason, reached, highlight: reached ? ['leftKnee', 'rightKnee'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => {
      const tp = tempo(r.rec)
      // The phase machine's way "down" is into the rep: here the legs going up.
      return { counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, upSec: tp.downSec, downSec: tp.upSec } }
    })
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const summary = { count: n, missed, avgUp: avg('upSec'), avgDown: avg('downSec') }
    const reasons = list.filter(r => !r.counted).map(r => r.reason)
    const missedReason = reasons.filter(r => r === 'bent').length * 2 > reasons.length ? 'bent' : 'low'
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['swing', () => m.filter(x => x.swung).length * 2 > n],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
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
  const judged = list.filter(r => r.measures.top != null)
  if (judged.length) out.push({ id: 'height', label: t('Height'), value: t('{0} of {1}', judged.filter(r => r.measures.top >= LEVEL_DEG).length, judged.length), sub: t('thighs to level') })
  if (s.avgUp != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgUp), fmt(s.avgDown)), sub: t('up / down, on average') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Height'), value: m.top == null ? t('Top not seen') : m.top + '°' },
    { label: t('Tempo'), value: t('Up {0} s · down {1} s', fmt(m.upSec), fmt(m.downSec)) },
  ]
  if (m.knee != null) rows.push({ label: t('Knee angle'), value: m.knee + '°' })
  if (m.swung != null) rows.push({ label: t('Swing'), value: m.swung ? t('Swung') : t('Still') })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const legRaise = {
  id: 'hanging-leg-raise',
  name: 'Hanging leg raise',
  kind: 'reps',
  views: ['side', 'diagonal'],
  setup: 'Phone side-on at hip height, 2 to 3 m away, the bar, your hands and your feet in the frame.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bhanging\b.*\b(knee|leg)s?\b.*\braises?\b/i, not: NOT_A_PLAIN_RAISE, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS,
  defaultStandard: 'level',
  misses: MISSES,
  create,
}

export default legRaise
