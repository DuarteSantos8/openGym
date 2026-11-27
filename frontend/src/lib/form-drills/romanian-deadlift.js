// The Romanian deadlift (README.md): reps, depth and tempo from any camera angle, plus the knee
// bend and the hinge itself side-on. It measures, it never grades.
//
// Counting and depth read the hands against the knees, image-vertical, in standing shin lengths
// (0 with the wrists at the knees, about 0.5 at mid-shin, positive lower). In a Romanian deadlift
// the weights travel straight down over the middle of the feet, so the wrists and the knees stay
// about as far from the camera as each other: turning about the vertical (yaw) and the phone's
// height barely move one against the other, unlike the torso, whose tilt runs along the camera's
// axis from the front. The rep signal is the hands' way down from where they hang standing to the
// knees: 0 at the top, 1 at the knees, about 1.6 at mid-shin.
// What the 19 joints cannot show: the back rounding, the bar or dumbbells themselves (the wrists
// stand in for them), the feet. Side-on it adds the knee angle at the bottom (a soft-kneed hinge
// or a squat) and the torso's angle from vertical (how far the hips hinged).
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createSidePicker, createViewDetector, deg, ema, fades, framing,
  framingHint, matchExercise, mean, mid, pickCue, round1, seen, tempo, viewHint,
} from './kit.js'

export const KNEE_LINE = -0.1         // wrists within this many shin lengths above the knees: at the knees
export const SHIN_LINE = 0.4          // wrists this far under the knees (mid-shin is 0.5): at mid-shin
export const STRAIGHT = 0.85          // thigh over shin (image-vertical) at least this: legs straight
export const UPRIGHT = 0.85           // torso's vertical share of its length at least this: standing tall
export const HANG_MIN = 0.3           // standing, the wrists hang at least this many shins above the knees
export const TOP_S = 0.08             // signal under this: at the top, where the standing figure is read
export const FAST_DOWN_SEC = 1        // an average way down under this: "slow the way down"
export const SQUAT_KNEE = 120         // a bottom knee angle under this (side-on) is more squat than hinge
export const FADE_S = 0.25            // last reps' hands this much higher than the first ones' (signal units)
export const PHASES = { stand: 0.08, descent: 0.15, minRep: 0.4, bottomEps: 0.05, ascentRise: 0.2, topBand: 0.03 }
const CHAIN = ['Hip', 'Knee', 'Ankle']

// Romanian and stiff-legged deadlifts with a barbell, dumbbells or a kettlebell, both feet down.
// Left out: one leg or a staggered stance, good mornings (the bar on the back, the hands do not
// travel), machines, cables, bands and landmines, and combinations.
const IDS = new Set([
  '1459', '0085', '1532', '3731', '4861', '6041', '10730', '4173',
  '1543', '0116', '0432', '3340', '3894', '0434', '4293', '3733', '6049',
])
const NOT_PLAIN = /single|one leg|one legged|staggered|split|kickstand|smith|lever|cable|landmine|band|bench|squat|row|cross|hip supported|suspen|pass|rotational|good morning/i

const STANDARDS = [
  { id: 'knees', label: 'Hands to the knees' },
  { id: 'shin', label: 'Hands to mid-shin' },
  { id: 'any', label: 'Any depth' },
]

/** How low the hands went, by the wrists against the knees (shin lengths, positive below). */
export const depthOf = wd => (wd == null ? null : wd >= SHIN_LINE ? 'shin' : wd >= KNEE_LINE ? 'knees' : 'above')

// knees: the wrists came to the knees, within KNEE_LINE; shin: to mid-shin; any: every real
// descent. A depth not seen (no wrist or knee at the bottom) is given the rep.
export const meets = (depth, standard) => standard === 'any' || depth == null || (standard === 'shin' ? depth === 'shin' : depth !== 'above')

const DEPTH_TEXT = { shin: () => t('Hands to mid-shin'), knees: () => t('Hands to the knees'), above: () => t('Hands above the knees') }
const depthText = d => (DEPTH_TEXT[d] ? DEPTH_TEXT[d]() : t('Depth not seen'))

/** The one sentence a result ends with, by its id. Functions, so they read the language at call time. */
export const CUE = {
  missed: (n, standard) => (standard === 'shin'
    ? t('Reps that did not count: {0}. The hands did not reach mid-shin.', n)
    : t('Reps that did not count: {0}. The hands stayed above the knees.', n)),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  knees: () => t('The knees bent a lot in most reps. Try pushing the hips back and keeping the knees soft.'),
  slower: () => t('The way down took under a second. Try slowing the descent.'),
  fade: () => t('The last reps were shallower than the first ones.'),
  steady: () => t('Depth and tempo held steady across the set.'),
}

const VIEW_NOTE = {
  side: () => t('Filmed from the side: depth, tempo, knee angle and hinge.'),
  front: () => t('Filmed from the front: depth and tempo.'),
  diagonal: () => t('Filmed at an angle: depth and tempo only.'),
}

// The torso's angle from vertical (shoulder over hip) on one side, the other shoulder standing in.
function torsoLean(joints, side, aspect) {
  const s = seen(joints, side + 'Shoulder') || seen(joints, (side === 'left' ? 'right' : 'left') + 'Shoulder')
  const h = seen(joints, side + 'Hip')
  if (!s || !h) return null
  return deg(Math.atan2(Math.abs((s[0] - h[0]) * aspect), Math.abs(s[1] - h[1])))
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'knees'
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector()
  const side = createSidePicker(CHAIN)
  const reps = []                 // { rec, counted, reason, measures }
  let shinRef = null, hangRef = null
  let lastS = null
  let acc = null                  // the rep under way's measures

  const viewNow = () => fixedView || views.view
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.rec.rawPeak >= PHASES.minRep && meets(depthOf(acc.maxWd), std)

  // The figure's image-vertical facts: the wrists against the knees, and whether the lifter
  // stands tall (legs straight, torso upright). null without wrist, knee and ankle.
  function figure(joints, aspect) {
    const wrist = mid(joints, 'Wrist'), knee = mid(joints, 'Knee'), ankle = mid(joints, 'Ankle')
    if (!wrist || !knee || !ankle) return null
    const shin = ankle[1] - knee[1]
    if (!(shin > 0)) return null
    const hip = mid(joints, 'Hip'), sh = mid(joints, 'Shoulder')
    let tall = false
    if (hip && sh) {
      const thigh = knee[1] - hip[1], torso = Math.hypot((sh[0] - hip[0]) * aspect, sh[1] - hip[1])
      tall = thigh / shin >= STRAIGHT && torso > 0 && (hip[1] - sh[1]) / torso >= UPRIGHT
    }
    return { wrist, knee, shin, tall, gap: wrist[1] - knee[1] }
  }

  // Standing tall at the top: the shin the depth is measured in, and where the hands hang.
  function readStanding(frame, f) {
    shinRef = shinRef == null ? f.shin : ema(shinRef, f.shin, 0.15)
    const hang = -f.gap / shinRef
    if (hang >= HANG_MIN) hangRef = hangRef == null ? hang : ema(hangRef, hang, 0.2)
    if (!fixedView) views.push(frame, true)
  }

  function track(frame, f) {
    const a = acc
    if (f && shinRef > 0) {
      const wd = f.gap / shinRef
      if (a.maxWd == null || wd > a.maxWd) a.maxWd = wd
    }
    if (a.view === 'side') {
      const aspect = frame.aspect
      const sd = side(frame.joints)
      const k = angleAt(seen(frame.joints, sd + 'Hip'), seen(frame.joints, sd + 'Knee'), seen(frame.joints, sd + 'Ankle'), aspect)
      if (k != null && (a.minKnee == null || k < a.minKnee)) a.minKnee = k
      const l = torsoLean(frame.joints, sd, aspect)
      if (l != null && (a.hinge == null || l > a.hinge)) a.hinge = l
    }
  }

  function finish(rec) {
    const a = acc
    const depth = depthOf(a.maxWd)
    const counted = rec.lost || meets(depth, std)
    const reason = counted ? null : std === 'shin' ? 'shin' : 'knees'
    const measures = { view: a.view, depth, handDepth: a.maxWd == null ? null : Math.round(a.maxWd * 100) / 100, peak: Math.round(rec.peak * 100) / 100 }
    if (a.view === 'side') {
      measures.minKnee = a.minKnee == null ? null : Math.round(a.minKnee)
      measures.hinge = a.hinge == null ? null : Math.round(a.hinge)
    }
    reps.push({ rec, counted, reason, measures })
    acc = null
    return reason
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const vh = viewHint(viewNow(), deadlift.views)
    if (vh) return vh
    if (phase === 'waiting') return t('Stand tall to start')
    return count() ? '' : t('Ready. Go when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const f = figure(joints, fr.aspect)
    const phase0 = machine.phase
    if (f && f.tall && (phase0 === 'waiting' || phase0 === 'standing') && (lastS == null || lastS < TOP_S)) readStanding(fr, f)
    const s = f && hangRef ? (f.gap / shinRef + hangRef) / hangRef : null
    if (s != null) lastS = s
    const ev = machine.push(at, s, { canStart: !!f && f.tall })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) acc = { rec: ev.rep, view: viewNow(), maxWd: null, minKnee: null, hinge: null }
      if (f) track(fr, f)
      if (ev.ended) {
        const r = finish(ev.rep)
        if (!r) justCounted = true
        else { justMissed = true; reason = r }
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
    const sideOn = m.filter(x => x.minKnee != null)
    const hinges = m.map(x => x.hinge).filter(x => x != null)
    const summary = {
      count: n,
      missed,
      depthShin: m.filter(x => x.depth === 'shin').length,
      depthKnees: m.filter(x => x.depth === 'knees').length,
      depthAbove: m.filter(x => x.depth === 'above').length,
      avgDown: avg('downSec'),
      avgUp: avg('upSec'),
      avgHinge: hinges.length ? Math.round(mean(hinges)) : null,
      bentKnees: sideOn.filter(x => x.minKnee < SQUAT_KNEE).length,
    }
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['knees', () => summary.bentKnees * 2 > n],
      ['slower', () => summary.avgDown < FAST_DOWN_SEC],
      ['fade', () => fades(m.map(x => x.peak), FADE_S)],
      ['steady', () => true],
    ])
    const seenViews = [...new Set(list.map(r => r.measures.view).filter(Boolean))]
    return {
      count: n,
      missed,
      reps: list,
      tiles: tiles(list, summary, std),
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

/**
 * Of every rep whose depth was seen, no-reps included, how many reached the depth a result talks
 * about: mid-shin under 'shin', the knees or lower otherwise. { hit, of, depth }.
 */
export function depthShare(reps, standard) {
  const list = (Array.isArray(reps) ? reps : []).filter(r => r.measures && r.measures.depth)
  const depth = standard === 'shin' ? 'shin' : 'knees'
  const hit = list.filter(r => r.measures.depth === 'shin' || (depth === 'knees' && r.measures.depth === 'knees')).length
  return { hit, of: list.length, depth }
}

// The two or three headline figures: how low the hands went, the counted reps' tempo, and
// side-on how far the hips hinged.
function tiles(list, s, std) {
  const out = []
  const share = depthShare(list, std)
  if (share.of) out.push({ id: 'depth', label: t('Depth'), value: t('{0} of {1}', share.hit, share.of), sub: share.depth === 'shin' ? t('hands to mid-shin') : t('hands to the knees or lower') })
  if (s.avgDown != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgDown), fmt(s.avgUp)), sub: t('down / up, on average') })
  if (s.avgHinge != null) out.push({ id: 'hinge', label: t('Hinge'), value: s.avgHinge + '°', sub: t('torso from vertical, on average') })
  return out
}

// One rep's rows for "Every rep".
function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Depth'), value: depthText(m.depth) },
    { label: t('Tempo'), value: t('Down {0} s · up {1} s', fmt(m.downSec), fmt(m.upSec)) },
  ]
  if (m.minKnee != null) rows.push({ label: t('Knee angle'), value: m.minKnee + '°' })
  if (m.hinge != null) rows.push({ label: t('Hinge'), value: m.hinge + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const deadlift = {
  id: 'romanian-deadlift',
  name: 'Romanian deadlift',
  kind: 'reps',
  views: ['side', 'diagonal', 'front'],
  setup: 'Side-on or turned halfway, 2 to 3 m away, your whole body and your hands in the frame. Side-on it also measures the knee bend and the hinge.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /romanian deadlift|\brdl\b|stiff.?leg(ged)? deadlift|straight legs? deadlift/i, not: NOT_PLAIN, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'knees',
  misses: {
    knees: { line: 'Hands above the knees. Not counted.', say: 'Too shallow', row: 'Not counted: hands above the knees' },
    shin: { line: 'Hands above mid-shin. Not counted.', say: 'Too shallow', row: 'Not counted: hands above mid-shin' },
  },
  create,
}

export default deadlift
