// The triceps pushdown at a cable or band (README.md, press-kit.js): reps, lockout and tempo, plus
// the elbows drifting forward side-on. It measures, it never grades.
//
// The rep is the wrists' drop below the elbows, in standing torso lengths: image-vertical, so the
// view does not change it. It starts with the forearms about level and counts when the elbows
// straightened at the bottom (press-kit's lockout). The arm bends in the plane the side camera
// sees, so side-on the lockout is judged; at an angle that bend is foreshortened and the reps are
// only counted and timed. From the front the camera would be inside the machine, from behind the
// torso hides the hands, so neither is offered.
import { t } from '../i18n-core.js'
import { angleAt, createViewDetector, framing, matchExercise, seen } from './kit.js'
import { ARM, createLockoutTracker, LOCK_STANDARDS, SOFT_MISS } from './press-kit.js'

export const DRIFT_DEG = 25           // the upper arm this far forward of the torso at most: the elbows drifted
export const PHASES = { stand: 0.4, descent: 0.5, minRep: 0.7, bottomEps: 0.04, ascentRise: 0.15, topBand: 0.1 }
// Side-on at the bottom Vision reads a straight arm bent: the wrist sits on the hand wrapped round
// the handle or rope and the shoulder on top of the deltoid. Fourteen lockouts that look straight
// (four lifters, form lab) read 155 to 166 smoothed, against press-kit's 160; 150 keeps a margin
// under them and still refuses an arm stopped 30 degrees short.
export const LOCK_DEG_SIDE = 150

// Two-handed pushdowns with a bar, a rope or a band. One arm at a time (the idle arm would be
// read), straight-arm and lat pushdowns (another movement), incline and floor versions are left out.
const IDS = new Set(['0200', '0201', '0241', '2249', '4355', '1605', '0207', '1606', '1502', '4688'])
const PUSHDOWN = /push ?down/i
const NOT_THIS_PUSHDOWN = /one arm|single arm|straight arm|lat |incline|floor/i

/** The upper arm's angle off the torso (shoulder to hip and shoulder to elbow) on one side, in degrees: 0 pinned. */
export function elbowDrift(joints, side, aspect) {
  return angleAt(seen(joints, side + 'Hip'), seen(joints, side + 'Shoulder'), seen(joints, side + 'Elbow'), aspect)
}

const SIDE = {
  track(acc, frame, sd) {
    const d = elbowDrift(frame.joints, sd, frame.aspect)
    if (d != null && (acc.extra.drift == null || d > acc.extra.drift)) acc.extra.drift = d
  },
  finish(acc, measures) {
    measures.drift = acc.extra.drift == null ? null : Math.round(acc.extra.drift)
  },
  summary: m => {
    const d = m.map(x => x.drift).filter(x => x != null)
    return { maxDrift: d.length ? Math.max(...d) : null, drifted: d.filter(x => x > DRIFT_DEG).length }
  },
  cues: [
    ['elbows', (s, n) => s.drifted * 2 > n, () => t('The elbows drifted forward on most reps. Try keeping them pinned to your sides.')],
  ],
  tile: s => (s.maxDrift == null ? null : { id: 'drift', label: t('Elbow drift'), value: s.maxDrift + '°', sub: t('forward at most') }),
  rows: m => (m.drift == null ? [] : [{ label: t('Elbow drift'), value: m.drift + '°' }]),
}

const SPEC = {
  framing: frame => framing(frame, ARM),
  signal: (f, torso) => Math.max(0, (f.wr[1] - f.el[1]) / torso / 0.5),
  phases: PHASES,
  topS: 0.45,
  lockViews: ['side'],
  lockDeg: LOCK_DEG_SIDE,
  unjudgedCue: () => t('Lockout could not be judged from this angle. Film from the side.'),
  startHint: () => t('Forearms level to start'),
  readyHint: () => t('Ready. Push when you are.'),
  tempoRow: (down, up) => t('Down {0} s · up {1} s', down, up),
  tempoSub: () => t('down / up, on average'),
  lockSub: () => t('elbows straight at the bottom'),
  side: SIDE,
  notes: {
    side: () => t('Filmed from the side: lockout, tempo and elbow drift.'),
    diagonal: () => t('Filmed at an angle: reps and tempo only.'),
  },
}

const tricepsPushdown = {
  id: 'triceps-pushdown',
  name: 'Triceps pushdown',
  kind: 'reps',
  views: ['side', 'diagonal'],
  setup: 'Phone side-on at chest height, 2 to 3 m away, your whole body in the frame.',
  matches: ex => matchExercise(ex, { ids: IDS, name: PUSHDOWN, not: NOT_THIS_PUSHDOWN, cats: new Set(['strength']) }),
  standards: LOCK_STANDARDS,
  defaultStandard: 'lockout',
  misses: SOFT_MISS,
  create: opts => createLockoutTracker(tricepsPushdown, SPEC, createViewDetector, opts),
}

export default tricepsPushdown
