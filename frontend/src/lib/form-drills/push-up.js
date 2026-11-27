// The push-up (README.md, press-kit.js): reps, depth and tempo from the side, at an angle or from
// the head end, plus the elbow angle and the body line side-on. It measures, it never grades.
//
// The hands stay on the floor and the shoulders sink towards them (press-kit's arm drop): the rep
// is the shoulder's drop towards the wrists, the depth the shoulder's height against the elbow's,
// level being the upper arm horizontal. The body line (shoulder, hip, knee) needs a side view:
// a hip sagging or piking moves in the plane the side camera sees and nowhere else. Kneeling
// push-ups are the same rep with the knees as the far end of the line.
import { t } from '../i18n-core.js'
import { angleAt, matchExercise, mean, seen } from './kit.js'
import {
  createArmDropTracker, createFlatViewDetector, DROP_STANDARDS, flatFraming, SHALLOW_MISS,
} from './press-kit.js'

export const HIP_DEV = 10             // degrees the hip sits off the shoulder-knee line on average: sagged or piked

const IDS = new Set(['0662', '1182', '0259', '0283', '1311'])
const PUSH_UP = /^\s*(knee(ling)? |close[- ]grip |wide |diamond )?push[- ]?ups?( \(on knees\))?\s*$/i

// The hip's angle off the shoulder-knee line on one side, positive when it sags below the line.
export function hipLine(joints, side, aspect) {
  const sh = seen(joints, side + 'Shoulder'), hip = seen(joints, side + 'Hip'), kn = seen(joints, side + 'Knee')
  const a = angleAt(sh, hip, kn, aspect)
  if (a == null || Math.abs(kn[0] - sh[0]) < 1e-3) return null
  const lineY = sh[1] + (kn[1] - sh[1]) * (hip[0] - sh[0]) / (kn[0] - sh[0])
  return (180 - a) * (hip[1] > lineY ? 1 : -1)
}

const HIPS_TEXT = { sag: () => t('Sagged'), pike: () => t('Piked'), line: () => t('In line') }

const SIDE = {
  track(acc, frame, sd) {
    const d = hipLine(frame.joints, sd, frame.aspect)
    if (d != null) (acc.extra.hips = acc.extra.hips || []).push(d)
  },
  finish(acc, measures) {
    const hips = acc.extra.hips || []
    const dev = hips.length ? mean(hips) : null
    measures.hipLine = dev == null ? null : Math.round(dev)
    measures.hips = dev == null ? null : dev > HIP_DEV ? 'sag' : dev < -HIP_DEV ? 'pike' : 'line'
  },
  summary: m => {
    const seenReps = m.filter(x => x.hips)
    return {
      hipsSag: seenReps.filter(x => x.hips === 'sag').length,
      hipsPike: seenReps.filter(x => x.hips === 'pike').length,
      hipsLine: seenReps.filter(x => x.hips === 'line').length,
      hipsOf: seenReps.length,
    }
  },
  cues: [
    ['sag', (s, n) => s.hipsSag * 2 > n, () => t('The hips sagged on most reps. Try bracing so the body stays in one line.')],
    ['pike', (s, n) => s.hipsPike * 2 > n, () => t('The hips piked up on most reps. Try keeping a straight line from shoulders to knees.')],
  ],
  tile: s => (s.hipsOf ? { id: 'hips', label: t('Body line'), value: t('{0} of {1}', s.hipsLine, s.hipsOf), sub: t('hips in line') } : null),
  rows: m => (m.hips ? [{ label: t('Hips'), value: HIPS_TEXT[m.hips]() }] : []),
}

const SPEC = {
  framing: flatFraming,
  viewDetector: createFlatViewDetector,
  startHint: () => t('Arms straight to start'),
  readyHint: () => t('Ready. Go when you are.'),
  side: SIDE,
  notes: {
    side: () => t('Filmed from the side: depth, tempo, elbow angle and body line.'),
    diagonal: () => t('Filmed at an angle: depth and tempo only.'),
    front: () => t('Filmed from the front: depth and tempo only.'),
  },
}

const pushUp = {
  id: 'push-up',
  name: 'Push-up',
  kind: 'reps',
  views: ['side', 'diagonal', 'front'],
  setup: 'Phone low and level, side-on, 2 to 3 m away, your whole body in the frame. Side-on it also measures the elbow angle and the body line.',
  matches: ex => matchExercise(ex, { ids: IDS, name: PUSH_UP, cats: new Set(['strength', 'calisthenics']) }),
  standards: DROP_STANDARDS,
  defaultStandard: 'level',
  misses: SHALLOW_MISS,
  create: opts => createArmDropTracker(pushUp, SPEC, opts),
}

export default pushUp
