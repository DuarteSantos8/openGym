// The front plank, on the forearms or the hands (README.md): a hold. It counts the seconds the
// body is held in a straight line from shoulder through hip to ankle, side-on to the camera, and
// says when the hips sag, pike or the knees drop; that time does not count. It measures, it never
// grades. createHoldDrill() is shared with the side plank (side-plank.js).
//
// Side-on the body lies across the view and the line's bend at the hip is plain image geometry
// (arms-kit lineBend): exact whatever the phone's height. From the head or the feet the body runs
// along the view and a sag is lost in perspective, so only a side view is judged. The lower back's
// own curve is not one of Vision's joints: a hip in line over an arched back reads as straight.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createSidePicker, createViewDetector, dist, ema, framingHint, matchExercise, mean, mid, pickCue,
  pickSide, seen, viewHint,
} from './kit.js'
import { UNSEEN, createHoldClock, lineBend, tilt } from './arms-kit.js'

export const LEVEL_TILT = 35          // the shoulder-to-ankle line within this of level: lying along the floor
export const SUPPORT = 0.4            // elbows under the shoulders by this share of the torso: held up on the arms
export const KNEE_BENT = 150          // a knee angle under this: knees down
export const FAR_LENGTH = 0.2         // shoulder to ankle under this (image heights): too far
export const GRACE_MS = 800           // out of line this long before it is said
export const REPEAT_MS = 5000         // and said again this often while it lasts
export const MILESTONE = 10           // the count is said every this many seconds held
export const SINK_DEG = 5             // the hips this much lower in the last third of the hold: sinking
const CHAIN = ['Shoulder', 'Hip', 'Ankle']

export const STANDARDS = [
  { id: 'straight', label: 'Straight line', tol: 15 },
  { id: 'strict', label: 'Strict line', tol: 8 },
]
const tolOf = std => (STANDARDS.find(s => s.id === std) || STANDARDS[0]).tol

export const MISSES = {
  sag: { line: 'Hips sagging. Time not counted.', say: 'Hips up', row: 'Not counted: hips sagging' },
  pike: { line: 'Hips too high. Time not counted.', say: 'Hips down', row: 'Not counted: hips too high' },
  knees: { line: 'Knees down. Time not counted.', say: 'Knees up', row: 'Not counted: knees down' },
}

/** Why a lying-along-the-floor frame cannot be judged: 'none', 'partial' or 'far' (kit.framingHint), null when it can. */
export function holdFraming(frame) {
  const joints = frame && frame.joints
  if (!joints || !Object.keys(joints).some(k => seen(joints, k))) return 'none'
  if (!pickSide(joints, CHAIN)) return 'partial'
  // The body's length, or its shoulders' width seen from the head or feet, where the length foreshortens.
  const a = frame.aspect > 0 ? frame.aspect : 1
  const sh = mid(joints, 'Shoulder'), an = mid(joints, 'Ankle')
  const ls = seen(joints, 'leftShoulder'), rs = seen(joints, 'rightShoulder')
  const size = Math.max(sh && an ? dist(sh, an, a) : 0, ls && rs ? 2.5 * dist(ls, rs, a) : 0)
  return size < FAR_LENGTH ? 'far' : null
}

/** How a bend reads: '{0}° sag', '{0}° pike' or 'In line' (within 2°). */
export function bendText(b) {
  if (b == null) return t('Not seen')
  const r = Math.round(Math.abs(b))
  if (r < 2) return t('In line')
  return b > 0 ? t('{0}° sag', r) : t('{0}° pike', r)
}

const fmt = n => (n == null ? '' : fmtNum(n))
const secs = ms => Math.round(ms / 100) / 10

/**
 * A hold drill from what makes it particular: `read(frame, state)` -> { why, view, pose } where
 * `pose` is UNSEEN (the joints it needs are not all seen), null (not in position) or
 * { bend, knees, joints: [names to light] }; `views` the views
 * it judges; `cue` its own result lines. The rest (the clock, the status line, the result) is the
 * same for every plank.
 */
export function createHoldDrill(def) {
  function create({ standard } = {}) {
    const std = STANDARDS.some(s => s.id === standard) ? standard : 'straight'
    const tol = tolOf(std)
    const clock = createHoldClock({ graceMs: GRACE_MS, repeatMs: REPEAT_MS, milestone: MILESTONE })
    const state = def.state()
    let bend = null, lastT = null, lastView = null, lastHint = t('Get into position')

    function push(frame) {
      const at = Number(frame && frame.t) || 0
      const joints = (frame && frame.joints) || {}
      const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
      const { why, view, pose } = def.read(fr, state)
      lastView = view
      if (why || pose === UNSEEN) {
        const c = clock.push(at, UNSEEN)
        const hint = why ? framingHint(why) : lastHint
        return { count: c.count, phase: c.phase, inFrame: !why, hint, justCounted: false, justMissed: false, reason: null, reached: false, highlight: [], view }
      }
      const judged = pose && view && def.views.includes(view)
      if (judged && pose.bend != null) bend = lastT == null || at - lastT > 400 ? pose.bend : ema(bend, pose.bend, 0.4)
      if (judged) lastT = at
      let st = null
      if (judged) st = pose.knees ? 'knees' : bend == null ? null : bend > tol ? 'sag' : bend < -tol ? 'pike' : 'good'
      const before = Math.floor(clock.goodMs / 1000)
      const c = clock.push(at, st, judged ? bend : null)
      const justCounted = st === 'good' && clock.milestonePassed(before, c.count)
      let hint = ''
      if (view && !def.views.includes(view)) hint = viewHint(view, def.views)
      else if (!st) hint = t('Get into position')
      else if (st !== 'good') hint = t(def.misses[st].line)
      lastHint = hint
      const reached = st === 'good'
      return {
        count: c.count, phase: c.phase, inFrame: true, hint,
        justCounted, justMissed: c.missed, reason: c.missed ? c.reason : null,
        reached, highlight: reached ? pose.joints : [], view,
      }
    }

    function result() {
      const all = clock.stretches()
      const list = all.filter(s => (s.good ? s.ms >= 1000 : s.ms >= GRACE_MS))
      const reps = list.map(s => ({
        counted: s.good, reason: s.good ? null : s.reason, lost: s.lost,
        measures: { seconds: secs(s.ms), bend: s.bends.length ? Math.round(mean(s.bends)) : null, worst: s.bends.length ? Math.round(s.bends.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)) : null },
      }))
      const count = Math.floor(clock.goodMs / 1000)
      const outMs = list.filter(s => !s.good).reduce((a, s) => a + s.ms, 0)
      const missed = Math.floor(outMs / 1000)
      const good = list.filter(s => s.good)
      const goodBends = good.flatMap(s => s.bends)
      const avgBend = goodBends.length ? mean(goodBends) : null
      const byReason = r => list.filter(s => !s.good && s.reason === r).reduce((a, s) => a + s.ms, 0)
      const worst = ['sag', 'pike', 'knees'].reduce((a, r) => (byReason(r) > byReason(a) ? r : a), 'sag')
      const third = Math.ceil(goodBends.length / 3)
      const sinking = goodBends.length >= 9 && mean(goodBends.slice(-third)) - mean(goodBends.slice(0, third)) > SINK_DEG
      const cueId = pickCue([
        ['missed', () => missed > 0],
        ['none', () => !count],
        ['framing', () => good.filter(s => s.lost).length * 2 > good.length],
        ['sinking', () => sinking],
        ['steady', () => true],
      ])
      const cue = cueId === 'missed' ? def.cue.missed[worst](missed) : def.cue[cueId]()
      const longest = good.length ? Math.max(...good.map(s => s.ms)) : 0
      const tiles = []
      if (good.length) tiles.push({ id: 'longest', label: t('Longest hold'), value: t('{0} s', fmt(secs(longest))), sub: t('in line, without a break') })
      if (avgBend != null) tiles.push({ id: 'hips', label: t('Hips'), value: bendText(avgBend), sub: t('on average while held') })
      if (missed > 0) tiles.push({ id: 'out', label: t('Out of line'), value: t('{0} s', missed), sub: t('not counted') })
      return {
        count, missed, reps, tiles, cue, cueId,
        details: reps.map(r => [
          { label: t('Time'), value: t('{0} s', fmt(r.measures.seconds)) },
          { label: t('Hips'), value: bendText(r.counted ? r.measures.bend : r.measures.worst) },
        ]),
        note: reps.length ? t('Each row is a stretch of the hold, in line or out of it.') : '',
        standard: std, view: lastView,
      }
    }

    return { push, result }
  }
  return create
}

const CUE = {
  missed: {
    sag: n => t('Out of line for {0} s: the hips sagged. Try squeezing your glutes and bracing.', n),
    pike: n => t('Out of line for {0} s: the hips rose. Try lowering them into one line with your shoulders and ankles.', n),
    knees: n => t('Out of position for {0} s: the knees dropped.', n),
  },
  none: () => t('No time was counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most of the hold. Keep your whole body in the frame.'),
  sinking: () => t('The hips sank lower as the hold went on.'),
  steady: () => t('The line held steady through the hold.'),
}

// Side-on: the better-seen side's shoulder, hip, ankle and elbow, and the view from the shoulder
// and hip widths (kit.createViewDetector reads a body lying down as well as standing).
function read(fr, st) {
  const why = holdFraming(fr)
  if (why) return { why, view: st.views.view, pose: null }
  const j = fr.joints, a = fr.aspect
  const sd = st.side(j)
  const sh = seen(j, sd + 'Shoulder'), hip = seen(j, sd + 'Hip'), an = seen(j, sd + 'Ankle'), kn = seen(j, sd + 'Knee')
  const el = seen(j, sd + 'Elbow') || seen(j, (sd === 'left' ? 'right' : 'left') + 'Elbow')
  if (!sh || !hip || !an || !el) return { why: null, view: st.views.view, pose: UNSEEN }
  const lying = tilt(sh, an, a) <= LEVEL_TILT
  const torso = dist(sh, hip, a)
  const held = lying && el[1] - sh[1] >= SUPPORT * torso
  const view = st.views.push(fr, held)
  if (!held) return { why: null, view, pose: null }
  const knee = kn ? angleAt(hip, kn, an, a) : null
  return { why: null, view, pose: { bend: lineBend(sh, hip, an, a), knees: knee != null && knee < KNEE_BENT, joints: [sd + 'Shoulder', sd + 'Hip', sd + 'Ankle'] } }
}

// Front planks held still, on the forearms or the hands. Left out: side, reverse and kneeling
// planks, and planks that move (jacks, taps, lifts, walks, twists, rows).
const IDS = new Set(['0463', '5159', '2135', '7275'])
const NOT_A_PLAIN_PLANK = /side|reverse|kneeling|bear|jack|tap|lift|walk|twist|row|jump|hop|push|climber|raise|pass|pull|knee|leg|arm|saw|roll|spider|star|ball|wall|incline|chinese|iron|power|dynamic|hit|kick|march|form check|to /i
const matchPlank = ex => matchExercise(ex, { ids: IDS, name: /\bplank\b/i, not: NOT_A_PLAIN_PLANK, cats: new Set(['isometric']) })

const plank = {
  id: 'plank',
  name: 'Plank',
  kind: 'hold',
  views: ['side'],
  setup: 'Phone low and turned sideways, side-on to you, 2 to 3 m away, your whole body in the frame. Seconds count while your shoulders, hips and ankles stay in one line.',
  matches: ex => matchPlank(ex),
  standards: STANDARDS.map(({ id, label }) => ({ id, label })),
  defaultStandard: 'straight',
  misses: MISSES,
  create: createHoldDrill({
    views: ['side'],
    state: () => ({ side: createSidePicker(CHAIN), views: createViewDetector() }),
    read,
    misses: MISSES,
    cue: CUE,
  }),
}


export default plank
