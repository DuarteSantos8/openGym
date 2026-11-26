// The standing hip abduction, a straight leg swung out to the side (README.md): reps on either
// leg, how far out, tempo, the torso leaning away and the working knee bending, filmed from the
// front. It measures, it never grades.
//
// From the front the leg swings in the plane the camera sees, so its angle off upright (hip to
// ankle) is plain image geometry. Each leg is measured against how it stands at rest (a wide stance
// already points the feet out a little), and the working leg is the one further out. Side-on the
// leg swings straight at the camera and the two legs overlap: not judged.
import { t } from '../i18n-core.js'
import { fmtNum } from '../format.js'
import {
  angleAt, createPhaseMachine, createViewDetector, deg, ema, fades, framing, framingHint, matchExercise, mean,
  mid, pickCue, round1, seen, tempo, viewHint,
} from './kit.js'

export const SCALE_DEG = 30           // the leg this far out: the signal's 1
export const BENT = 160               // the working knee under this at the top: bent
export const LEAN_DEG = 10            // the torso this far further from the working leg than at rest: leaned away
export const FAST_BACK_SEC = 1
export const FADE_S = 0.15
export const PHASES = { stand: 0.25, descent: 0.33, minRep: 0.5, bottomEps: 0.04, ascentRise: 0.12, topBand: 0.03 }
const CHAIN = ['Hip', 'Knee', 'Ankle']
const SIDES = ['left', 'right']

// Standing hip abduction with a straight leg, bodyweight, a band or an ankle cable. Left out:
// seated, lying, side-lying and kneeling abductions, bent-knee (fire hydrant) versions, bridges,
// machines, the suspension trainer, balance boards and adduction.
const IDS = new Set(['0791', '3853', '11266', '0710', '4031', '2756', '2755', '3048', '8085'])
const NOT_STANDING = /seated|sitting|lying|kneel|bent|bridge|lever|machine|squat|bosu|isometric|flexion|stretch|suspen|adduct|cross|form check/i

const STANDARDS = [
  { id: 'wide', label: '30° out', deg: 30 },
  { id: 'high', label: '45° out', deg: 45 },
  { id: 'any', label: 'Any raise', deg: 0 },
]

const MISSES = {
  low: { line: 'Leg not out far enough. Not counted.', say: 'Further out', row: 'Not counted: leg not out far enough' },
}

const CUE = {
  missed: n => t('Reps that did not count: {0}. The leg did not go out far enough.', n),
  none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
  lean: () => t('The torso leaned away from the leg on most reps. Try staying tall over the standing leg.'),
  bent: () => t('The working knee bent on most reps. Try keeping the leg straight.'),
  slower: () => t('The way back took under a second. Try lowering the leg with control.'),
  fade: () => t('The last reps were shorter than the first ones.'),
  steady: () => t('Range and tempo held steady across the set.'),
}

// Each leg's angle out from upright at one frame (degrees, positive away from the other leg), the
// torso's lean in image x, and the hips; null without both hips, a knee... for any leg not seen.
function figure(joints, aspect) {
  const lh = seen(joints, 'leftHip'), rh = seen(joints, 'rightHip')
  if (!lh || !rh || Math.abs(lh[0] - rh[0]) < 1e-4) return null
  const leftward = Math.sign(lh[0] - rh[0])
  const legs = {}
  for (const s of SIDES) {
    const h = s === 'left' ? lh : rh, k = seen(joints, s + 'Knee'), a = seen(joints, s + 'Ankle')
    if (!k || !a || !(a[1] > h[1])) { legs[s] = null; continue }
    const out = (a[0] - h[0]) * (s === 'left' ? leftward : -leftward)
    legs[s] = { out: deg(Math.atan2(out * aspect, a[1] - h[1])), knee: angleAt(h, k, a, aspect) }
  }
  if (!legs.left && !legs.right) return null
  const sh = mid(joints, 'Shoulder'), hip = mid(joints, 'Hip')
  const lean = sh && hip[1] > sh[1] ? deg(Math.atan2((sh[0] - hip[0]) * aspect * leftward, hip[1] - sh[1])) : null
  return { legs, lean, leftward }
}

function create({ standard, view: fixedView } = {}) {
  const std = STANDARDS.some(s => s.id === standard) ? standard : 'wide'
  const need = STANDARDS.find(s => s.id === std).deg
  const machine = createPhaseMachine(PHASES)
  const views = createViewDetector()
  const base = { left: null, right: null }
  let leanBase = null, acc = null

  const reps = []
  const viewNow = () => fixedView || views.view
  const supported = v => !v || hipAbduction.views.includes(v)
  const count = () => reps.filter(r => r.counted).length
  const reachedNow = () => !!acc && acc.top != null && acc.top >= need && acc.rec.rawPeak >= PHASES.minRep

  // How far out each leg is against its rest; the working one is the further out.
  function working(f) {
    let best = null
    for (const s of SIDES) {
      const l = f.legs[s]
      if (!l || base[s] == null) continue
      const v = l.out - base[s]
      if (!best || v > best.v) best = { side: s, v, knee: l.knee }
    }
    return best
  }

  function readRest(fr, f) {
    for (const s of SIDES) if (f.legs[s]) base[s] = ema(base[s], f.legs[s].out, 0.2)
    if (f.lean != null) leanBase = ema(leanBase, f.lean, 0.2)
    const j = fr.joints
    if (!fixedView && ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'].every(k => seen(j, k))) views.push(fr, true)
  }

  function finish(rec) {
    const a = acc
    const top = a.top == null ? null : Math.round(a.top)
    const counted = rec.lost || top == null || std === 'any' || top >= need
    const high = a.frames.filter(x => x.s >= rec.peak - 0.1)
    const lefts = high.filter(x => x.side === 'left').length
    const knees = high.map(x => x.knee).filter(x => x != null)
    const leans = a.frames.map(x => x.lean).filter(x => x != null)
    const measures = {
      view: a.view, top, peak: Math.round(rec.peak * 100) / 100,
      leg: high.length ? (lefts * 2 >= high.length ? 'left' : 'right') : null,
      knee: knees.length ? Math.round(mean(knees)) : null,
      lean: leans.length ? Math.round(Math.max(0, ...leans)) : null,
    }
    reps.push({ rec, counted, reason: counted ? null : 'low', measures })
    acc = null
    return counted
  }

  function hint(why, phase) {
    if (why) return framingHint(why)
    const vh = viewHint(viewNow(), hipAbduction.views)
    if (vh) return vh
    if (phase === 'waiting') return t('Stand tall to start')
    return count() ? '' : t('Ready. Go when you are.')
  }

  function push(frame) {
    const at = Number(frame && frame.t) || 0
    const joints = (frame && frame.joints) || {}
    const fr = { t: at, aspect: frame && frame.aspect > 0 ? frame.aspect : 1, joints }
    const why = framing(fr, CHAIN)
    const f = why ? null : figure(joints, fr.aspect)
    const phase0 = machine.phase
    const atRest = phase0 === 'waiting' || phase0 === 'standing'
    const both = f && f.legs.left && f.legs.right
    // At rest with both legs in view and near upright: each leg's own upright, the torso's, the view.
    if (both && atRest && Math.abs(f.legs.left.out - f.legs.right.out) < 6 && (acc == null)) readRest(fr, f)
    const w = f ? working(f) : null
    let s = w ? Math.max(0, w.v) / SCALE_DEG : null
    if (!supported(viewNow())) s = null
    const ev = machine.push(at, s, { canStart: !!both && s != null })
    let justCounted = false, justMissed = false, reason = null
    if (ev.dropped || (!ev.rep && acc)) acc = null
    if (ev.rep) {
      if (!acc || acc.rec !== ev.rep) acc = { rec: ev.rep, view: viewNow(), top: null, frames: [] }
      if (s != null) {
        if (acc.top == null || w.v > acc.top) acc.top = w.v
        const toward = w.side === 'left' ? 1 : -1
        const lean = f.lean != null && leanBase != null ? -(f.lean - leanBase) * toward : null
        acc.frames.push({ s, side: w.side, knee: w.knee, lean })
      }
      if (ev.ended) {
        if (finish(ev.rep)) justCounted = true
        else { justMissed = true; reason = 'low' }
      }
    }
    const reached = reachedNow()
    return {
      count: count(), phase: machine.phase, inFrame: !why, hint: hint(why, machine.phase),
      justCounted, justMissed, reason, reached, highlight: reached && w ? [w.side + 'Knee', w.side + 'Ankle'] : [], view: viewNow(),
    }
  }

  function result() {
    const list = reps.map(r => {
      const tp = tempo(r.rec)
      return { counted: r.counted, reason: r.reason, lost: r.rec.lost, measures: { ...r.measures, outSec: tp.downSec, backSec: tp.upSec } }
    })
    const counted = list.filter(r => r.counted)
    const n = counted.length
    const missed = list.length - n
    const m = counted.map(r => r.measures)
    const avg = k => (n ? round1(mean(m.map(x => x[k]))) : null)
    const tops = m.map(x => x.top).filter(x => x != null)
    const summary = { count: n, missed, avgOut: avg('outSec'), avgBack: avg('backSec'), avgTop: tops.length ? Math.round(mean(tops)) : null }
    const cueId = pickCue([
      ['missed', () => missed > 0],
      ['none', () => !n],
      ['framing', () => counted.filter(r => r.lost).length * 2 > n],
      ['lean', () => m.filter(x => x.lean != null && x.lean > LEAN_DEG).length * 2 > n],
      ['bent', () => m.filter(x => x.knee != null && x.knee < BENT).length * 2 > n],
      ['slower', () => summary.avgBack < FAST_BACK_SEC],
      ['fade', () => fades(m.map(x => x.peak), FADE_S)],
      ['steady', () => true],
    ])
    return {
      count: n, missed, reps: list, tiles: tiles(summary), cue: CUE[cueId](missed), cueId,
      details: list.map(details), note: '', summary, standard: std, view: viewNow(),
    }
  }

  return { push, result }
}

function tiles(s) {
  const out = []
  if (s.avgTop != null) out.push({ id: 'range', label: t('Range'), value: s.avgTop + '°', sub: t('leg out from upright, on average') })
  if (s.avgOut != null) out.push({ id: 'tempo', label: t('Tempo'), value: t('{0} / {1} s', fmt(s.avgOut), fmt(s.avgBack)), sub: t('out / back, on average') })
  return out
}

function details(r) {
  const m = r.measures
  const rows = [
    { label: t('Range'), value: m.top == null ? t('Not seen') : m.top + '°' },
    { label: t('Tempo'), value: t('Out {0} s · back {1} s', fmt(m.outSec), fmt(m.backSec)) },
  ]
  if (m.leg) rows.push({ label: t('Working leg'), value: m.leg === 'left' ? t('Left') : t('Right') })
  if (m.knee != null) rows.push({ label: t('Knee angle'), value: m.knee + '°' })
  if (m.lean != null) rows.push({ label: t('Lean'), value: m.lean + '°' })
  return rows
}

const fmt = n => (n == null ? '' : fmtNum(n))

const hipAbduction = {
  id: 'hip-abduction',
  name: 'Hip abduction',
  kind: 'reps',
  views: ['front'],
  setup: 'Phone at hip height, 2 to 3 m away, facing you, your whole body and both feet in the frame. Hold a support with the far hand if you need one.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bhip abduction\b/i, not: NOT_STANDING, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS.map(({ id, label }) => ({ id, label })),
  defaultStandard: 'wide',
  misses: MISSES,
  create,
}

export default hipAbduction
