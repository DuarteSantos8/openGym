// The wall sit, both feet on the floor (README.md): a hold. It counts the seconds held with the
// thighs about level and the back upright against the wall, side-on to the camera, and says when
// the hips rise or the lifter leans forward off the wall; that time does not count. It measures,
// it never grades.
//
// Side-on the legs and the torso lie in the plane the camera sees, so the thigh's angle against
// level (hip over knee) and the torso's against upright are plain image geometry, whatever the
// phone's height. At an angle a level thigh still reads level and an upright torso upright (turning
// about the vertical shortens them sideways only), and a lean or a raised thigh, shortened sideways
// by the cosine of the turn, is stretched back by the turn the shoulders' width gives. Three of four
// real wall sits filmed "from the side" (form lab) were turned 37 to 48 degrees by the shoulders'
// and hips' width and were refused whole. From the front the thigh points at the camera: refused.
// A knee straighter than SEATED_DEG is standing, not sitting: the clock waits.
// Vision's hip sits on the pelvis above the crease (the squat's HIP_MARK), so a level thigh reads
// above level: real holds that looked level read 3 to 15 degrees, one with the hips high 21 to 24.
// THIGH_MARK comes off before the thigh is judged.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createSidePicker, createViewDetector, deg, ema, framing, framingHint, matchExercise, mean, pickCue,
  seen, viewHint,
} from './kit.js'
import { UNSEEN, createHoldClock } from './arms-kit.js'

export const SEATED_DEG = 140         // the knee bent more than this: sitting
export const KNEE_MAX = 115           // the knee opened past this: the hips have risen, whatever the thigh says
export const LEAN_DEG = 20            // the torso this far forward of upright: off the wall
export const GRACE_MS = 800           // out of position this long before it is said
export const REPEAT_MS = 5000         // and said again this often while it lasts
export const FULL_WIDTH = 0.58        // shoulders' and hips' width over the torso facing the camera (kit's view detector)
export const MAX_SIN = 0.9            // the turn's sine taken at most this (about 64 degrees, the front view's edge)
export const THIGH_MARK = 5           // degrees Vision's thigh reads above the real one (its hip sits above the crease)
export const MILESTONE = 10           // the count is said every this many seconds held
const CHAIN = ['Hip', 'Knee', 'Ankle']

export const STANDARDS = [
  { id: 'level', label: 'Thighs level', tol: 10 },
  { id: 'near', label: 'Thighs near level', tol: 20 },
]
const tolOf = std => (STANDARDS.find(s => s.id === std) || STANDARDS[0]).tol

const MISSES = {
  high: { line: 'Hips too high. Time not counted.', say: 'Hips down', row: 'Not counted: hips too high' },
  lean: { line: 'Leaning forward. Time not counted.', say: 'Back to the wall', row: 'Not counted: leaning forward' },
}

const CUE = {
  missed: {
    high: n => t('Out of position for {0} s: the hips rose. Try keeping the thighs level.', n),
    lean: n => t('Out of position for {0} s: you leaned forward. Try keeping your back against the wall.', n),
  },
  none: () => t('No time was counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most of the hold. Keep your whole body in the frame.'),
  steady: () => t('The position held steady through the hold.'),
}

/** How the thigh reads: 'Level' (within 2°), '{0}° above level' or '{0}° below level'. */
export function thighText(a) {
  if (a == null) return t('Not seen')
  const r = Math.round(Math.abs(a))
  if (r < 2) return t('Level')
  return a > 0 ? t('{0}° above level', r) : t('{0}° below level', r)
}

const fmt = n => (n == null ? '' : fmtNum(n))
const secs = ms => Math.round(ms / 100) / 10

// One frame, side-on: the thigh above level and the torso forward of upright, or UNSEEN / null.
function read(fr, side, views) {
  const j = fr.joints, a = fr.aspect
  const sd = side(j)
  const hip = seen(j, sd + 'Hip'), knee = seen(j, sd + 'Knee'), ankle = seen(j, sd + 'Ankle')
  const sh = seen(j, sd + 'Shoulder') || seen(j, (sd === 'left' ? 'right' : 'left') + 'Shoulder')
  if (!hip || !knee || !ankle || !sh) return { view: views.view, pose: UNSEEN }
  const kneeAng = angleAt(hip, knee, ankle, a)
  const seated = kneeAng != null && kneeAng < SEATED_DEG && Math.abs(knee[0] - hip[0]) > 1e-4
  const view = views.push(fr, seated)
  if (!seated) return { view, pose: null }
  const fwd = Math.sign(knee[0] - hip[0])
  // At an angle the body's forward direction shows shortened by the cosine of the turn, which the
  // shoulders' and hips' width gives (about FULL_WIDTH times its sine): image-horizontal lengths
  // are stretched back by it, so a lean or a raised thigh reads about as it would side-on.
  const sinYaw = views.ratio == null ? 0 : Math.min(MAX_SIN, views.ratio / FULL_WIDTH)
  const ax = a / Math.sqrt(1 - sinYaw * sinYaw)
  const thigh = deg(Math.atan2(knee[1] - hip[1], Math.abs(knee[0] - hip[0]) * ax)) - THIGH_MARK
  const lean = deg(Math.atan2((sh[0] - hip[0]) * ax * fwd, hip[1] - sh[1]))
  return { view, pose: { thigh, lean, knee: kneeAng, joints: [sd + 'Hip', sd + 'Knee', sd + 'Ankle'] } }
}

function create({ standard } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'level'
  const tol = tolOf(std)
  const clock = createHoldClock({ graceMs: GRACE_MS, repeatMs: REPEAT_MS, milestone: MILESTONE })
  const side = createSidePicker(CHAIN)
  const views = createViewDetector()
  let thigh = null, lastT = null, lastView = null, lastHint = t('Get into position')

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const { view, pose } = why ? { view: views.view, pose: UNSEEN } : read(fr, side, views)
    lastView = view
    if (why || pose === UNSEEN) {
      const c = clock.push(at, UNSEEN)
      return { count: c.count, phase: c.phase, inFrame: !why, hint: why ? framingHint(why) : lastHint, justCounted: false, justMissed: false, reason: null, reached: false, highlight: [], view }
    }
    const judged = pose && view && wallSit.views.includes(view)
    if (judged) thigh = lastT == null || at - lastT > 400 ? pose.thigh : ema(thigh, pose.thigh, 0.4)
    if (judged) lastT = at
    let st = null
    if (judged) st = thigh > tol || pose.knee > KNEE_MAX ? 'high' : pose.lean > LEAN_DEG ? 'lean' : 'good'
    const before = Math.floor(clock.goodMs / 1000)
    const c = clock.push(at, st, judged ? thigh : null)
    const justCounted = st === 'good' && clock.milestonePassed(before, c.count)
    let hint = ''
    if (view && !wallSit.views.includes(view)) hint = viewHint(view, wallSit.views)
    else if (!st) hint = t('Get into position')
    else if (st !== 'good') hint = t(MISSES[st].line)
    lastHint = hint
    const reached = st === 'good'
    return {
      count: c.count, phase: c.phase, inFrame: true, hint,
      justCounted, justMissed: c.missed, reason: c.missed ? c.reason : null,
      reached, highlight: reached ? pose.joints : [], view,
    }
  }

  function result() {
    const list = clock.stretches().filter(s => (s.good ? s.ms >= 1000 : s.ms >= GRACE_MS))
    const reps = list.map(s => ({
      counted: s.good, reason: s.good ? null : s.reason, lost: s.lost,
      measures: { seconds: secs(s.ms), thigh: s.bends.length ? Math.round(mean(s.bends)) : null, worst: s.bends.length ? Math.round(Math.max(...s.bends)) : null },
    }))
    const count = Math.floor(clock.goodMs / 1000)
    const outMs = list.filter(s => !s.good).reduce((a, s) => a + s.ms, 0)
    const missed = Math.floor(outMs / 1000)
    const good = list.filter(s => s.good)
    const goodThighs = good.flatMap(s => s.bends)
    const byReason = r => list.filter(s => !s.good && s.reason === r).reduce((a, s) => a + s.ms, 0)
    const worst = byReason('lean') > byReason('high') ? 'lean' : 'high'
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !count],
      ['framing', () => good.filter(s => s.lost).length * 2 > good.length],
      ['steady', () => true],
    ])
    const cue = cueId === 'missed' ? CUE.missed[worst](missed) : CUE[cueId]()
    const longest = good.length ? Math.max(...good.map(s => s.ms)) : 0
    const tiles = []
    if (good.length) tiles.push({ id: 'longest', label: t('Longest hold'), value: t('{0} s', fmt(secs(longest))), sub: t('in position, without a break') })
    if (goodThighs.length) tiles.push({ id: 'thighs', label: t('Hips'), value: thighText(mean(goodThighs)), sub: t('on average while held') })
    if (missed > 0) tiles.push({ id: 'out', label: t('Out of position'), value: t('{0} s', missed), sub: t('not counted') })
    return {
      count, missed, reps, tiles, cue, cueId,
      details: reps.map(r => [
        { label: t('Time'), value: t('{0} s', fmt(r.measures.seconds)) },
        { label: t('Hips'), value: thighText(r.counted ? r.measures.thigh : r.measures.worst) },
      ]),
      note: reps.length ? t('Each row is a stretch of the hold, in position or out of it.') : '',
      standard: std, view: lastView,
    }
  }

  return { push, result }
}

// Two-legged wall sits held still, bodyweight or holding a weight. Left out: one leg, marching,
// toe touches, a deficit under the heels, and wall squats (reps, not a hold).
const IDS = new Set(['0734', '7557', '7559', '6558'])
const NOT_A_PLAIN_SIT = /single|one leg|march|toe|deficit|slide|pulse|ball|squat|form check/i

const wallSit = {
  id: 'wall-sit',
  name: 'Wall sit',
  kind: 'hold',
  views: ['side', 'diagonal'],
  setup: 'Phone side-on at knee height, 2 to 3 m away, your whole body in the frame. Seconds count while your thighs stay level and your back stays on the wall.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bwall sits?\b|\bsit \(wall\)/i, not: NOT_A_PLAIN_SIT, cats: new Set(['isometric']) }),
  standards: STANDARDS.map(({ id, label }) => ({ id, label })),
  defaultStandard: 'level',
  misses: MISSES,
  create,
}

export default wallSit
