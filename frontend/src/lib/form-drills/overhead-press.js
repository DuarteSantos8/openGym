// The standing overhead press (README.md, press-kit.js): reps, lockout and tempo, filmed from the
// front or at an angle. It measures, it never grades.
//
// The rep is the wrists' rise above the shoulders, in standing torso lengths: image-vertical, so
// any yaw reads it the same. It starts with the weight at the shoulders (or lower) and counts
// when the elbows straightened overhead (press-kit's lockout). Side-on is refused: the plates or
// dumbbell heads on the near side sit right over the near wrist and forearm at the top, so the
// arm cannot be seen. From the front the elbows flaring out show a soft lockout, elbows bent
// forward do not; at an angle one arm's bend points at the camera, so there the reps are counted
// and timed but the lockout is not judged.
import { t } from '../i18n-core.js'
import { createViewDetector, framing, matchExercise } from './kit.js'
import { ARM, createLockoutTracker, LOCK_STANDARDS, SOFT_MISS } from './press-kit.js'

export const RACK_FLOOR = 0.3         // the signal is held at least this: the rack and anything below it is the start
export const PHASES = { stand: 0.45, descent: 0.55, minRep: 0.75, bottomEps: 0.04, ascentRise: 0.15, topBand: 0.1 }

// Two-armed presses with a barbell or dumbbells, standing or seated. Machines (Smith, lever), one
// arm at a time, behind the head, push presses and jerks (a leg drive) are left out.
const IDS = new Set(['1162', '1165', '1456', '1457', '0426', '1226', '0091', '0405', '0404'])
const PRESS = /^\s*(barbell |dumbbell |ez barbell )?(standing |seated )?(overhead|military|shoulder) press\s*$/i
const NOT_THIS_PRESS = /one arm|single arm|alternate|behind|smith|lever|machine|push press|jerk/i

const SPEC = {
  framing: frame => framing(frame, ARM),
  signal: (f, torso) => Math.max(RACK_FLOOR, (f.sh[1] - f.wr[1]) / torso),
  phases: PHASES,
  topS: 0.5,
  lockViews: ['front'],
  unjudgedCue: () => t('Lockout could not be judged from this angle. Face the camera.'),
  startHint: () => t('Weight at your shoulders to start'),
  readyHint: () => t('Ready. Press when you are.'),
  tempoRow: (up, down) => t('Up {0} s · down {1} s', up, down),
  tempoSub: () => t('up / down, on average'),
  lockSub: () => t('elbows straight at the top'),
  notes: {
    front: () => t('Filmed from the front: lockout and tempo.'),
    diagonal: () => t('Filmed at an angle: reps and tempo only.'),
  },
}

const overheadPress = {
  id: 'overhead-press',
  name: 'Overhead press',
  kind: 'reps',
  views: ['front', 'diagonal'],
  setup: 'Phone facing you at chest height, 2 to 3 m away, your whole body and the weight overhead in the frame.',
  matches: ex => matchExercise(ex, { ids: IDS, name: PRESS, not: NOT_THIS_PRESS, cats: new Set(['strength']) }),
  standards: LOCK_STANDARDS,
  defaultStandard: 'lockout',
  misses: SOFT_MISS,
  create: opts => createLockoutTracker(overheadPress, SPEC, createViewDetector, opts),
}

export default overheadPress
